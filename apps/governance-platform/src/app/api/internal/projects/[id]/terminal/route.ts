import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { notifyProjectEvent } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { buildPreviewUrl } from "@/lib/preview-url";
import { parkAgentBlocked } from "@/lib/claim-blockers";
import {
  applyStateChange,
  updateComponentMetadata,
  requirePrimaryComponentRow,
  type PrimaryComponentRow,
} from "@/lib/project-state-effects";
import {
  TerminalRequestSchema,
  type PauseReason,
  type PreviewActualState,
  type TerminalStatus,
  resolveLoopRateLimitRetryAt,
} from "@arena/contracts";
import { getProjectProposalPath } from "@/lib/project-identity";
import { notify } from "@/lib/notifications";
import { parseRequiredSecrets } from "@/lib/required-secrets";
import { buildProjectSecretsFocusHref } from "@/lib/project-interaction-deeplink";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";
import { resolveProjectTelegramMiniAppEntryUrl } from "@/lib/project-telegram-mini-app-url";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type TransactionClient = Prisma.TransactionClient;

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function getBlockerFromPauseReason(pauseReason: PauseReason | null | undefined): string | null {
  switch (pauseReason) {
    case "MANUAL":
      return "MANUAL";
    case "BUDGET":
      return "BUDGET";
    case "SECRETS":
      return "SECRETS";
    case "RATE_LIMIT":
      return "RATE_LIMIT";
    case "INFRA":
      return "INFRA";
    case "API":
      return "API";
    default:
      return null;
  }
}

function isRetryablePauseBlocker(blocker: string | null): blocker is "RATE_LIMIT" | "INFRA" | "API" {
  return blocker === "RATE_LIMIT" || blocker === "INFRA" || blocker === "API";
}

function isAgentOffTerminalReport(
  _terminalState: TerminalStatus,
  reasonCode: string | undefined,
): boolean {
  if (reasonCode === "agent_off") return true;
  return false;
}

function isPowerOffTerminalReport(
  terminalState: TerminalStatus,
  reasonCode: string | undefined,
): boolean {
  return terminalState === "CANCELED" && reasonCode === "power_off";
}

function isGracefulShutdownTerminalReport(
  terminalState: TerminalStatus,
  reasonCode: string | undefined,
): boolean {
  return terminalState === "CANCELED" && (
    reasonCode === "resume_reclaim" ||
    reasonCode === "idle_preview_exited" ||
    reasonCode === "paused_runtime_shutdown" ||
    reasonCode === "power_off" ||
    reasonCode === "status_archived" ||
    reasonCode === "not_found" ||
    reasonCode === "no_component"
  );
}

function isUntypedGovernanceStopReport(
  terminalState: TerminalStatus,
  reasonCode: string | undefined,
): boolean {
  return terminalState === "CANCELED" && reasonCode === "stopped_by_governance";
}

function inferTerminalBlocker(
  row: PrimaryComponentRow,
  terminalState: TerminalStatus,
  pauseReason: PauseReason | null | undefined,
  reasonCode: string | undefined,
): string | null {
  const blocker = getBlockerFromPauseReason(pauseReason);
  if (blocker) return blocker;
  if (!isUntypedGovernanceStopReport(terminalState, reasonCode)) return null;
  if (row.powerIntent !== "ON" || row.agentIntent !== "ON") return null;
  if (row.agentState !== "RUNNING") return null;
  if (row.lastOutcome != null || row.blockers.length > 0) return null;
  return "INFRA";
}

function isGovernanceManualStopReport(
  pauseReason: PauseReason | null | undefined,
  reasonCode: string | undefined,
  reasonMessage: string | null | undefined,
): boolean {
  if (pauseReason !== "MANUAL") return false;
  if (reasonCode === "paused_manual" || reasonCode === "status_paused_manual") return true;
  return reasonMessage === "Governance stop: paused_manual"
    || reasonMessage === "Governance stop: status_paused_manual";
}

function isWorkspaceDirtyBeforeSyncReport(
  pauseReason: PauseReason | null | undefined,
  reasonCode: string | undefined,
): boolean {
  return pauseReason === "MANUAL" && reasonCode === "workspace_dirty_before_sync";
}

function terminalDedupeDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sameDateMs(a: Date | null, b: string | null): boolean {
  if (!a || !b) return false;
  const parsed = new Date(b);
  return !Number.isNaN(parsed.getTime()) && a.getTime() === parsed.getTime();
}

function isDuplicateBlockedTerminalReport(
  row: PrimaryComponentRow,
  blocker: string | null,
  body: {
    pauseReason?: PauseReason | null;
    reasonCode?: string;
  },
  resolvedRetryAt: string | null,
): boolean {
  if (!blocker) return false;
  if (row.agentState !== "IDLE" || row.lastOutcome != null) return false;
  if (!row.blockers.includes(blocker)) return false;

  if (isWorkspaceDirtyBeforeSyncReport(body.pauseReason, body.reasonCode)) return true;

  if (isRetryablePauseBlocker(blocker)) {
    // If the repeat terminal report carries a newer retry time, let it refresh retry truth.
    return !resolvedRetryAt || sameDateMs(row.retryAt, resolvedRetryAt);
  }

  return false;
}

function shouldKeepRuntimeAlive(
  terminalState: TerminalStatus,
  pauseReason: PauseReason | null | undefined,
  previewActual: PreviewActualState | undefined,
  reasonCode: string | undefined,
): boolean {
  return (
    (isAgentOffTerminalReport(terminalState, reasonCode) && previewActual === "SERVING") ||
    terminalState === "DEPLOYED" ||
    getBlockerFromPauseReason(pauseReason) != null ||
    (terminalState === "FAILED" && previewActual === "SERVING")
  );
}

function shouldParkFailedIteration(
  terminalState: TerminalStatus,
  pauseReason: PauseReason | null | undefined,
  _previewActual: PreviewActualState | undefined,
): boolean {
  if (pauseReason != null) return false;
  return terminalState === "FAILED" || terminalState === "CANCELED";
}

function isAlreadyTerminal(row: PrimaryComponentRow): boolean {
  // Terminal history is carried by lastOutcome on an idle row.
  // Recoverable blocker pauses are not terminal history.
  if (row.agentState === "IDLE" && row.lastOutcome != null) return true;
  return false;
}

function isAlreadyTerminalLiveRuntime(row: PrimaryComponentRow): boolean {
  return isAlreadyTerminal(row) && row.runtimeState === "RUNNING";
}

function isCompleted(row: PrimaryComponentRow): boolean {
  return row.agentState === "IDLE" && row.lastOutcome === "COMPLETED";
}

function isAgentOffParked(row: PrimaryComponentRow): boolean {
  return row.agentIntent === "OFF"
    && row.agentState === "IDLE"
    && row.lastOutcome == null
    && row.blockers.length === 0;
}

function isPowerOffParked(row: PrimaryComponentRow): boolean {
  return row.powerIntent === "OFF"
    && row.agentIntent === "OFF"
    && row.agentState === "IDLE"
    && row.lastOutcome == null;
}

function resolvePreviewUrl(bodyPreviewUrl: string | undefined, containerName: string | null | undefined): string | undefined {
  if (bodyPreviewUrl !== undefined) return bodyPreviewUrl;
  if (!containerName) return undefined;
  return buildPreviewUrl(containerName) ?? undefined;
}

function getMissingBlockingRequiredSecrets(
  requiredSecrets: string | null | undefined,
  secrets: Array<{ key: string }> | null | undefined,
): string[] {
  const providedKeys = new Set((secrets ?? []).map((secret) => secret.key));
  return parseRequiredSecrets(requiredSecrets)
    .filter((entry) => entry.blocking !== false)
    .map((entry) => entry.key)
    .filter((key) => !providedKeys.has(key));
}

/**
 * POST /api/internal/projects/:id/terminal
 *
 * RA-098: Runner reports terminal state directly on Project.
 * RA-237: Uses applyStateChange for all state transitions.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = TerminalRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;
  const terminalDiagnostics = body.forensics
    ? { terminalForensics: body.forensics }
    : undefined;
  const telegramMiniAppUrl = body.telegramMiniAppUrl
    ?? (body.terminalState === "DEPLOYED"
      ? await resolveProjectTelegramMiniAppEntryUrl(prisma, id)
      : null);
  const previewServing = body.previewActual === "SERVING";
  const agentOffTerminal = isAgentOffTerminalReport(body.terminalState, body.reasonCode);
  const untypedGovernanceStop = isUntypedGovernanceStopReport(body.terminalState, body.reasonCode);
  const gracefulShutdownTerminal = isGracefulShutdownTerminalReport(body.terminalState, body.reasonCode);
  const keepRuntimeAlive = shouldKeepRuntimeAlive(
    body.terminalState,
    body.pauseReason,
    body.previewActual,
    body.reasonCode,
  );
  const shouldResetPreview = !keepRuntimeAlive && body.previewActual === undefined;
  const clearPreviewUrl = (body.previewActual !== undefined && !previewServing) || shouldResetPreview;
  const hasContainerName = Object.prototype.hasOwnProperty.call(body, "containerName");
  const hasWorkerHost = Object.prototype.hasOwnProperty.call(body, "workerHost");
  const resolvedPreviewUrl = clearPreviewUrl ? undefined : resolvePreviewUrl(body.previewUrl, body.containerName);

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      proposalId: true,
      requiredSecrets: true,
      budgetDebitedUsd: true,
      estimatedCostUsd: true,
      archivedAt: true,
      secrets: { select: { key: true } },
      budget: {
        select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const row = await requirePrimaryComponentRow(prisma, id);
  const terminalBlocker = inferTerminalBlocker(
    row,
    body.terminalState,
    body.pauseReason,
    body.reasonCode,
  );
  const observedAt = new Date();
  const observedRetryAt = resolveLoopRateLimitRetryAt({
    pauseReason: body.pauseReason,
    retryAt: body.retryAt ?? null,
    reason: body.reasonMessage ?? body.reasonCode ?? null,
  }, { referenceTime: observedAt }) ?? null;
  const budgetAlreadyBlocked = row.blockers.includes("BUDGET");
  const alreadyTerminalState = isAlreadyTerminal(row);
  const alreadyCompleted = isCompleted(row);
  const alreadyTerminalGracefulShutdown =
    (gracefulShutdownTerminal || untypedGovernanceStop) && isAlreadyTerminalLiveRuntime(row);
  const alreadyParkedAgentOff = agentOffTerminal && isAgentOffParked(row);
  const alreadyParkedPowerOff = isPowerOffTerminalReport(body.terminalState, body.reasonCode) && isPowerOffParked(row);
  const alreadyBlockedSameTerminalReport = isDuplicateBlockedTerminalReport(
    row,
    terminalBlocker,
    body,
    observedRetryAt,
  );
  const failedIterationParked = terminalBlocker == null
    && shouldParkFailedIteration(body.terminalState, body.pauseReason, body.previewActual)
    && row.agentState === "IDLE"
    && row.lastOutcome === "FAILED";

  // RA-125: DEPLOYED from runner wins over any non-COMPLETED terminal status
  const deployOverride = body.terminalState === "DEPLOYED" && alreadyTerminalState && !alreadyCompleted;

  if ((alreadyParkedAgentOff && previewServing) || alreadyParkedPowerOff || alreadyBlockedSameTerminalReport) {
    return NextResponse.json({ success: true, noop: true });
  }

  if (alreadyTerminalState && !deployOverride && !alreadyTerminalGracefulShutdown) {
    // Check if runner is sending the same terminal state — noop
    const isSameTerminal =
      (body.terminalState === "DEPLOYED" && alreadyCompleted) ||
      (agentOffTerminal && alreadyCompleted && row.agentIntent === "OFF") ||
      ((body.terminalState === "FAILED" || body.terminalState === "CANCELED")
        && failedIterationParked) ||
      (terminalBlocker != null
        && row.agentState === "IDLE"
        && row.blockers.includes(terminalBlocker));
    if (isSameTerminal) {
      return NextResponse.json({ success: true, noop: true });
    }
    return NextResponse.json({ error: `Project already terminal (agent=${row.agentState}, outcome=${row.lastOutcome})` }, { status: 409 });
  }

  const inputTokens = toNumberOrUndefined(body.inputTokens);
  const outputTokens = toNumberOrUndefined(body.outputTokens);
  const estimatedCostUsd = toNumberOrUndefined(body.estimatedCostUsd);
  const baseCostUsd = estimatedCostUsd ?? (typeof project.estimatedCostUsd === "number" ? project.estimatedCostUsd : undefined);
  const alreadyDebitedUsd = typeof project.budgetDebitedUsd === "number" ? project.budgetDebitedUsd : 0;
  const debitDeltaUsd = baseCostUsd && baseCostUsd > alreadyDebitedUsd
    ? baseCostUsd - alreadyDebitedUsd
    : 0;
  const nextBudgetDebitedUsd = baseCostUsd && baseCostUsd > alreadyDebitedUsd
    ? baseCostUsd
    : alreadyDebitedUsd;
  const projectedBudgetUsedUsd = (project.budget?.usedCreditsUsd ?? 0) + debitDeltaUsd;
  const terminalBudgetLimitExceeded =
    body.terminalState === "DEPLOYED" &&
    project.budget?.isEnabled === true &&
    project.budget.totalCreditsUsd > 0 &&
    projectedBudgetUsedUsd >= project.budget.totalCreditsUsd;
  const missingBlockingSecrets = getMissingBlockingRequiredSecrets(project.requiredSecrets, project.secrets);
  const terminalBlockingSecretsMissing =
    body.terminalState === "DEPLOYED" &&
    missingBlockingSecrets.length > 0;

  const updated = await prisma.$transaction(async (tx: TransactionClient) => {
    const now = new Date();
    let terminalPauseRetryAt: string | null = null;

    // Re-read row inside transaction for race safety
    const txRow = await requirePrimaryComponentRow(tx, id);
    const txAlreadyTerminal = isAlreadyTerminal(txRow);
    const txAlreadyTerminalGracefulShutdown =
      (gracefulShutdownTerminal || untypedGovernanceStop) && isAlreadyTerminalLiveRuntime(txRow);

    if (isDuplicateBlockedTerminalReport(txRow, terminalBlocker, body, observedRetryAt)) {
      return { noop: true };
    }
    if (txAlreadyTerminal && !deployOverride && !txAlreadyTerminalGracefulShutdown) return false;

    // Update Project-level fields
    await tx.project.updateMany({
      where: { id },
      data: {
        commitSha: body.commitSha || undefined,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        budgetDebitedUsd: nextBudgetDebitedUsd,
      },
    });

    // Ensure runtimeState is RUNNING if still ABSENT (race with started callback)
    if (txRow.runtimeState === "ABSENT") {
      await applyStateChange(tx, id, { type: "runtimeObserved", state: "RUNNING" }, {
        source: "runner",
        trigger: "terminal_lift",
        reason: "Lifting runtimeState to RUNNING before terminal transition",
      });
    }

    // Ensure agentState is RUNNING if still IDLE (race with progress callback)
    const freshRow = await requirePrimaryComponentRow(tx, id);
    let terminalRow = freshRow;
    if (
      freshRow.agentState === "IDLE"
      && freshRow.runtimeState === "RUNNING"
      && !agentOffTerminal
      && !gracefulShutdownTerminal
      && !(untypedGovernanceStop && freshRow.lastOutcome != null)
    ) {
      await applyStateChange(tx, id, { type: "agentTransition", state: "RUNNING" }, {
        source: "runner",
        trigger: "terminal_lift",
        reason: "Lifting agentState to RUNNING before terminal transition",
      });
      terminalRow = { ...freshRow, agentState: "RUNNING" };
    }

    // Apply the terminal state change
    const blocker = inferTerminalBlocker(
      terminalRow,
      body.terminalState,
      body.pauseReason,
      body.reasonCode,
    );
    if (agentOffTerminal) {
      // agent_off is a clean agent stop: preview may stay live, but authoritative
      // agent state must converge to OFF + IDLE without manufacturing terminal completion.
      await applyStateChange(tx, id, { type: "agentIntent", intent: "OFF" }, {
        source: "system",
        trigger: "terminal_agent_off_intent",
        reason: body.reasonMessage ?? "Terminal converged agentIntent=OFF",
      });
      await applyStateChange(tx, id, { type: "agentTransition", state: "IDLE" }, {
        source: "runner",
        trigger: "terminal_agent_off",
        reason: body.reasonMessage ?? body.reasonCode ?? "Agent stopped by OFF intent",
      });
    } else if (isPowerOffTerminalReport(body.terminalState, body.reasonCode)) {
      await applyStateChange(tx, id, { type: "agentIntent", intent: "OFF" }, {
        source: "system",
        trigger: "terminal_power_off_intent",
        reason: body.reasonMessage ?? "Terminal converged powerIntent=OFF",
      });
      await applyStateChange(tx, id, { type: "agentTransition", state: "IDLE" }, {
        source: "runner",
        trigger: "terminal_power_off",
        reason: body.reasonMessage ?? body.reasonCode ?? "App stopped by OFF intent",
      });
    } else if (gracefulShutdownTerminal) {
      await applyStateChange(tx, id, { type: "agentTransition", state: "IDLE" }, {
        source: "runner",
        trigger: "terminal_shutdown",
        reason: body.reasonMessage ?? body.reasonCode ?? "Runtime stopped by governance shutdown",
      });
    } else if (blocker) {
      const resolvedRetryAt = resolveLoopRateLimitRetryAt({
        pauseReason: body.pauseReason,
        retryAt: body.retryAt ?? null,
        reason: body.reasonMessage ?? body.reasonCode ?? null,
      }, { referenceTime: now }) ?? null;
      terminalPauseRetryAt = resolvedRetryAt;
      await parkAgentBlocked(
        tx,
        id,
        blocker,
        body.reasonMessage ?? body.reasonCode ?? blocker,
        "terminal_pause",
        { source: "runner", now, ...(terminalDiagnostics ? { diagnostics: terminalDiagnostics } : {}) },
      );
      if (resolvedRetryAt) {
        const retryAt = new Date(resolvedRetryAt);
        if (!Number.isNaN(retryAt.getTime())) {
          await updateComponentMetadata(tx, id, { retryAt }, {
            source: "runner",
            trigger: "terminal_pause_retry_at",
            reason: body.reasonMessage ?? body.reasonCode ?? blocker,
          });
        }
      }
    } else if (terminalBudgetLimitExceeded) {
      await parkAgentBlocked(
        tx,
        id,
        "BUDGET",
        "Budget exhausted before terminal success could be accepted",
        "terminal_budget_exhausted",
        { source: "runner", now, ...(terminalDiagnostics ? { diagnostics: terminalDiagnostics } : {}) },
      );
    } else if (terminalBlockingSecretsMissing) {
      await parkAgentBlocked(
        tx,
        id,
        "SECRETS",
        `Missing required secret(s): ${missingBlockingSecrets.join(", ")}`,
        "terminal_missing_secrets",
        { source: "runner", now, ...(terminalDiagnostics ? { diagnostics: terminalDiagnostics } : {}) },
      );
    } else if (body.terminalState === "DEPLOYED") {
      // DEPLOYED → agentTransition(IDLE, outcome=COMPLETED)
      await applyStateChange(tx, id, { type: "agentTransition", state: "IDLE", outcome: "COMPLETED" }, {
        source: "runner",
        trigger: "terminal_deployed",
      });
    } else if (untypedGovernanceStop) {
      await applyStateChange(tx, id, { type: "agentTransition", state: "IDLE" }, {
        source: "runner",
        trigger: "terminal_shutdown",
        reason: body.reasonMessage ?? body.reasonCode ?? "Runtime stopped by governance",
      });
    } else if (body.terminalState === "FAILED" || body.terminalState === "CANCELED") {
      // A failed/canceled iteration is not a live project state. Keep failure in history
      // and converge the loop back to IDLE so restart flows stay resident-loop based.
      await applyStateChange(tx, id, {
        type: "agentTransition",
        state: "IDLE",
        outcome: "FAILED",
      }, {
        source: "runner",
        trigger: `terminal_${body.terminalState.toLowerCase()}`,
        reason: body.reasonMessage ?? body.reasonCode ?? undefined,
        ...(terminalDiagnostics ? { diagnostics: terminalDiagnostics } : {}),
      });
    }

    // Update runtime state based on whether we keep the container alive
    if (!keepRuntimeAlive && freshRow.runtimeState === "RUNNING") {
      await applyStateChange(tx, id, { type: "runtimeObserved", state: "STOPPED" }, {
        source: "runner",
        trigger: "terminal_stop",
      });
    }

    // Update component metadata (preview, heartbeat, previewUrl)
    const metadataUpdate: Record<string, unknown> = {
      lastHeartbeat: now,
    };
    if (body.previewActual !== undefined) {
      metadataUpdate.previewHealth = body.previewActual === "SERVING" ? "HEALTHY" : body.previewActual === "ERROR" ? "UNHEALTHY" : "UNKNOWN";
      metadataUpdate.previewCheckedAt = now;
    }
    if (shouldResetPreview) {
      metadataUpdate.previewHealth = "UNKNOWN";
      metadataUpdate.previewCheckedAt = null;
    }
    if (clearPreviewUrl) {
      metadataUpdate.previewUrl = null;
    } else if (resolvedPreviewUrl !== undefined) {
      metadataUpdate.previewUrl = resolvedPreviewUrl;
    }
    if (hasContainerName) {
      metadataUpdate.containerName = body.containerName ?? null;
    }
    if (hasWorkerHost) {
      metadataUpdate.workerHost = body.workerHost ?? null;
    }
    await updateComponentMetadata(tx, id, metadataUpdate as Parameters<typeof updateComponentMetadata>[2], {
      source: "runner",
      trigger: "terminal_metadata",
    });

    // RA-116: Only set log from tailLog if the JSONL log is empty
    if (body.log) {
      const proj = await tx.project.findUnique({ where: { id }, select: { log: true } });
      if (!proj?.log) {
        await tx.project.update({ where: { id }, data: { log: body.log } });
      }
    }

    if (debitDeltaUsd > 0) {
      await tx.projectBudget.updateMany({
        where: { projectId: id },
        data: { usedCreditsUsd: { increment: debitDeltaUsd } },
      });
    }

    const governanceManualStop = isGovernanceManualStopReport(body.pauseReason, body.reasonCode, body.reasonMessage);
    if (terminalBlockingSecretsMissing) {
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "required_secret.missing",
        dedupeKey: `terminal-secrets:${missingBlockingSecrets.slice().sort().join(",")}`,
        payload: {
          requiredSecretKeys: missingBlockingSecrets,
          actionHref: buildProjectSecretsFocusHref(id, missingBlockingSecrets[0], { action: "provide" }),
        },
      });
    } else if (isWorkspaceDirtyBeforeSyncReport(body.pauseReason, body.reasonCode)) {
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "action.required",
        // RA-380: same episode guard as the retryable pause above
        // (isDuplicateBlockedTerminalReport returns true while the MANUAL blocker
        // is still on the row), so a per-day key only hides new episodes.
        dedupeKey: `terminal-workspace-dirty-before-sync:${now.toISOString()}`,
        payload: {
          reasonCode: "MANUAL",
          summary: body.reasonMessage ?? "Workspace has source changes that block runtime restore. Commit, move runtime data to ARENA_DATA_DIR, or resolve the dirty source files before retrying.",
        },
      });
    } else if (body.terminalState === "DEPLOYED" && !terminalBudgetLimitExceeded) {
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "work.completed",
        dedupeKey: `terminal-deployed:${body.commitSha || "no-commit"}:${now.toISOString()}`,
        payload: {
          previewUrl: resolvedPreviewUrl ?? txRow.previewUrl ?? undefined,
          telegramMiniAppUrl,
        },
      });
    } else if (blocker === "MANUAL" && !governanceManualStop) {
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "work.needs_evidence",
        // RA-380: keeps the per-day key on purpose. Unlike the retryable and
        // workspace-dirty pauses above, a plain MANUAL report is not suppressed by
        // isDuplicateBlockedTerminalReport, so this key is the only thing standing
        // between the operator and a repeat-report storm.
        dedupeKey: `terminal-manual-evidence:${body.reasonCode || "MANUAL"}:${terminalDedupeDay(now)}`,
        payload: {
          reasonCode: "MANUAL",
          summary: body.reasonMessage ?? undefined,
        },
      });
    } else if (isRetryablePauseBlocker(blocker)) {
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "action.required",
        // RA-380: a repeat report inside one pause episode never reaches here —
        // isDuplicateBlockedTerminalReport already noops it. So every report that
        // does reach here is a new episode and deserves its own notification. A
        // per-day key silently swallowed the second pause of the day and left the
        // operator looking at a hours-old message they had already acted on.
        dedupeKey: `terminal-retryable-pause:${blocker}:${body.reasonCode || "unknown"}:${terminalPauseRetryAt ?? now.toISOString()}`,
        payload: {
          reasonCode: blocker,
          summary: body.reasonMessage ?? undefined,
        },
      });
    } else if (
      !governanceManualStop
      && !agentOffTerminal
      && !gracefulShutdownTerminal
      && !isUntypedGovernanceStopReport(body.terminalState, body.reasonCode)
      && (body.terminalState === "FAILED" || body.terminalState === "CANCELED" || blocker || terminalBudgetLimitExceeded)
    ) {
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "work.failed",
        dedupeKey: `terminal-failed:${body.terminalState}:${body.reasonCode || blocker || "unknown"}:${now.toISOString()}`,
        payload: {
          reasonCode: terminalBudgetLimitExceeded ? "BUDGET" : blocker ?? body.reasonCode ?? body.terminalState,
        },
      });
    }

    return {
      budgetPaused: terminalBudgetLimitExceeded,
      secretsPaused: terminalBlockingSecretsMissing,
      pausedBlocker: blocker,
    };
  });

  if (!updated) {
    return NextResponse.json({ error: `Project already terminal (agent=${row.agentState}, outcome=${row.lastOutcome})` }, { status: 409 });
  }

  if ("noop" in updated) {
    return NextResponse.json({ success: true, noop: true });
  }

  if (deployOverride) {
    console.log(`[terminal] RA-125: DEPLOYED override for project ${id} (was agent=${row.agentState})`);
  }

  notifyProjectEvent(id, {
    type: "terminal",
    status: updated.budgetPaused
      ? "BUDGET"
      : updated.secretsPaused
        ? "SECRETS"
        : updated.pausedBlocker ?? body.terminalState,
    estimatedCostUsd: estimatedCostUsd ?? project.estimatedCostUsd ?? undefined,
  });
  const deployedPreviewUrl = clearPreviewUrl
    ? undefined
    : resolvedPreviewUrl ?? row.previewUrl ?? undefined;

  // RA-224: Fire-and-forget email notification for terminal states
  const notifiableStates: Record<string, () => Parameters<typeof notify>[0]> = {
    DEPLOYED: () => ({
      type: "project.deployed",
      projectId: id,
      projectName: project.name,
      previewUrl: deployedPreviewUrl,
    }),
    FAILED: () => ({
      type: "project.failed",
      projectId: id,
      projectName: project.name,
      error: body.reasonMessage ?? undefined,
    }),
    BUDGET: () => ({
      type: "project.paused_budget",
      projectId: id,
      projectName: project.name,
    }),
  };
  const makeEvent = updated.budgetPaused
    ? notifiableStates.BUDGET
    : updated.secretsPaused ? undefined
    : body.pauseReason ? notifiableStates[body.pauseReason] : notifiableStates[body.terminalState];
  if (makeEvent && !((body.pauseReason === "BUDGET" || updated.budgetPaused) && budgetAlreadyBlocked)) {
    notify(makeEvent()).catch((err) =>
      console.error("[notifications] terminal notify error:", err),
    );
  }

  revalidatePath("/");
  revalidatePath("/admin");

  revalidatePath(`/admin/projects/${id}`);
  revalidatePath(`/projects/${id}`);
  const proposalPath = getProjectProposalPath(project);
  if (proposalPath) revalidatePath(proposalPath);

  return NextResponse.json({ success: true });
}

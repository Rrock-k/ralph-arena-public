import type { Prisma } from "@prisma/client";

import { computeRetryAt, isRetryableBlocker } from "@/lib/retry-backoff";
import {
  applyStateChange,
  type ChangeContext,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";

function toRunnerSource(source: ChangeContext["source"]): ChangeContext["source"] {
  return source === "runner" || source === "worker" || source === "system"
    ? source
    : "system";
}

function toGovernanceSource(source: ChangeContext["source"]): ChangeContext["source"] {
  return source === "admin" || source === "cron" || source === "system"
    ? source
    : "system";
}

export async function parkAuthUnavailable(
  tx: Prisma.TransactionClient,
  projectId: string,
  reason: string,
  trigger: string,
): Promise<void> {
  const ctx = {
    source: "system" as const,
    trigger,
    reason,
  };

  const row = await requirePrimaryComponentRow(tx, projectId);
  const computedRetryAt = computeRetryAt("API", row.retryCount);
  const retryAt = row.retryAt && row.retryAt > computedRetryAt
    ? row.retryAt
    : computedRetryAt;

  await applyStateChange(tx, projectId, { type: "addBlocker", blocker: "API" }, ctx);
  await updateComponentMetadata(tx, projectId, { retryAt }, ctx);
}

export async function parkAgentBlocked(
  tx: Prisma.TransactionClient,
  projectId: string,
  blocker: string,
  reason: string,
  trigger: string,
  options?: {
    source?: ChangeContext["source"];
    now?: Date;
    scheduleRetry?: boolean;
    diagnostics?: Record<string, unknown>;
  },
): Promise<void> {
  const source = options?.source ?? "system";
  const ctx = {
    source,
    trigger,
    reason,
    ...(options?.diagnostics ? { diagnostics: options.diagnostics } : {}),
  };
  const runnerCtx = { ...ctx, source: toRunnerSource(source) };
  const governanceCtx = { ...ctx, source: toGovernanceSource(source) };

  const row = await requirePrimaryComponentRow(tx, projectId);
  if (row.agentState === "RUNNING") {
    await applyStateChange(tx, projectId, { type: "agentTransition", state: "IDLE" }, runnerCtx);
  }

  await applyStateChange(tx, projectId, { type: "addBlocker", blocker }, governanceCtx);

  await updateComponentMetadata(tx, projectId, isRetryableBlocker(blocker)
    ? {
        retryCount: row.retryCount + 1,
        retryAt: options?.scheduleRetry === false
          ? null
          : computeRetryAt(blocker, row.retryCount, options?.now),
      }
    : {
        retryAt: null,
      }, ctx);
}

export async function parkBudgetBlocked(
  tx: Prisma.TransactionClient,
  projectId: string,
  reason: string,
  trigger: string,
): Promise<void> {
  await applyStateChange(tx, projectId, { type: "addBlocker", blocker: "BUDGET" }, {
    source: "system",
    trigger,
    reason,
  });
}

export async function parkInfraBlocked(
  tx: Prisma.TransactionClient,
  projectId: string,
  reason: string,
  trigger: string,
  options?: { scheduleRetry?: boolean; source?: ChangeContext["source"] },
): Promise<void> {
  await parkAgentBlocked(tx, projectId, "INFRA", reason, trigger, options);
}

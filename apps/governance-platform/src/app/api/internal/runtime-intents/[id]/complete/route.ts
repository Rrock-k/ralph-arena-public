import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { RuntimeIntentCompleteRequestSchema } from "@arena/contracts";
import { prisma } from "@/lib/prisma";
import { isWorkerAuthorized } from "@/lib/internal-auth";
import { appendLifecycle } from "@/lib/log-writer";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { parkInfraBlocked } from "@/lib/claim-blockers";
import {
  applyStateChange,
  updateComponentMetadata,
  requirePrimaryComponentRow,
} from "@/lib/project-state-effects";
import { convergeRuntimeAbsent } from "@/lib/runtime-absence";
import { convergeRuntimeRunning } from "@/lib/runtime-running";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type TransactionClient = Prisma.TransactionClient;

function isIdempotentEnsureStoppedCompatibilityCompletion(
  intent: { action: string; runnerMode: string },
  body: { ok: false; error: string },
): boolean {
  if (intent.action !== "ensure_stopped" || intent.runnerMode !== "preview_only") {
    return false;
  }

  const message = body.error.toLowerCase();
  return message.includes("container already stopped")
    || message.includes("is already stopped")
    || message.includes("is not running");
}

async function markRuntimeStopped(
  tx: TransactionClient,
  projectId: string,
): Promise<void> {
  const row = await requirePrimaryComponentRow(tx, projectId);

  if (row.runtimeState === "RUNNING") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "STOPPED" }, {
      source: "worker",
      trigger: "runtime_intent_stopped",
    });
  }
  const freshRow = await requirePrimaryComponentRow(tx, projectId);
  if (freshRow.runtimeState === "STOPPED") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "ABSENT" }, {
      source: "worker",
      trigger: "runtime_intent_stopped",
    });
  }

  const parkedRow = await requirePrimaryComponentRow(tx, projectId);
  const shouldClearRuntimeIdentity = parkedRow.runtimeState === "ABSENT";

  await updateComponentMetadata(tx, projectId, {
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    ...(shouldClearRuntimeIdentity
      ? {
          containerName: null,
          previewUrl: null,
          workerHost: null,
          lastHeartbeat: null,
        }
      : {}),
  }, {
    source: "worker",
    trigger: "runtime_intent_stopped",
  });
}

async function markRuntimeRemoved(
  tx: TransactionClient,
  projectId: string,
): Promise<void> {
  await convergeRuntimeAbsent(tx, projectId, {
    trigger: "runtime_intent_removed",
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    clearIdentity: true,
  });
}

async function markRuntimeAbsent(
  tx: TransactionClient,
  projectId: string,
  error: string,
): Promise<void> {
  const row = await requirePrimaryComponentRow(tx, projectId);

  if (row.runtimeState !== "ABSENT") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "ABSENT" }, {
      source: "worker",
      trigger: "runtime_intent_error",
      reason: error,
    });
  }

  await updateComponentMetadata(tx, projectId, {
    previewHealth: "UNHEALTHY",
    previewCheckedAt: new Date(),
  }, {
    source: "worker",
    trigger: "runtime_intent_error",
  });
}

async function reconcileSupersededEnsureRunningFailure(
  tx: TransactionClient,
  projectId: string,
  reason: string,
): Promise<boolean> {
  const row = await requirePrimaryComponentRow(tx, projectId);
  if (row.powerIntent !== "OFF") {
    return false;
  }

  await convergeRuntimeAbsent(tx, projectId, {
    trigger: "runtime_intent_superseded",
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    clearIdentity: true,
  });

  if (row.blockers.includes("INFRA")) {
    await applyStateChange(tx, projectId, { type: "removeBlocker", blocker: "INFRA" }, {
      source: "system",
      trigger: "runtime_intent_superseded_clear_infra",
      reason,
    });
  }

  await updateComponentMetadata(tx, projectId, {
    retryAt: null,
    retryCount: 0,
  }, {
    source: "system",
    trigger: "runtime_intent_superseded_clear_retry",
    reason,
  });

  return true;
}

export async function POST(request: Request, context: RouteContext) {
  if (!isWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const raw = await request.json().catch(() => ({}));
  const body = RuntimeIntentCompleteRequestSchema.parse(raw);

  const result = await prisma.$transaction(async (tx: TransactionClient) => {
    const intent = await tx.runtimeIntent.findUnique({
      where: { id },
    });

    if (!intent) return { status: 404 as const, body: { error: "Runtime intent not found" } };
    if (intent.state !== "CLAIMED") {
      return { status: 409 as const, body: { error: `Runtime intent is ${intent.state}` } };
    }

    const treatAsSuccess = body.ok || isIdempotentEnsureStoppedCompatibilityCompletion(intent, body);

    if (treatAsSuccess) {
      if (body.ok && intent.action === "ensure_running" && body.actualRuntime !== "RUNNING") {
        return { status: 400 as const, body: { error: "ensure_running must complete with actualRuntime=RUNNING" } };
      }
      if (body.ok && intent.action !== "ensure_running" && body.actualRuntime === "RUNNING") {
        return { status: 400 as const, body: { error: `${intent.action} cannot complete with actualRuntime=RUNNING` } };
      }

      if (intent.action === "ensure_running") {
        if (!body.ok) {
          return { status: 400 as const, body: { error: "ensure_running completion requires runtime evidence" } };
        }

        await convergeRuntimeRunning(
          tx,
          intent.projectId,
          {
            host: intent.host,
            containerName: body.containerName ?? null,
            previewUrl: body.previewUrl ?? null,
            previewHealth: intent.runnerMode === "preview_only" ? "HEALTHY" : "UNKNOWN",
            previewCheckedAt:
              intent.runnerMode === "preview_only" ? new Date() : null,
            markStartedAt: intent.runnerMode === "agent_run",
            markAgentIdle: intent.runnerMode === "preview_only",
            runningTrigger: "runtime_intent_running",
            clearInfraTrigger: "runtime_intent_running_clear_infra",
            resetOutcomeTrigger: "runtime_intent_agent_run_reset_outcome",
            agentRunTrigger: "runtime_intent_running_agent_run",
          },
        );
      } else if (intent.action === "ensure_stopped") {
        await markRuntimeStopped(tx, intent.projectId);
      } else if (intent.action === "ensure_removed") {
        await markRuntimeRemoved(tx, intent.projectId);
      } else {
        return { status: 400 as const, body: { error: `Unsupported runtime intent action ${intent.action}` } };
      }

      await tx.runtimeIntent.update({
        where: { id: intent.id },
        data: {
          state: "SUCCEEDED",
          lockedUntil: null,
          error: null,
        },
      });
      return {
        status: 200 as const,
        body: { ok: true },
        lifecycleProjectId: intent.projectId,
        lifecycleEvent: "RUNTIME_RECONCILED",
      };
    }

    if (intent.action === "ensure_running") {
      const superseded = await reconcileSupersededEnsureRunningFailure(
        tx,
        intent.projectId,
        body.error,
      );
      if (superseded) {
        await tx.runtimeIntent.update({
          where: { id: intent.id },
          data: {
            state: "ABANDONED",
            lockedUntil: null,
            error: body.error,
          },
        });

        return {
          status: 200 as const,
          body: {
            ok: true,
            superseded: true,
          },
          lifecycleProjectId: intent.projectId,
          lifecycleEvent: "RUNTIME_RECONCILED",
        };
      }

      const retryScheduled = body.retryable === true;
      await markRuntimeAbsent(tx, intent.projectId, body.error);
      await parkInfraBlocked(
        tx,
        intent.projectId,
        body.error,
        "runtime_intent_infra_blocked",
        { scheduleRetry: retryScheduled },
      );
      await tx.runtimeIntent.update({
        where: { id: intent.id },
        data: {
          state: retryScheduled ? "FAILED" : "ABANDONED",
          lockedUntil: null,
          error: body.error,
        },
      });

      return {
        status: 200 as const,
        body: {
          ok: true,
          retryScheduled,
        },
        lifecycleProjectId: intent.projectId,
        lifecycleEvent: "RUNTIME_RECONCILE_FAILED",
      };
    }

    const retryScheduled = body.retryable === true;
    await markRuntimeAbsent(tx, intent.projectId, body.error);
    await tx.runtimeIntent.update({
      where: { id: intent.id },
      data: {
        state: retryScheduled ? "FAILED" : "ABANDONED",
        lockedUntil: null,
        error: body.error,
      },
    });

    return {
      status: 200 as const,
      body: {
        ok: true,
        retryScheduled,
      },
      lifecycleProjectId: intent.projectId,
      lifecycleEvent: "RUNTIME_RECONCILE_FAILED",
    };
  });

  if (result.status === 200 && "lifecycleProjectId" in result) {
    revalidatePath("/admin");
    notifyProjectChanged(result.lifecycleProjectId);
    appendLifecycle(result.lifecycleProjectId, result.lifecycleEvent).catch(() => {});
  }

  return NextResponse.json(result.body, { status: result.status });
}

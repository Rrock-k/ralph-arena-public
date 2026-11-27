import type { Prisma } from "@prisma/client";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";
import { getRetryableBlocker } from "@/lib/retry-backoff";

type TransactionClient = Prisma.TransactionClient;

type ConvergeRuntimeRunningOptions = {
  host: string;
  containerName: string | null;
  previewUrl: string | null;
  previewHealth: "HEALTHY" | "UNKNOWN";
  previewCheckedAt: Date | null;
  markStartedAt: boolean;
  markAgentIdle?: boolean;
  runningTrigger: string;
  clearInfraTrigger: string;
  resetOutcomeTrigger?: string;
  agentRunTrigger?: string;
};

export async function convergeRuntimeRunning(
  tx: TransactionClient,
  projectId: string,
  options: ConvergeRuntimeRunningOptions,
): Promise<void> {
  let row = await requirePrimaryComponentRow(tx, projectId);

  if (options.markStartedAt && row.lastOutcome != null) {
    if (!options.resetOutcomeTrigger) {
      throw new Error("resetOutcomeTrigger is required when markStartedAt=true");
    }
    await applyStateChange(tx, projectId, { type: "resetOutcome" }, {
      source: "system",
      trigger: options.resetOutcomeTrigger,
    });
    row = await requirePrimaryComponentRow(tx, projectId);
  }

  if (row.runtimeState === "STOPPED") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "ABSENT" }, {
      source: "worker",
      trigger: options.runningTrigger,
    });
    row = await requirePrimaryComponentRow(tx, projectId);
  }

  if (row.runtimeState === "ABSENT") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "RUNNING" }, {
      source: "worker",
      trigger: options.runningTrigger,
    });
    row = await requirePrimaryComponentRow(tx, projectId);
  }

  const clearStaleInfra = row.blockers.includes("INFRA");
  let clearRetrySchedule = false;
  if (clearStaleInfra) {
    await applyStateChange(tx, projectId, { type: "removeBlocker", blocker: "INFRA" }, {
      source: "system",
      trigger: options.clearInfraTrigger,
    });
    row = await requirePrimaryComponentRow(tx, projectId);
    clearRetrySchedule = getRetryableBlocker(row.blockers) == null;
  }

  if (options.markStartedAt) {
    if (!options.agentRunTrigger) {
      throw new Error("agentRunTrigger is required when markStartedAt=true");
    }
    row = await requirePrimaryComponentRow(tx, projectId);
    if (row.agentState !== "RUNNING") {
      await applyStateChange(tx, projectId, { type: "agentTransition", state: "RUNNING" }, {
        source: "worker",
        trigger: options.agentRunTrigger,
      });
    }
  } else if (options.markAgentIdle) {
    if (row.agentState !== "IDLE") {
      await applyStateChange(tx, projectId, { type: "agentTransition", state: "IDLE" }, {
        source: "worker",
        trigger: options.runningTrigger,
      });
    }
  }

  await updateComponentMetadata(tx, projectId, {
    previewHealth: options.previewHealth,
    previewCheckedAt: options.previewCheckedAt,
    containerName: options.containerName,
    previewUrl: options.previewUrl,
    workerHost: options.host,
    lastHeartbeat: new Date(),
    ...(clearRetrySchedule ? { retryAt: null, retryCount: 0 } : {}),
  }, {
    source: "worker",
    trigger: options.runningTrigger,
  });

}

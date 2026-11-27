import type { Prisma } from "@prisma/client";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";

type TransactionClient = Prisma.TransactionClient;

type ConvergeRuntimeAbsentOptions = {
  trigger: string;
  previewHealth: "UNKNOWN" | "UNHEALTHY";
  previewCheckedAt: Date | null;
  clearIdentity: boolean;
};

export async function convergeRuntimeAbsent(
  tx: TransactionClient,
  projectId: string,
  options: ConvergeRuntimeAbsentOptions,
): Promise<void> {
  const row = await requirePrimaryComponentRow(tx, projectId);

  if (row.runtimeState === "RUNNING") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "STOPPED" }, {
      source: "worker",
      trigger: options.trigger,
    });
  }

  const freshRow = await requirePrimaryComponentRow(tx, projectId);
  if (freshRow.runtimeState === "STOPPED") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "ABSENT" }, {
      source: "worker",
      trigger: options.trigger,
    });
  }

  await updateComponentMetadata(tx, projectId, {
    previewHealth: options.previewHealth,
    previewCheckedAt: options.previewCheckedAt,
    ...(options.clearIdentity
      ? {
          containerName: null,
          previewUrl: null,
          workerHost: null,
          lastHeartbeat: null,
        }
      : {}),
  }, {
    source: "worker",
    trigger: options.trigger,
  });
}

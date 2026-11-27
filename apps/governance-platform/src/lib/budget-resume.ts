import { BUDGET_THRESHOLD_USD } from "@/lib/project-budget";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  resetComponentForFreshStart,
  type Db,
} from "@/lib/project-state-effects";

/**
 * RA-237: Resume flow for budget-paused projects.
 *
 * Budget subsystem owns the BUDGET blocker. When budget is topped up,
 * we must restore a claimable tuple explicitly because the runner may
 * already be gone while the preview container is still alive.
 *
 * Called after budget increase inside the same DB transaction as budget update.
 */
export async function tryAutoResumePausedRun(
  tx: Db,
  projectId: string,
  remainingUsd: number,
  opts: { allowManagedVpsResume?: boolean; allowUserProviderRunResume?: boolean } = {},
): Promise<string | null> {
  if (remainingUsd <= BUDGET_THRESHOLD_USD) {
    return null;
  }

  const row = await requirePrimaryComponentRow(tx, projectId).catch(() => null);
  if (!row) return null;
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { runnerBackend: true },
  }).catch(() => null);
  if (((project?.runnerBackend ?? "local") === "vps" || row.vpsHostId) && opts.allowManagedVpsResume !== true) {
    return null;
  }
  if (opts.allowUserProviderRunResume === false) {
    return null;
  }

  // Only resume if paused with BUDGET blocker
  if (!row.blockers.includes("BUDGET")) return null;

  const remainingBlockers = row.blockers.filter((blocker) => blocker !== "BUDGET");
  const resumeCtx = { source: "cron" as const, trigger: "budget_resume", reason: "budget_top_up" };
  const repairCtx = {
    source: "system" as const,
    trigger: "budget_resume",
    reason: "normalize runtime identity after budget resume",
  };

  await applyStateChange(tx, projectId, { type: "removeBlocker", blocker: "BUDGET" }, resumeCtx);

  await resetComponentForFreshStart(tx, projectId, repairCtx);

  // If power was OFF (pre-run budget pause), turn back ON
  if (remainingBlockers.length === 0 && row.powerIntent === "OFF") {
    await applyStateChange(tx, projectId, { type: "power", intent: "ON" }, resumeCtx);
  }

  if (remainingBlockers.length === 0) {
    await tx.runLog.create({
      data: {
        projectId,
        event: "PROVISIONING",
        detail: JSON.stringify({ trigger: "budget_resume" }),
      },
    });
    return projectId;
  }

  return null;
}

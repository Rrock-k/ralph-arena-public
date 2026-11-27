import {
  getAppComponent,
  getOpsDisplayStatus,
  isPausedPreviewCohort,
  type OpsDisplayProject,
} from "@/lib/operator-display";

type MySurfaceProject = OpsDisplayProject;

export function shouldShowMyDashboardLivePill(
  project: MySurfaceProject,
): boolean {
  return getOpsDisplayStatus(project) === "LIVE";
}

export function getMyProjectPausedRecoveryAction(
  project: MySurfaceProject,
): "powerOn" | "agentOn" | null {
  if (project.archivedAt) return null;
  if (isPausedPreviewCohort(project)) return "agentOn";
  if (getOpsDisplayStatus(project) !== "PAUSED") return null;

  const comp = getAppComponent(project);
  if (!comp) return null;

  return comp.powerIntent === "OFF" ? "powerOn" : "agentOn";
}

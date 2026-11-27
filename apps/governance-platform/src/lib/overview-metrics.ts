import { hasWorkingAgentLoop } from "@/lib/agent-loop-activity";
import {
  getAppComponent,
  getOpsDisplayStatus,
  type OperatorDisplayComponent,
} from "@/lib/operator-display";

export type OverviewMetricsProject = {
  archivedAt?: string | Date | null;
  status?: string | null;
  estimatedCostUsd?: number | null;
  app?: OperatorDisplayComponent | null;
  components?: OperatorDisplayComponent[] | null;
};

export type OverviewMetrics = {
  totalProjects: number;
  activeRuns: number;
  deployedCount: number;
  failedCount: number;
  totalCostUsd: number;
};

export function computeOverviewMetrics(projects: OverviewMetricsProject[]): OverviewMetrics {
  let activeRuns = 0;
  let deployedCount = 0;
  let failedCount = 0;
  let totalCostUsd = 0;

  for (const project of projects) {
    const displayStatus = getOpsDisplayStatus(project);
    const comp = getAppComponent(project);
    if (displayStatus === "LIVE") deployedCount++;
    if (hasWorkingAgentLoop(project)) activeRuns++;
    if (!project.archivedAt && displayStatus === "LIVE" && comp?.lastOutcome === "FAILED") failedCount++;
    totalCostUsd += project.estimatedCostUsd ?? 0;
  }

  return {
    totalProjects: projects.length,
    activeRuns,
    deployedCount,
    failedCount,
    totalCostUsd,
  };
}

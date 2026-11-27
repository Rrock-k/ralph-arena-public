import { computeOverviewMetrics } from "@/lib/overview-metrics";
import type { OpsMetrics, OpsProject } from "./OpsDashboard";

export function computeOpsMetrics(projects: OpsProject[]): OpsMetrics {
  return computeOverviewMetrics(projects);
}

import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

type FleetTupleAudit = {
  totals?: {
    scannedProjects?: number;
    flaggedProjects?: number;
    distinctClasses?: number;
  };
  classes?: Array<{
    code?: string;
    count?: number;
    severity?: string;
    meaning?: string;
    recommendedAction?: string;
    recommendedTool?: string | null;
  }>;
};

type SystemOverview = {
  metrics?: {
    totalProjects?: number;
  };
  workers?: Array<{
    host?: string;
    parityStatus?: string | null;
    actionableParityReasons?: string[] | null;
  }>;
  projects?: Array<{
    id?: string;
    name?: string;
    visibility?: string | null;
    archivedAt?: string | null;
    app?: {
      powerIntent?: string | null;
      agentIntent?: string | null;
      runtimeState?: string | null;
      agentState?: string | null;
      previewHealth?: string | null;
      blockers?: string[] | null;
    } | null;
  }>;
};

type FleetSummary = {
  truth: {
    totalProjects: number;
    runningHealthy: number;
    parked: number;
    activeBroken: number;
    archived: number;
    activeAgentRuns: number;
    featuredHealthy: number;
    publicHealthy: number;
    workerServiceDriftCount: number;
    flaggedProjects: number;
    distinctResidualClasses: number;
  };
  classification: {
    status: "healthy_live_fleet" | "residual_damage_present";
    residualCohorts: Array<{
      code: string;
      count: number;
      severity: string;
      meaning: string;
    }>;
  };
  why: string[];
  allowedActions: string[];
  recommendedNextAction: string;
  operatorNotes: string[];
};

export function registerFleetSummaryTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("fleet_summary", {
    description:
      "Summarize the live project fleet in operator language. " +
      "Reports healthy live rows, parked rows, active broken rows, and residual cohorts using current governance truth.",
    inputSchema: {
      includeArchived: z.boolean().optional().describe("Include archived projects in raw scanning and counts (default: true)"),
      limitExamples: z.number().int().min(1).max(10).optional().describe("Tuple-audit example cap (default: 3)"),
    },
  }, async ({ includeArchived, limitExamples }) => {
    try {
      const [overview, tupleAudit] = await Promise.all([
        ctx.governance.getSystemOverview() as Promise<SystemOverview>,
        ctx.governance.getFleetTupleAudit({
          includeArchived: includeArchived ?? true,
          limitExamples: limitExamples ?? 3,
        }) as Promise<FleetTupleAudit>,
      ]);

      return jsonResult(buildFleetSummary(overview, tupleAudit));
    } catch (error) {
      return errorResult("Failed to build fleet summary", toErrorMessage(error));
    }
  });
}

export function buildFleetSummary(overview: SystemOverview, tupleAudit: FleetTupleAudit): FleetSummary {
  const projects = Array.isArray(overview.projects) ? overview.projects : [];

  let runningHealthy = 0;
  let parked = 0;
  let activeBroken = 0;
  let archived = 0;
  let activeAgentRuns = 0;
  let featuredHealthy = 0;
  let publicHealthy = 0;
  const workers = Array.isArray(overview.workers) ? overview.workers : [];
  const workersWithGenerationDrift = workers.filter((worker) =>
    worker?.parityStatus === "mismatch"
      && Array.isArray(worker.actionableParityReasons)
      && worker.actionableParityReasons.length > 0,
  );
  const workerServiceDriftCount = workersWithGenerationDrift.length;

  for (const project of projects) {
    const app = project.app ?? null;
    const powerIntent = app?.powerIntent ?? null;
    const agentIntent = app?.agentIntent ?? null;
    const runtimeState = app?.runtimeState ?? null;
    const agentState = app?.agentState ?? null;
    const previewHealth = app?.previewHealth ?? null;
    const isArchived = project.archivedAt != null;
    const isHealthyLive = runtimeState === "RUNNING" && previewHealth === "HEALTHY";

    if (isArchived) archived += 1;
    if (isHealthyLive) {
      runningHealthy += 1;
      if (project.visibility === "featured") featuredHealthy += 1;
      if (project.visibility === "public") publicHealthy += 1;
    }
    if (
      !isArchived &&
      powerIntent === "OFF" &&
      agentIntent === "OFF" &&
      runtimeState === "ABSENT" &&
      agentState === "IDLE"
    ) {
      parked += 1;
    }
    if (!isArchived && powerIntent === "ON" && !isHealthyLive) {
      activeBroken += 1;
    }
    if (!isArchived && runtimeState === "RUNNING" && agentState === "RUNNING") {
      activeAgentRuns += 1;
    }
  }

  const residualCohorts = (tupleAudit.classes ?? []).map((entry) => ({
    code: entry.code ?? "unknown",
    count: entry.count ?? 0,
    severity: entry.severity ?? "unknown",
    meaning: entry.meaning ?? "unknown residual cohort",
  }));

  const status: FleetSummary["classification"]["status"] =
    activeBroken === 0 ? "healthy_live_fleet" : "residual_damage_present";

  const why = activeBroken === 0
    ? [
        "No non-archived rows currently sit in an active broken state.",
        workerServiceDriftCount > 0
          ? activeAgentRuns > 0
            ? `${workerServiceDriftCount} worker service(s) still report stale generation, but ${activeAgentRuns} active agent run(s) must finish before worker restart.`
            : `${workerServiceDriftCount} worker service(s) still report stale generation and need maintenance.`
          : residualCohorts.length > 0
            ? "Remaining tuple-audit findings are residual cohorts, not broad live-fleet breakage."
            : "Remaining non-live rows are parked, archived, or special-case cohorts.",
      ]
    : [
        `${activeBroken} non-archived row(s) still have power ON without converging to RUNNING + HEALTHY.`,
        residualCohorts.length > 0
          ? `Tuple audit still reports ${residualCohorts.length} residual cohort class(es).`
          : "No tuple-audit residual class matched, so broken rows need direct inspection.",
      ];

  const allowedActions = activeBroken === 0
    ? [
        "no_action",
        "inspect_parked_cohorts",
        ...(workerServiceDriftCount > 0
          ? activeAgentRuns === 0
            ? ["restart_worker_service"]
            : ["wait_for_worker_maintenance_window"]
          : []),
        "cleanup_orphans",
      ]
    : uniqueStrings([
        ...((tupleAudit.classes ?? []).map((entry) => entry.recommendedAction).filter(isNonEmptyString)),
        "inspect_active_broken_rows",
      ]);

  const recommendedNextAction = activeBroken === 0
    ? (
        workerServiceDriftCount > 0
          ? activeAgentRuns === 0
            ? "restart_worker_service"
            : "wait_for_worker_maintenance_window"
          : residualCohorts.length > 0
            ? "inspect_parked_cohorts"
            : "no_action"
      )
    : ((tupleAudit.classes ?? []).slice().sort(byCountDesc)[0]?.recommendedAction ?? "inspect_active_broken_rows");

  const operatorNotes = [
    `Active agent runs: ${activeAgentRuns}.`,
    `Featured healthy: ${featuredHealthy}. Public healthy: ${publicHealthy}.`,
    workerServiceDriftCount > 0
      ? `Workers with stale service generation: ${workersWithGenerationDrift.map((worker) => worker.host ?? "unknown").join(", ")}.`
      : "No worker service generation drift currently flagged.",
    residualCohorts.length > 0
      ? `Top residual cohort: ${residualCohorts.slice().sort(byCountDesc)[0]?.code ?? "unknown"}.`
      : "No tuple-audit residual cohorts currently flagged.",
  ];

  return {
    truth: {
      totalProjects: overview.metrics?.totalProjects ?? projects.length,
      runningHealthy,
      parked,
      activeBroken,
      archived,
      activeAgentRuns,
      featuredHealthy,
      publicHealthy,
      workerServiceDriftCount,
      flaggedProjects: tupleAudit.totals?.flaggedProjects ?? 0,
      distinctResidualClasses: tupleAudit.totals?.distinctClasses ?? residualCohorts.length,
    },
    classification: {
      status,
      residualCohorts,
    },
    why,
    allowedActions,
    recommendedNextAction,
    operatorNotes,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function byCountDesc(a: { count?: number }, b: { count?: number }) {
  return (b.count ?? 0) - (a.count ?? 0);
}

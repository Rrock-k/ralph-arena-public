import { NextResponse } from "next/server";
import {
  requestProjectPreviewRefreshInternal,
  requestProjectRuntimeRecreateInternal,
} from "@/app/actions/runtime-maintenance";
import { getWorkerSnapshot } from "@/lib/control-plane";
import { isCronAuthorized } from "@/lib/internal-auth";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { prisma } from "@/lib/prisma";
import { getActionableRuntimeGenerationReasons } from "@/lib/runtime-generation";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_COOLDOWN_MS = 15 * 60_000;
const HEARTBEAT_FRESH_WINDOW_MS = 15 * 60_000;
const SCHEDULER_SAFE_BLOCKERS = new Set(["RATE_LIMIT", "BUDGET", "API"]);
const CRON_REASON = "resident_runtime_auto_maintenance";

type MaintenanceAction = "preview_refresh" | "recreate_runtime";
type MaintenanceReason = "preview_serving_stale" | "runtime_generation_stale";
type MaintenanceCohort =
  | "blocked_waiting_preview"
  | "retained_completed_preview"
  | "retained_failed_preview";

type RequestBody = {
  dryRun?: boolean;
  limit?: number;
  projectIds?: string[];
};

function parseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function parseProjectIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

function hasOnlySchedulerSafeBlockers(blockers: string[]): boolean {
  return blockers.length > 0 && blockers.every((blocker) => SCHEDULER_SAFE_BLOCKERS.has(blocker));
}

function classifyMaintenanceCohort(component: {
  powerIntent?: string | null;
  agentIntent?: string | null;
  runtimeState?: string | null;
  agentState?: string | null;
  lastOutcome?: string | null;
  blockers?: string[] | null;
} | null | undefined): { cohort: MaintenanceCohort; blockers: string[] } | null {
  if (!component) return null;
  if (component.powerIntent !== "ON") return null;
  if (component.agentIntent !== "ON") return null;
  if (component.runtimeState !== "RUNNING") return null;
  if (component.agentState !== "IDLE") return null;

  const blockers = Array.isArray(component.blockers) ? component.blockers.map(String) : [];
  if (hasOnlySchedulerSafeBlockers(blockers)) {
    return {
      cohort: "blocked_waiting_preview",
      blockers,
    };
  }
  if (blockers.length > 0) return null;
  if (component.lastOutcome === "COMPLETED") {
    return {
      cohort: "retained_completed_preview",
      blockers,
    };
  }
  if (component.lastOutcome === "FAILED") {
    return {
      cohort: "retained_failed_preview",
      blockers,
    };
  }
  return null;
}

function hasFreshHeartbeat(lastHeartbeat: Date | string | null | undefined, now: number): boolean {
  if (!lastHeartbeat) return false;
  const ts = Date.parse(String(lastHeartbeat));
  if (!Number.isFinite(ts)) return false;
  return ts >= now - HEARTBEAT_FRESH_WINDOW_MS;
}

function needsBlockedMaintenance(
  component: {
    previewHealth?: string | null;
    lastHeartbeat?: Date | string | null;
  },
  now: number,
): boolean {
  if (component.previewHealth !== "HEALTHY") {
    return true;
  }
  return !hasFreshHeartbeat(component.lastHeartbeat, now);
}

function actionPriority(action: MaintenanceAction): number {
  return action === "recreate_runtime" ? 0 : 1;
}

async function readBody(request: Request): Promise<RequestBody> {
  const text = await request.text();
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as RequestBody;
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await readBody(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body" },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun === true;
  const limit = parseLimit(body.limit);
  const projectIds = parseProjectIds(body.projectIds);
  const now = Date.now();

  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(projectIds ? { id: { in: projectIds } } : {}),
      components: {
        some: {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
        },
      },
    },
    select: {
      id: true,
      name: true,
      components: {
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: {
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
          lastOutcome: true,
          previewHealth: true,
          previewCheckedAt: true,
          lastHeartbeat: true,
        },
      },
    },
  });

  const skippedProjects: Array<{ projectId: string; reason: string }> = [];

  const baseCandidates = projects
    .map((project) => {
      const component = getPrimaryLifecycleComponent(project);
      if (!component) return null;
      const maintenance = classifyMaintenanceCohort(component);
      if (!maintenance) return null;
      return {
        projectId: project.id,
        projectName: project.name,
        cohort: maintenance.cohort,
        blockers: maintenance.blockers,
        previewHealth: component.previewHealth ?? null,
        previewCheckedAt: component.previewCheckedAt ?? null,
        lastHeartbeat: component.lastHeartbeat ?? null,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const cooldownFloor = new Date(Date.now() - REQUEST_COOLDOWN_MS);
  const recentRequests = baseCandidates.length > 0
    ? await (prisma as any).projectEvent.findMany({
        where: {
          // RA-386: these two types now live in different directions —
          // `preview_refresh_requested` is a runner command (`in`),
          // `runtime_recreate_requested` is governance's own mark (`internal`).
          // The cooldown cares about both, and the types are unambiguous on
          // their own, so it selects by type and leaves direction alone.
          type: { in: ["preview_refresh_requested", "runtime_recreate_requested"] },
          projectId: { in: baseCandidates.map((candidate) => candidate.projectId) },
          createdAt: { gte: cooldownFloor },
        },
        orderBy: { createdAt: "desc" },
        select: {
          projectId: true,
          payload: true,
          createdAt: true,
        },
      })
    : [];

  const coolingProjectIds = new Set<string>(
    recentRequests
      .filter((event: { payload?: { source?: unknown; reason?: unknown } | null }) => {
        const payload = event.payload ?? {};
        return payload.source === "cron" && payload.reason === CRON_REASON;
      })
      .map((event: { projectId: string }) => event.projectId),
  );

  const coolingCandidates = baseCandidates.filter((candidate) => coolingProjectIds.has(candidate.projectId));
  skippedProjects.push(...coolingCandidates.map((candidate) => ({
    projectId: candidate.projectId,
    reason: "cooldown_active",
  })));

  const resolvedCandidates = [];
  for (const candidate of baseCandidates) {
    if (coolingProjectIds.has(candidate.projectId)) {
      continue;
    }

    const worker = await getWorkerSnapshot(candidate.projectId, { tail: 1 });
    const actionableRuntimeGenerationReasons = getActionableRuntimeGenerationReasons(worker?.runtimeGeneration);
    if (actionableRuntimeGenerationReasons.length > 0) {
      resolvedCandidates.push({
        ...candidate,
        action: "recreate_runtime" as const,
        maintenanceReason: "runtime_generation_stale" as const,
        runtimeGenerationReasons: actionableRuntimeGenerationReasons,
      });
      continue;
    }

    const component = {
      previewHealth: candidate.previewHealth,
      lastHeartbeat: candidate.lastHeartbeat,
    };
    if (candidate.cohort === "blocked_waiting_preview" && needsBlockedMaintenance(component, now)) {
      resolvedCandidates.push({
        ...candidate,
        action: "preview_refresh" as const,
        maintenanceReason: "preview_serving_stale" as const,
        runtimeGenerationReasons: [],
      });
      continue;
    }

    if (worker?.runtimeGeneration?.status === "mismatch") {
      skippedProjects.push({
        projectId: candidate.projectId,
        reason: "runtime_generation_truth_incomplete",
      });
      continue;
    }

    skippedProjects.push({
      projectId: candidate.projectId,
      reason: "preview_fresh",
    });
  }

  const candidates = resolvedCandidates
    .sort((a, b) => {
      const actionDelta = actionPriority(a.action) - actionPriority(b.action);
      if (actionDelta !== 0) return actionDelta;
      const aTs = a.lastHeartbeat
        ? Date.parse(String(a.lastHeartbeat))
        : (a.previewCheckedAt ? Date.parse(String(a.previewCheckedAt)) : Number.NEGATIVE_INFINITY);
      const bTs = b.lastHeartbeat
        ? Date.parse(String(b.lastHeartbeat))
        : (b.previewCheckedAt ? Date.parse(String(b.previewCheckedAt)) : Number.NEGATIVE_INFINITY);
      if (aTs !== bTs) return aTs - bTs;
      return a.projectId.localeCompare(b.projectId);
    })
    .slice(0, limit);

  const requested: string[] = [];
  const failed: Array<{ projectId: string; error: string }> = [];

  if (!dryRun) {
    for (const candidate of candidates) {
      const result = candidate.action === "recreate_runtime"
          ? await requestProjectRuntimeRecreateInternal(candidate.projectId, {
              source: "cron",
              reason: CRON_REASON,
              maintenanceReason: candidate.maintenanceReason,
              internalActionToken: INTERNAL_ACTION_TOKEN,
            })
          : await requestProjectPreviewRefreshInternal(candidate.projectId, {
              source: "cron",
              reason: CRON_REASON,
              maintenanceReason: candidate.maintenanceReason,
              internalActionToken: INTERNAL_ACTION_TOKEN,
            });
      if (result.success) {
        requested.push(candidate.projectId);
        continue;
      }
      failed.push({
        projectId: candidate.projectId,
        error: result.error ?? "Preview refresh failed",
      });
    }
  }

  return NextResponse.json({
    dryRun,
    selected: candidates.length,
    requested: requested.length,
    failed: failed.length,
    candidates: candidates.map(({ previewCheckedAt: _previewCheckedAt, lastHeartbeat: _lastHeartbeat, ...candidate }) => candidate),
    requestedProjectIds: requested,
    failedProjects: failed,
    skippedProjects,
  });
}

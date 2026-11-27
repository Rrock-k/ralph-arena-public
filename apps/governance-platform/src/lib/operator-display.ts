import { getPublicDisplayStatus } from "@/lib/project-lifecycle";
import { formatRetryHint, formatRetryHintTooltip } from "@/lib/retry-status";
import { hasLivePreviewFact } from "@/lib/preview-state";

export type OperatorDisplayComponent = {
  kind?: string | null;
  runtimeConfig?: unknown;
  containerName?: string | null;
  workerHost?: string | null;
  previewUrl?: string | null;
  previewHealth?: string | null;
  lastHeartbeat?: string | Date | null;
  powerIntent?: string | null;
  agentIntent?: string | null;
  runtimeState?: string | null;
  agentState?: string | null;
  blockers?: string[] | null;
  lastOutcome?: string | null;
  retryAt?: string | Date | null;
};

export type OperatorDisplayProject = {
  status?: string | null;
  archivedAt?: string | Date | null;
  app?: OperatorDisplayComponent | null;
  components?: OperatorDisplayComponent[] | null;
};

export type OpsComponentState = OperatorDisplayComponent;
export type OpsDisplayProject = OperatorDisplayProject;

const LEGACY_STATUS_ALIASES: Record<string, string> = {
  DEPLOYED: "LIVE",
  SUCCEEDED: "LIVE",
  RUNNING: "BUILDING",
  PROVISIONING: "BUILDING",
  QUEUED: "BUILDING",
  STARTING: "BUILDING",
  PAUSING: "BUILDING",
  SLEEPING: "PAUSED",
};

export const OPS_STATUS_PRIORITY: Record<string, number> = {
  LIVE: 0,
  BUILDING: 1,
  PROVISIONING: 2,
  QUEUED: 3,
  AGENT_OFF: 4,
  PAUSED: 5,
  FAILED: 10,
  CANCELED: 11,
};

export function getAppComponent(
  project: { app?: OperatorDisplayComponent | null; components?: OperatorDisplayComponent[] | null },
): OperatorDisplayComponent | null {
  if ("app" in project) {
    return project.app ?? null;
  }
  return project.components?.find((component) => component.kind === "app") ?? null;
}

export function canonicalizeOpsStatus(status: string): string {
  return LEGACY_STATUS_ALIASES[status] ?? status;
}

export function getOpsDisplayStatus(project: OperatorDisplayProject): string {
  const app = getAppComponent(project);
  if (app) {
    return getPublicDisplayStatus({
      archivedAt: project.archivedAt,
      app: {
        kind: "app",
        previewUrl: app.previewUrl ?? null,
        previewHealth: app.previewHealth ?? null,
        containerName: app.containerName ?? null,
        powerIntent: app.powerIntent ?? null,
        agentIntent: app.agentIntent ?? null,
        runtimeState: app.runtimeState ?? "ABSENT",
        agentState: app.agentState ?? null,
        lastOutcome: app.lastOutcome ?? null,
      },
    });
  }

  return canonicalizeOpsStatus(project.status ?? "PAUSED");
}

export function isPausedPreviewCohort(
  project: { app?: OperatorDisplayComponent | null; components?: OperatorDisplayComponent[] | null },
): boolean {
  const app = getAppComponent(project);
  if (!app) return false;
  if ((app.blockers?.length ?? 0) > 0) return false;
  if (app.powerIntent !== "ON") return false;
  if (app.agentIntent !== "OFF") return false;
  if (app.runtimeState !== "RUNNING") return false;
  if (app.agentState !== "IDLE") return false;
  if (app.lastOutcome != null) return false;

  return hasLivePreviewFact({
    powerIntent: app.powerIntent ?? null,
    agentIntent: app.agentIntent ?? null,
    runtimeState: app.runtimeState ?? null,
    agentState: app.agentState ?? null,
    lastOutcome: app.lastOutcome ?? null,
    previewUrl: app.previewUrl ?? null,
    previewHealth: app.previewHealth ?? null,
    containerName: app.containerName ?? null,
  });
}

export function getOpsStatusDetail(
  project: { app?: OperatorDisplayComponent | null; components?: OperatorDisplayComponent[] | null },
): string | null {
  const app = getAppComponent(project);
  const blocker = app?.blockers?.[0];
  if (!blocker) {
    if (isPausedPreviewCohort(project)) {
      return "Preview is still live, but unfinished work is manually paused. Resume the agent loop when you want work to continue.";
    }

    const isAgentOffRetainedPreview =
      app?.powerIntent === "ON"
      && app?.agentIntent === "OFF"
      && app?.runtimeState === "RUNNING"
      && app?.agentState === "IDLE"
      && hasLivePreviewFact({
        powerIntent: app.powerIntent ?? null,
        agentIntent: app.agentIntent ?? null,
        runtimeState: app.runtimeState ?? null,
        agentState: app.agentState ?? null,
        lastOutcome: app.lastOutcome ?? null,
        previewUrl: app.previewUrl ?? null,
        previewHealth: app.previewHealth ?? null,
        containerName: app.containerName ?? null,
      });

    if (!isAgentOffRetainedPreview) {
      return null;
    }

    if (app?.lastOutcome === "COMPLETED") {
      return "Preview is still live after the last completed iteration. Turn the agent loop back on when you want new work to continue.";
    }

    if (app?.lastOutcome === "FAILED") {
      return "Preview is still live after the last agent run failed. Inspect the retained preview or turn the agent loop back on when you want to retry work.";
    }

    return null;
  }

  const retryHint = formatRetryHint(app?.retryAt ?? null);
  switch (blocker) {
    case "MANUAL":
      return "Waiting for user or operator evidence. Resume only after the requested production check is supplied.";
    case "BUDGET":
      return "Budget exhausted. Add credits or increase the project budget before resuming the runtime.";
    case "RATE_LIMIT":
      return retryHint
        ? `Provider usage limit hit. ${retryHint}`
        : "Provider usage limit hit. The runtime is paused until the limit resets.";
    case "SECRETS":
      return "Required secrets are missing. Add them before resuming the runtime.";
    case "INFRA":
      return retryHint
        ? `Infrastructure pause. ${retryHint}`
        : "Infrastructure pause. The runtime is waiting for a retry or operator intervention.";
    case "API":
      return retryHint
        ? `Auth or API is unavailable. ${retryHint}`
        : "Auth or API is unavailable. The runtime is waiting for a retry or operator intervention.";
    default:
      return `Runtime is paused by blocker: ${blocker}.`;
  }
}

export function getOpsStatusDetailTooltip(
  project: { app?: OperatorDisplayComponent | null; components?: OperatorDisplayComponent[] | null },
): string | null {
  const app = getAppComponent(project);
  const blocker = app?.blockers?.[0];

  switch (blocker) {
    case "RATE_LIMIT":
    case "INFRA":
    case "API":
      return formatRetryHintTooltip(app?.retryAt ?? null);
    default:
      return null;
  }
}

export function statusDotColor(status: string): string {
  const normalized = canonicalizeOpsStatus(status);
  if (normalized === "BUILDING") return "bg-amber-400";
  if (normalized === "LIVE") return "bg-emerald-400";
  if (normalized === "PAUSED") return "bg-slate-400";
  if (normalized === "FAILED") return "bg-rose-400";
  if (normalized === "AGENT_OFF") return "bg-gray-400";
  return "bg-gray-300";
}

export function isOpsActiveStatus(status: string): boolean {
  const normalized = canonicalizeOpsStatus(status);
  return normalized === "LIVE" || normalized === "BUILDING";
}

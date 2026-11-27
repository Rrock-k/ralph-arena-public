import { hasLivePreviewFact } from "@/lib/preview-state";

export type PublicStatus = "BUILDING" | "LIVE" | "PAUSED";

// Shared select shape for read-side surfaces that rely on getPrimaryLifecycleComponent().
// If a caller omits kind, the lifecycle selector intentionally returns null.
export const PRIMARY_LIFECYCLE_COMPONENT_SELECT = {
  kind: true,
  powerIntent: true,
  agentIntent: true,
  previewHealth: true,
  runtimeState: true,
  agentState: true,
  blockers: true,
  lastOutcome: true,
  provisionedAt: true,
  previewUrl: true,
  containerName: true,
} as const;

type DateLike = Date | string | null | undefined;

type LifecycleComponentSelector = {
  kind?: string | null;
  id?: string | null;
  previewUrl?: string | null;
  previewHealth?: string | null;
  sourceConfig?: unknown;
  runtimeConfig?: unknown;
  powerIntent?: string | null;
  agentIntent?: string | null;
  runtimeState?: string | null;
  agentState?: string | null;
  lastOutcome?: string | null;
  lastOutcomeAt?: DateLike;
  blockers?: string[] | null;
  containerName?: string | null;
  provisionedAt?: DateLike;
  previewCheckedAt?: DateLike;
  retryAt?: DateLike;
  retryCount?: number | null;
  workerHost?: string | null;
  lastHeartbeat?: DateLike;
};

type LifecycleComponentState = LifecycleComponentSelector;

type LifecycleProjectState<TComponent extends LifecycleComponentSelector = LifecycleComponentState> = {
  archivedAt?: DateLike;
  app?: TComponent | null;
  components?: TComponent[] | null;
};

type StopReasonRow = {
  archivedAt?: DateLike;
  powerIntent?: string | null;
  agentIntent?: string | null;
  runtimeState?: string | null;
  blockers?: string[] | null;
  containerName?: string | null;
};

export function getPrimaryLifecycleComponent<TComponent extends LifecycleComponentSelector>(
  project: { app?: TComponent | null; components?: TComponent[] | null },
): TComponent | null {
  if ("app" in project) {
    return project.app ?? null;
  }
  return project.components?.find((component) => component.kind === "app") ?? null;
}

export function getPublicDisplayStatus<TComponent extends LifecycleComponentState>(
  project: LifecycleProjectState<TComponent>,
): PublicStatus {
  if (project.archivedAt) return "PAUSED";

  const component = getPrimaryLifecycleComponent(project);
  if (!component) return "PAUSED";

  if ((component.blockers?.length ?? 0) > 0) return "PAUSED";
  if (component.agentState === "RUNNING") return "BUILDING";
  if (hasLivePreviewFact(component)) return "LIVE";
  return "PAUSED";
}

export function getRunnerStopReason(row: StopReasonRow): string | null {
  if (row.archivedAt != null) return "status_archived";
  if (row.powerIntent === "OFF") return "power_off";
  if (row.agentIntent === "OFF") return "agent_off";

  const blocker = row.blockers?.[0];
  switch (blocker) {
    case "MANUAL":
      return "paused_manual";
    case "SECRETS":
      return "paused_secrets";
    case "BUDGET":
      return "budget_exhausted";
    case "RATE_LIMIT":
      return "status_paused_rate_limit";
    case "INFRA":
      return "status_paused_infra";
    case "API":
      return "status_paused_api";
    default:
      break;
  }

  if ((row.blockers?.length ?? 0) > 0) return "paused";
  if (row.runtimeState === "RUNNING" && !row.containerName) return "stale_runtime_identity";
  return null;
}

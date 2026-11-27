"use client";

// RA-237: No longer needs display-status — reads component state directly
import { getLoopActionBlockMessageFromState } from "@/lib/loop-support";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";

export interface ProjectActionContext {
  projectId: string;
  projectName: string;
  canManagePlatformProjects?: boolean;
  canManagePlatformRuntime?: boolean;
  project?: {
    archivedAt?: string | Date | null;
    app?: {
      kind?: string | null;
      powerIntent?: string | null;
      agentIntent?: string | null;
      runtimeState?: string | null;
      agentState?: string | null;
      blockers?: string[] | null;
      lastOutcome?: string | null;
    } | null;
    components?: Array<{
      kind?: string | null;
      powerIntent?: string | null;
      agentIntent?: string | null;
      runtimeState?: string | null;
      agentState?: string | null;
      blockers?: string[] | null;
      lastOutcome?: string | null;
    }> | null;
    loopRuntime?: string | null;
    loopSupportStatus?: "supported" | "upgrade-required" | "unsupported" | null;
    agentStartAllowed?: boolean;
    relaunchAllowed?: boolean;
    accessCapabilities?: string[];
    runnerBackend?: string | null;
    agent?: string | null;
    providerBillingMode?: string | null;
    vpsHost?: unknown;
    isPinned?: boolean;
  };
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
}

export interface ProjectAction {
  id: string;
  label: string;
  /** Action group for separators */
  group: "nav" | "runtime" | "budget" | "danger" | "misc";
  /** Color class for the menu item */
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
}

const RETRY_NOW_BLOCKERS = new Set(["RATE_LIMIT", "API", "INFRA", "MANUAL"]);

function hasCap(project: ProjectActionContext["project"], cap: string): boolean {
  return Array.isArray(project?.accessCapabilities) && project.accessCapabilities.includes(cap);
}

function normalizeProviderBillingMode(value: string | null | undefined): "byok" | "platform_credits" | "platform_credentials" {
  if (value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return "byok";
}

export function getRuntimeStartBlockReason(ctx: ProjectActionContext): string | null {
  const { project, canManagePlatformProjects } = ctx;
  if (canManagePlatformProjects || ctx.canManagePlatformRuntime) return null;
  if ((project?.runnerBackend ?? "local") === "vps" || project?.vpsHost) {
    return "Managed VPS runtime actions require platform access.";
  }
  if (project?.agent !== "codex" && project?.agent !== "claude-code") {
    return null;
  }
  const providerBillingMode = normalizeProviderBillingMode(project?.providerBillingMode);
  if (providerBillingMode === "platform_credits") {
    return ctx.managedProviderCreditsEnabled
      ? null
      : "Platform Credits provider runs are disabled.";
  }
  if (providerBillingMode === "platform_credentials") {
    return "Platform provider credentials require platform access.";
  }
  return ctx.userProviderCredentialsEnabled
    ? null
    : "User provider API-key launches are disabled.";
}

/**
 * Compute available actions for a project based on state + capabilities.
 * Shared between DropdownMenu (three dots) and ContextMenu (right-click).
 */
export function getProjectActions(ctx: ProjectActionContext): ProjectAction[] {
  const { project, canManagePlatformProjects } = ctx;
  const actions: ProjectAction[] = [];

  // RA-237: Derive state from component, not from fused status
  const comp = project ? getPrimaryLifecycleComponent(project) : null;
  const isArchived = !!project?.archivedAt;
  const powerOn = comp?.powerIntent === "ON";
  const runtimeRunning = comp?.runtimeState === "RUNNING";
  const agentRunning = comp?.agentState === "RUNNING";
  const retryNowBlocker = comp?.blockers?.find((blocker) => RETRY_NOW_BLOCKERS.has(blocker)) ?? null;
  const retryNowNeedsAgentOn = retryNowBlocker && retryNowBlocker !== "MANUAL" && comp?.agentIntent !== "ON";
  const failedIteration = comp?.lastOutcome === "FAILED";
  const agentFailed = failedIteration;
  const isCompleted = comp?.agentState === "IDLE" && comp?.lastOutcome === "COMPLETED";
  const isSleeping = !powerOn && !runtimeRunning;
  const agentOnBlockReason = getLoopActionBlockMessageFromState({
    loopIdentity: project?.loopRuntime,
    supportStatus: project?.loopSupportStatus,
    agentStartAllowed: project?.agentStartAllowed,
    relaunchAllowed: project?.relaunchAllowed,
  }, "agent_on");
  const relaunchBlockReason = getLoopActionBlockMessageFromState({
    loopIdentity: project?.loopRuntime,
    supportStatus: project?.loopSupportStatus,
    agentStartAllowed: project?.agentStartAllowed,
    relaunchAllowed: project?.relaunchAllowed,
  }, "relaunch");
  const runtimeStartBlockReason = getRuntimeStartBlockReason(ctx);

  const canManageRuntime = hasCap(project, "project.runtime.manage");
  const canManageSettings = hasCap(project, "project.settings.manage");
  const canManageBudget = hasCap(project, "project.budget.manage");
  const canDeleteProject = hasCap(project, "project.delete");

  // Nav — RA-240: "Manage" removed, OPS is the single admin surface
  actions.push({ id: "logs", label: "View Logs", group: "nav" });
  if (canManageSettings) {
    actions.push({ id: "rename", label: "Rename", group: "nav" });
  }
  actions.push({ id: "copyId", label: "Copy ID", group: "misc" });

  // Pin
  if (canManagePlatformProjects) {
    actions.push({
      id: "pin",
      label: project?.isPinned ? "Unpin" : "Pin to Top",
      group: "runtime",
    });
  }

  // RA-237: Clean command surface — 3 layers with color coding
  if (project && canManageRuntime && !isArchived) {
    // App layer (cyan): explicit power intent
    if (isSleeping && !isArchived) {
      actions.push({
        id: "powerOn",
        label: "⬡ App On",
        group: "runtime",
        className: "text-cyan-500 focus:text-cyan-600 focus:bg-cyan-50/10",
        disabled: Boolean(runtimeStartBlockReason),
        disabledReason: runtimeStartBlockReason ?? undefined,
      });
    }
    if (powerOn && runtimeRunning) {
      actions.push({ id: "powerOff", label: "⬡ App Off", group: "runtime", className: "text-cyan-500 focus:text-cyan-600 focus:bg-cyan-50/10" });
      actions.push({
        id: "refreshPreview",
        label: "↻ Refresh Preview",
        group: "runtime",
        className: "text-cyan-500 focus:text-cyan-600 focus:bg-cyan-50/10",
      });
    }
    if (powerOn) {
      actions.push({
        id: "recreateRuntime",
        label: "↻ Recreate Runtime",
        group: "runtime",
        className: "text-cyan-500 focus:text-cyan-600 focus:bg-cyan-50/10",
        disabled: agentRunning,
        disabledReason: agentRunning ? "Runtime recreate requires the agent to be idle or off" : undefined,
      });
    }
    if (retryNowBlocker) {
      actions.push({
        id: "retryNow",
        label: "↻ Retry Now",
        group: "runtime",
        className: "text-cyan-500 focus:text-cyan-600 focus:bg-cyan-50/10",
        disabled: Boolean(retryNowNeedsAgentOn),
        disabledReason: retryNowNeedsAgentOn ? "Turn Agent ON before retrying loop work" : undefined,
      });
    }

    // Agent layer (lime): explicit agent intent + relaunch
    const agentIntentOn = (comp?.agentIntent ?? "ON") === "ON";
    if (agentIntentOn && (agentRunning || comp?.agentState === "IDLE")) {
      actions.push({ id: "agentOff", label: "◈ Agent Off", group: "runtime", className: "text-lime-500 focus:text-lime-600 focus:bg-lime-50/10" });
    }
    if (!agentIntentOn) {
      actions.push({
        id: "agentOn",
        label: "◈ Agent On",
        group: "runtime",
        className: "text-lime-500 focus:text-lime-600 focus:bg-lime-50/10",
        disabled: Boolean(agentOnBlockReason || runtimeStartBlockReason),
        disabledReason: agentOnBlockReason ?? runtimeStartBlockReason ?? undefined,
      });
    }
    if (isCompleted || agentFailed) {
      actions.push({
        id: "relaunch",
        label: "◈ Relaunch",
        group: "runtime",
        className: "text-lime-500 focus:text-lime-600 focus:bg-lime-50/10",
        disabled: Boolean(relaunchBlockReason || runtimeStartBlockReason),
        disabledReason: relaunchBlockReason ?? runtimeStartBlockReason ?? undefined,
      });
    }
  }

  // Project layer (amber): Archive / Unarchive
  if (canManageRuntime && !isArchived) {
    actions.push({ id: "archive", label: "▣ Archive", group: "danger", className: "text-rose-600 focus:text-rose-700 focus:bg-rose-50" });
  }
  if (canManageRuntime && isArchived) {
    actions.push({ id: "unarchive", label: "▣ Unarchive", group: "runtime", className: "text-amber-500 focus:text-amber-600 focus:bg-amber-50/10" });
  }

  // Budget
  if (canManageBudget) {
    actions.push({
      id: "addCredits",
      label: "Add Credits",
      group: "budget",
      className: "text-violet-600 focus:text-violet-700 focus:bg-violet-50",
    });
  }

  // Danger: Delete
  if (canDeleteProject) {
    actions.push({
      id: "delete",
      label: "Delete",
      group: "danger",
      className: "text-rose-600 focus:text-rose-700 focus:bg-rose-50",
    });
  }

  return actions;
}

/** Group actions with separators between different groups. */
export function groupedActions(actions: ProjectAction[]): (ProjectAction | "separator")[] {
  const result: (ProjectAction | "separator")[] = [];
  let lastGroup: string | null = null;
  for (const action of actions) {
    if (lastGroup && action.group !== lastGroup) {
      result.push("separator");
    }
    result.push(action);
    lastGroup = action.group;
  }
  return result;
}

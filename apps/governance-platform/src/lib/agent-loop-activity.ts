import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";

type AgentLoopComponentLike = {
  kind?: string | null;
  powerIntent?: string | null;
  agentIntent?: string | null;
  runtimeState?: string | null;
  agentState?: string | null;
  blockers?: string[] | null;
};

type AgentLoopTarget = AgentLoopComponentLike & {
  app?: AgentLoopComponentLike | null;
  components?: AgentLoopComponentLike[] | null;
};

function resolveAgentLoopComponent(target: AgentLoopTarget | null | undefined): AgentLoopComponentLike | null {
  if (!target) return null;
  if ("app" in target || Array.isArray(target.components)) {
    return getPrimaryLifecycleComponent(target) ?? null;
  }
  return target;
}

function getBlockerCount(blockers: string[] | null | undefined): number {
  return Array.isArray(blockers) ? blockers.filter((value) => typeof value === "string" && value.length > 0).length : 0;
}

export function hasLiveAgentLoop(target: AgentLoopTarget | null | undefined): boolean {
  const component = resolveAgentLoopComponent(target);
  if (!component) return false;
  if (component.runtimeState !== "RUNNING") return false;
  if ((component.agentIntent ?? "ON") !== "ON") return false;
  if (getBlockerCount(component.blockers) > 0) return false;
  return component.agentState === "RUNNING" || component.agentState === "IDLE";
}

export function hasWorkingAgentLoop(target: AgentLoopTarget | null | undefined): boolean {
  const component = resolveAgentLoopComponent(target);
  if (!component) return false;
  return hasLiveAgentLoop(component) && component.agentState === "RUNNING";
}

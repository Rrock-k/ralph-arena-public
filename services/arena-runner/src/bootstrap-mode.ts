import type { RuntimeIntentRunnerMode } from "@arena/contracts";

type ProjectAgentIntent = "ON" | "OFF";

export function resolveRunnerBootstrapMode(
  agentIntent: ProjectAgentIntent,
  envMode: string | undefined,
): RuntimeIntentRunnerMode {
  // Old workers never stamped a runtime-intent mode into the container env.
  // agentIntent=OFF still has to boot as preview-only under that legacy path.
  if (agentIntent === "OFF") {
    return "preview_only";
  }

  return envMode === "preview_only" ? "preview_only" : "agent_run";
}

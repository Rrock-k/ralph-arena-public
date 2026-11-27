import type { StatusData } from "./api.js";

export type IdleDirective = "continue_idle" | "resume_agent" | "shutdown";

export function getIdleDirective(status: StatusData, pendingLoopWork: boolean): IdleDirective {
  const hasPendingLoopWork = pendingLoopWork || status.pendingLoopWork === true;

  if (status.shouldStop) {
    switch (status.reason) {
      case "power_off":
      case "status_archived":
      case "not_found":
      case "no_component":
        return "shutdown";
      default:
        return "continue_idle";
    }
  }

  if (status.agentIntent === "ON" && hasPendingLoopWork) {
    return "resume_agent";
  }

  return "continue_idle";
}

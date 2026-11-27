import type { StatusData } from "./api.js";

export type PausedSupervisorAction = "stay_paused" | "resume" | "shutdown";

export function getPausedSupervisorAction(status: StatusData): PausedSupervisorAction {
  if (!status.shouldStop) return "resume";
  switch (status.reason) {
    case "power_off":
    case "agent_off":
    case "status_archived":
    case "not_found":
    case "no_component":
    case "status_failed":
      return "shutdown";
    default:
      return "stay_paused";
  }
}

import { describe, expect, it } from "vitest";
import { getIdleDirective } from "./idle-supervisor.js";

describe("getIdleDirective", () => {
  it("keeps completed idle previews idle when agent turns on but no new work exists", () => {
    expect(getIdleDirective({
      shouldStop: false,
      agentIntent: "ON",
    }, false)).toBe("continue_idle");
  });

  it("resumes the loop when local pending work exists", () => {
    expect(getIdleDirective({
      shouldStop: false,
      agentIntent: "ON",
    }, true)).toBe("resume_agent");
  });

  it("resumes the loop when live status reports pending work", () => {
    expect(getIdleDirective({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
    }, false)).toBe("resume_agent");
  });

  it("keeps agent-off idle previews alive instead of shutting them down", () => {
    expect(getIdleDirective({
      shouldStop: true,
      reason: "agent_off",
      agentIntent: "OFF",
    }, true)).toBe("continue_idle");
  });

  it("shuts down idle previews for power-off and archival reasons", () => {
    expect(getIdleDirective({
      shouldStop: true,
      reason: "power_off",
      agentIntent: "OFF",
    }, true)).toBe("shutdown");
    expect(getIdleDirective({
      shouldStop: true,
      reason: "status_archived",
      agentIntent: "OFF",
    }, true)).toBe("shutdown");
  });
});

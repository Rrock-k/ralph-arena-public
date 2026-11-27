import { describe, expect, it } from "vitest";

import { hasLiveAgentLoop, hasWorkingAgentLoop } from "./agent-loop-activity";

describe("agent loop activity", () => {
  it("treats RUNNING and IDLE as live when runtime is resident and unblocked", () => {
    expect(hasLiveAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "ON",
      agentState: "RUNNING",
      blockers: [],
    })).toBe(true);

    expect(hasLiveAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "ON",
      agentState: "IDLE",
      blockers: [],
    })).toBe(true);
  });

  it("rejects parked or blocked loops", () => {
    expect(hasLiveAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "OFF",
      agentState: "IDLE",
      blockers: [],
    })).toBe(false);
    expect(hasLiveAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "ON",
      agentState: "IDLE",
      blockers: ["SECRETS"],
    })).toBe(false);
    expect(hasLiveAgentLoop({
      runtimeState: "ABSENT",
      agentIntent: "ON",
      agentState: "RUNNING",
      blockers: [],
    })).toBe(false);
  });

  it("distinguishes working from resident idle", () => {
    expect(hasWorkingAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "ON",
      agentState: "RUNNING",
      blockers: [],
    })).toBe(true);
    expect(hasWorkingAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "ON",
      agentState: "IDLE",
      blockers: [],
    })).toBe(false);
  });

  it("reads the app component when a project snapshot is passed", () => {
    expect(hasLiveAgentLoop({
      components: [
        { kind: "app", runtimeState: "RUNNING", agentIntent: "ON", agentState: "IDLE", blockers: [] },
      ],
    })).toBe(true);
  });

  it("reads explicit app truth when a snapshot uses app instead of components", () => {
    expect(hasLiveAgentLoop({
      app: {
        runtimeState: "RUNNING",
        agentIntent: "ON",
        agentState: "IDLE",
        blockers: [],
      },
    })).toBe(true);

    expect(hasWorkingAgentLoop({
      app: {
        runtimeState: "RUNNING",
        agentIntent: "ON",
        agentState: "RUNNING",
        blockers: [],
      },
    })).toBe(true);
  });
});

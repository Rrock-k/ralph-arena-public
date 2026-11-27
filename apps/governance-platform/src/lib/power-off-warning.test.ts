import { describe, expect, it } from "vitest";

import {
  getBatchPowerOffCopy,
  getPowerOffConfirmMessage,
  getPowerOffCopy,
  getPowerOffWarningCopy,
} from "./power-off-warning";
import { hasLiveAgentLoop } from "./agent-loop-activity";

describe("power-off warning helpers", () => {
  it("detects a live resident agent loop", () => {
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
    expect(hasLiveAgentLoop({
      runtimeState: "RUNNING",
      agentIntent: "OFF",
      agentState: "IDLE",
      blockers: [],
    })).toBe(false);
  });

  it("builds single-project warning copy", () => {
    expect(getPowerOffCopy("Alpha")).toEqual({
      title: "Turn off app",
      description: 'Turn the app off for "Alpha". The preview will stop until you turn it back on.',
      confirmLabel: "Turn Off App",
    });
    expect(getPowerOffWarningCopy("Alpha")).toEqual({
      title: "Turn off app and park agent",
      description: 'Agent loop is still active for "Alpha". App Off will park it and stop the preview. The project will not fail and can resume later.',
      confirmLabel: "Turn Off App",
    });
    expect(getPowerOffConfirmMessage("Alpha")).toContain("Continue?");
  });

  it("builds batch warning copy when some loops are still active", () => {
    expect(getBatchPowerOffCopy(2, 5)).toEqual({
      title: "Turn off app for 5 projects",
      description: "2 selected projects still have active agent loops. App Off will park those loops and stop their previews. The projects will not fail and can resume later.",
      confirmLabel: "Turn Off 5 projects",
    });
  });

  it("builds neutral batch copy when no agents are running", () => {
    expect(getBatchPowerOffCopy(0, 1)).toEqual({
      title: "Turn off app for 1 project",
      description: "This will turn the app off for 1 project. Its preview will stop until you turn it on again.",
      confirmLabel: "Turn Off 1 project",
    });
  });
});

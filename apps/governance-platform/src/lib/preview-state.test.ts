import { describe, expect, it } from "vitest";
import { hasLivePreviewFact, isRetainedPreviewRow } from "./preview-state";

describe("isRetainedPreviewRow", () => {
  it("treats completed idle rows as retained previews", () => {
    expect(isRetainedPreviewRow({
      agentState: "IDLE",
      lastOutcome: "COMPLETED",
      agentIntent: "ON",
    })).toBe(true);
  });

  it("treats parked agent-off idle rows as retained previews without a fake completed outcome", () => {
    expect(isRetainedPreviewRow({
      agentState: "IDLE",
      lastOutcome: null,
      agentIntent: "OFF",
    })).toBe(true);
  });
});

describe("hasLivePreviewFact", () => {
  it("treats parked preview-only rows as live even without a previewUrl mirror", () => {
    expect(hasLivePreviewFact({
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      lastOutcome: null,
      previewUrl: null,
      previewHealth: "UNKNOWN",
      containerName: "preview-demo",
    })).toBe(true);
  });

  it("does not treat retained preview rows without component runtime identity as live", () => {
    expect(hasLivePreviewFact({
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      lastOutcome: null,
      previewUrl: null,
      previewHealth: "UNKNOWN",
      containerName: null,
    })).toBe(false);
  });

  it("does not treat powered-off rows as live", () => {
    expect(hasLivePreviewFact({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      lastOutcome: null,
    })).toBe(false);
  });

  it("treats failed-history preview-bearing rows as live while runtime is still serving", () => {
    expect(hasLivePreviewFact({
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      lastOutcome: "FAILED",
      previewUrl: "/preview",
      previewHealth: "HEALTHY",
    })).toBe(true);
  });

  it("does not treat healthy rows without preview identity as live", () => {
    expect(hasLivePreviewFact({
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      lastOutcome: "COMPLETED",
      previewUrl: null,
      previewHealth: "HEALTHY",
      containerName: null,
    })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  getMyProjectPausedRecoveryAction,
  shouldShowMyDashboardLivePill,
} from "./my-surfaces";

describe("shouldShowMyDashboardLivePill", () => {
  it("hides the live pill for a paused project even when previewUrl is still set", () => {
    expect(shouldShowMyDashboardLivePill({
      previewUrl: "/preview",
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe(false);
  });

  it("shows the live pill only for the canonical live state", () => {
    expect(shouldShowMyDashboardLivePill({
      components: [{ kind: "app", previewUrl: "/preview", powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe(true);
  });

  it("accepts the canonical app shape directly", () => {
    expect(shouldShowMyDashboardLivePill({
      status: "PAUSED",
      app: { previewUrl: "/preview", powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "COMPLETED" },
    })).toBe(true);
  });
});

describe("getMyProjectPausedRecoveryAction", () => {
  it("uses power on for powered-off completed projects", () => {
    expect(getMyProjectPausedRecoveryAction({
      components: [{ kind: "app", powerIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe("powerOn");
  });

  it("keeps agent on for paused projects that are still powered on", () => {
    expect(getMyProjectPausedRecoveryAction({
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe("agentOn");
  });

  it("keeps agent on for paused-preview cohorts even while the preview stays live", () => {
    expect(getMyProjectPausedRecoveryAction({
      app: {
        kind: "app",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: null,
        blockers: [],
        previewHealth: "HEALTHY",
        containerName: "preview-project-1",
      },
    })).toBe("agentOn");
  });
});

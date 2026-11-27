import { describe, expect, it } from "vitest";
import { getDisplayStatus, isDisplayActive } from "./display-status";

describe("getDisplayStatus", () => {
  it("shows BUILDING for running agent", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", runtimeState: "RUNNING", agentState: "RUNNING", lastOutcome: null, previewUrl: "/preview" }],
    })).toBe("BUILDING");
  });

  it("shows LIVE for running app with a live preview", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "COMPLETED", previewUrl: "/preview" }],
    })).toBe("LIVE");
  });

  it("shows LIVE for a restored completed preview even without a previewUrl mirror", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "COMPLETED", containerName: "preview-demo" }],
    })).toBe("LIVE");
  });

  it("shows LIVE for a parked preview-only row even without a previewUrl mirror", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", powerIntent: "ON", agentIntent: "OFF", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: null, containerName: "preview-demo" }],
    })).toBe("LIVE");
  });

  it("prefers the app component previewUrl over the project row", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", previewUrl: "/preview", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe("LIVE");
  });

  it("shows LIVE for running container even without outcome", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: null, previewUrl: "/preview" }],
    })).toBe("LIVE");
  });

  it("shows LIVE for a failed-history iteration when the preview is still live", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "FAILED", previewUrl: "/preview" }],
    })).toBe("LIVE");
  });

  it("shows PAUSED for archived", () => {
    expect(getDisplayStatus({
      archivedAt: new Date(),
      components: [{ kind: "app", runtimeState: "ABSENT", agentState: null, lastOutcome: null }],
    })).toBe("PAUSED");
  });

  it("shows PAUSED for absent with no outcome", () => {
    expect(getDisplayStatus({
      previewUrl: null,
      components: [{ kind: "app", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: null }],
    })).toBe("PAUSED");
  });

  it("shows PAUSED for failed-history rows without a live preview", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: "FAILED" }],
    })).toBe("PAUSED");
  });

  it("does not show LIVE for a parked completed project", () => {
    expect(getDisplayStatus({
      components: [{ kind: "app", powerIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe("PAUSED");
  });

  it("selects the app component instead of the first component", () => {
    expect(getDisplayStatus({
      previewUrl: "/preview",
      components: [
        { kind: "worker", runtimeState: "RUNNING", agentState: "RUNNING", lastOutcome: null },
        { kind: "app", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: null },
      ],
    })).toBe("PAUSED");
  });
});

describe("isDisplayActive", () => {
  it("treats BUILDING as active", () => {
    expect(isDisplayActive({
      components: [{ kind: "app", runtimeState: "RUNNING", agentState: "RUNNING", lastOutcome: null, previewUrl: "/preview" }],
    })).toBe(true);
  });

  it("treats PAUSED as inactive", () => {
    expect(isDisplayActive({
      archivedAt: new Date(),
    })).toBe(false);
  });

  it("treats failed-history preview-bearing rows as active while the preview is live", () => {
    expect(isDisplayActive({
      components: [{ kind: "app", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "FAILED", previewUrl: "/preview" }],
    })).toBe(true);
  });
});

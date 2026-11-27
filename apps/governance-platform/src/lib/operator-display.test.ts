import { describe, expect, it } from "vitest";
import {
  OPS_STATUS_PRIORITY,
  canonicalizeOpsStatus,
  getAppComponent,
  getOpsDisplayStatus,
  getOpsStatusDetail,
  getOpsStatusDetailTooltip,
  isPausedPreviewCohort,
  isOpsActiveStatus,
  statusDotColor,
} from "./operator-display";

describe("operator display helpers", () => {
  it("treats canonical LIVE as first-class and normalizes legacy statuses", () => {
    expect(OPS_STATUS_PRIORITY.LIVE).toBeLessThan(OPS_STATUS_PRIORITY.BUILDING);
    expect(canonicalizeOpsStatus("DEPLOYED")).toBe("LIVE");
    expect(canonicalizeOpsStatus("SUCCEEDED")).toBe("LIVE");
    expect(canonicalizeOpsStatus("RUNNING")).toBe("BUILDING");
    expect(statusDotColor("SUCCEEDED")).toBe("bg-emerald-400");
    expect(statusDotColor("PAUSED")).toBe("bg-slate-400");
  });

  it("keeps live-running projects live only when the runtime is actually serving", () => {
    expect(getOpsDisplayStatus({
      status: "DEPLOYED",
      components: [{ kind: "app", previewUrl: "/preview", powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe("LIVE");

    expect(getOpsDisplayStatus({
      status: "DEPLOYED",
      components: [{ kind: "app", previewUrl: null, powerIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: "COMPLETED" }],
    })).toBe("PAUSED");
  });

  it("prefers component preview truth when the row is stale", () => {
    expect(getOpsDisplayStatus({
      status: "DEPLOYED",
      components: [{
        kind: "app",
        powerIntent: "ON",
        previewHealth: "HEALTHY",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: "COMPLETED",
        containerName: "preview-project-1",
      }],
    })).toBe("LIVE");
  });

  it("does not let worker-only components override the legacy fallback", () => {
    expect(getOpsDisplayStatus({
      status: "RUNNING",
      components: [{
        kind: "worker",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: null,
      }],
    })).toBe("BUILDING");
  });

  it("selects the app component explicitly", () => {
    const component = getAppComponent({
      components: [
        { kind: "worker", runtimeState: "RUNNING", agentState: "RUNNING", lastOutcome: null },
        { kind: "app", runtimeState: "ABSENT", agentState: "IDLE", lastOutcome: null },
      ],
    });

    expect(component?.kind).toBe("app");
    expect(isOpsActiveStatus(getOpsDisplayStatus({
      status: "PAUSED",
      components: [{ kind: "app", previewUrl: "/preview", powerIntent: "ON", runtimeState: "RUNNING", agentState: "IDLE", lastOutcome: null }],
    }))).toBe(true);
  });

  it("accepts explicit app truth without wrapping it back into components", () => {
    expect(getAppComponent({
      app: {
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: null,
      },
    })?.runtimeState).toBe("RUNNING");

    expect(getOpsDisplayStatus({
      status: "PAUSED",
      app: {
        previewUrl: "/preview",
        powerIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: null,
      },
    })).toBe("LIVE");
  });

  it("falls back to PAUSED when a legacy row has no explicit app or status", () => {
    expect(getOpsDisplayStatus({
      components: [],
    })).toBe("PAUSED");
  });

  it("surfaces blocker detail for paused manual, budget and rate-limit rows", () => {
    expect(getOpsStatusDetail({
      app: {
        blockers: ["MANUAL"],
      },
    })).toMatch(/user or operator evidence/i);

    expect(getOpsStatusDetail({
      app: {
        blockers: ["BUDGET"],
      },
    })).toMatch(/Budget exhausted/i);

    expect(getOpsStatusDetail({
      app: {
        blockers: ["RATE_LIMIT"],
        retryAt: "2026-04-22T10:00:00.000Z",
      },
    })).toMatch(/Next auto-retry/i);
    expect(getOpsStatusDetailTooltip({
      app: {
        blockers: ["RATE_LIMIT"],
        retryAt: "2026-04-22T10:00:00.000Z",
      },
    })).toBe("UTC: 22/04/2026, 10:00:00 UTC");
  });

  it("surfaces paused-preview detail without collapsing the live preview status", () => {
    const project = {
      app: {
        kind: "app" as const,
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: null,
        blockers: [],
        previewHealth: "HEALTHY",
        containerName: "preview-project-1",
      },
    };

    expect(getOpsDisplayStatus(project)).toBe("LIVE");
    expect(isPausedPreviewCohort(project)).toBe(true);
    expect(getOpsStatusDetail(project)).toMatch(/manually paused/i);
  });

  it("surfaces retained completed-preview detail when the agent loop is off", () => {
    const project = {
      app: {
        kind: "app" as const,
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: "COMPLETED",
        blockers: [],
        previewHealth: "HEALTHY",
        containerName: "preview-project-1",
      },
    };

    expect(getOpsDisplayStatus(project)).toBe("LIVE");
    expect(getOpsStatusDetail(project)).toMatch(/completed iteration/i);
  });

  it("surfaces retained failed-preview detail when the agent loop is off", () => {
    const project = {
      app: {
        kind: "app" as const,
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: "FAILED",
        blockers: [],
        previewHealth: "HEALTHY",
        containerName: "preview-project-1",
      },
    };

    expect(getOpsDisplayStatus(project)).toBe("LIVE");
    expect(getOpsStatusDetail(project)).toMatch(/last agent run failed/i);
  });
});

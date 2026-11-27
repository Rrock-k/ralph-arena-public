import { describe, expect, it } from "vitest";

import { getProjectActions, type ProjectActionContext } from "./ProjectActions";

function buildContext(overrides: Partial<ProjectActionContext["project"]> = {}): ProjectActionContext {
  return {
    projectId: "project-1",
    projectName: "Alpha",
    project: {
      accessCapabilities: ["project.runtime.manage"],
      archivedAt: null,
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
      },
      ...overrides,
    },
  };
}

describe("getProjectActions", () => {
  it("keeps App Off available while the agent is actively running", () => {
    const actions = getProjectActions(buildContext());

    expect(actions.some((action) => action.id === "powerOff")).toBe(true);
    expect(actions.some((action) => action.id === "agentOff")).toBe(true);
    const recreateRuntime = actions.find((action) => action.id === "recreateRuntime");
    expect(recreateRuntime?.disabled).toBe(true);
  });

  it("hides App Off when runtime is not running", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
      },
    }));

    expect(actions.some((action) => action.id === "powerOff")).toBe(false);
  });

  it("keeps Relaunch available for failed idle iterations", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
      },
    }));

    expect(actions.some((action) => action.id === "relaunch")).toBe(true);
  });

  it("disables start-like runtime actions when user provider launches are feature-disabled", () => {
    const actions = getProjectActions(buildContext({
      agent: "codex",
      providerBillingMode: "byok",
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
      },
    }));

    const agentOn = actions.find((action) => action.id === "agentOn");
    const relaunch = actions.find((action) => action.id === "relaunch");
    expect(agentOn?.disabled).toBe(true);
    expect(relaunch?.disabled).toBe(true);
    expect(agentOn?.disabledReason).toBe("User provider API-key launches are disabled.");
  });

  it("disables platform credential starts for non-platform project operators", () => {
    const actions = getProjectActions(buildContext({
      agent: "codex",
      providerBillingMode: "platform_credentials",
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
      },
    }));

    const agentOn = actions.find((action) => action.id === "agentOn");
    const relaunch = actions.find((action) => action.id === "relaunch");
    expect(agentOn?.disabled).toBe(true);
    expect(relaunch?.disabled).toBe(true);
    expect(agentOn?.disabledReason).toBe("Platform provider credentials require platform access.");
  });

  it("disables Agent On for pinned rows that require upgrade", () => {
    const actions = getProjectActions(buildContext({
      loopRuntime: "ralph Pinned v1.5.0",
      loopSupportStatus: "upgrade-required",
      agentStartAllowed: false,
      relaunchAllowed: false,
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
      },
    }));

    const agentOn = actions.find((action) => action.id === "agentOn");
    expect(agentOn?.disabled).toBe(true);
    expect(agentOn?.disabledReason).toContain("bundled default runtime");
  });

  it("uses explicit app truth without requiring faux components", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
      },
    }));

    expect(actions.some((action) => action.id === "powerOff")).toBe(true);
    expect(actions.some((action) => action.id === "agentOff")).toBe(true);
  });

  it("offers recreate runtime for powered-on idle previews", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
      },
    }));

    const recreateRuntime = actions.find((action) => action.id === "recreateRuntime");
    expect(recreateRuntime).toBeDefined();
    expect(recreateRuntime?.disabled).toBe(false);
  });

  it("does not offer Relaunch while a project is waiting on blockers", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
      },
    }));

    expect(actions.some((action) => action.id === "relaunch")).toBe(false);
    expect(actions.some((action) => action.id === "recreateRuntime")).toBe(true);
    expect(actions.some((action) => action.id === "retryNow")).toBe(true);
  });

  it("offers Retry Now only for retryable or manual blockers", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
      },
    }));

    expect(actions.some((action) => action.id === "retryNow")).toBe(true);
  });

  it("does not offer Retry Now for non-retryable blockers", () => {
    const actions = getProjectActions(buildContext({
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["SECRETS"],
        lastOutcome: null,
      },
    }));

    expect(actions.some((action) => action.id === "retryNow")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  canClaimPreviewRestoreIntent,
  evaluateRuntimeIntentClaimability,
  getClaimableRuntimeIntent,
  type RuntimeIntentCandidate,
} from "./runtime-intents";

const baseCandidate: RuntimeIntentCandidate = {
  powerIntent: "ON",
  agentIntent: "ON",
  runtimeState: "ABSENT",
  agentState: "IDLE",
  provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
  pendingLoopWork: false,
  allowPreviewOnlyRestore: true,
  blockers: [],
  containerName: "preview-ant-dream",
  workerHost: "local",
  sourceConfig: null,
  tgSpecLastImportedVersion: 1,
  lastAction: null,
  lastState: null,
  lastAttempt: null,
};

describe("canClaimPreviewRestoreIntent", () => {
  it("allows completed preview restores that match the host", () => {
    expect(canClaimPreviewRestoreIntent(baseCandidate, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBe(true);
    expect(getClaimableRuntimeIntent(baseCandidate, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });

  it("allows completed preview restores even when workspace has no start.sh yet", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });

  it("rejects queued active runs so old preview identity cannot revive them (RA-221)", () => {
    expect(canClaimPreviewRestoreIntent({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBe(false);
  });

  it("allows parked preview-only rows to restore without a fake completed outcome", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      agentIntent: "OFF",
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });

  it("routes completed spec drift to agent_run", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "agent_run" });
  });

  it("restores completed maintenance recreates as preview-only after provisionedAt is cleared", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      provisionedAt: null,
      pendingLoopWork: false,
      allowPreviewOnlyRestore: true,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });

  it("restores preview-only while blockers are present on agent-intent rows", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
      blockers: ["BUDGET"],
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });

  it("routes unfinished provisioned rows to agent_run", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "agent_run" });
  });

  it("rejects unsupported agent runtime instead of claiming agent_run", () => {
    expect(evaluateRuntimeIntentClaimability({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
      agentStartAllowed: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({
      decision: null,
      rejectionReasons: ["agent_runtime_unsupported"],
    });
  });

  it("still allows preview restore for unsupported agent runtime when loop work is blocked", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
      agentStartAllowed: false,
      blockers: ["RATE_LIMIT"],
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });

  it("routes reclaimed paused-preview rows back to agent_run after runtime teardown", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      runtimeState: "STOPPED",
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
      provisionedAt: null,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "agent_run" });
  });

  it("keeps failed-history rows parked when no new specs arrived", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      agentState: "IDLE",
      pendingLoopWork: false,
      allowPreviewOnlyRestore: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("routes failed-history rows back to agent_run only after new specs arrive", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      agentState: "IDLE",
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_running", runnerMode: "agent_run" });
  });

  it("does not start unfinished rows before provisioning completes", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
      provisionedAt: null,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("keeps tg-spec targets parked until the first imported spec arrives", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      sourceConfig: { recipe: "tg_spec_target" },
      tgSpecLastImportedVersion: null,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("keeps configured tg-spec launch targets gated until explicit start", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      agentIntent: "OFF",
      sourceConfig: {
        recipe: "tg_spec_target",
        launchConfiguration: "tg_spec_launch_configuration_configured",
      },
      tgSpecLastImportedVersion: 1,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("caps repeated failed start intents so one broken preview cannot starve the fleet", () => {
    expect(canClaimPreviewRestoreIntent({
      ...baseCandidate,
      lastAction: "ensure_running",
      lastState: "FAILED",
      lastAttempt: 2,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBe(true);

    expect(canClaimPreviewRestoreIntent({
      ...baseCandidate,
      agentIntent: "OFF",
      blockers: ["INFRA"],
      lastAction: "ensure_running",
      lastState: "FAILED",
      lastAttempt: 5,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBe(false);

    expect(evaluateRuntimeIntentClaimability({
      ...baseCandidate,
      agentIntent: "OFF",
      blockers: ["INFRA"],
      lastAction: "ensure_running",
      lastState: "FAILED",
      lastAttempt: 5,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toEqual({
      decision: null,
      rejectionReasons: ["start_retry_capacity_exhausted"],
    });
  });

  it("blocks abandoned start history until an explicit power-on or recreate reopens the claim", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      lastAction: "ensure_running",
      lastState: "ABANDONED",
      lastAttempt: 1,
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("keeps stop intents gated only by failed-attempt cap", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      powerIntent: "OFF",
      runtimeState: "RUNNING",
      lastAction: "ensure_stopped",
      lastState: "FAILED",
      lastAttempt: 5,
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
    })).toBeNull();

    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      powerIntent: "OFF",
      runtimeState: "RUNNING",
      lastAction: "ensure_stopped",
      lastState: "FAILED",
      lastAttempt: 2,
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_stopped", runnerMode: "preview_only" });

    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      powerIntent: "OFF",
      runtimeState: "RUNNING",
      lastAction: "ensure_stopped",
      lastState: "ABANDONED",
      lastAttempt: 1,
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("lets stop intents ignore stale failed start history", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      powerIntent: "OFF",
      runtimeState: "RUNNING",
      lastAction: "ensure_running",
      lastState: "FAILED",
      lastAttempt: 5,
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_stopped", runnerMode: "preview_only" });
  });

  it("rejects intents pinned to another worker host", () => {
    expect(canClaimPreviewRestoreIntent({
      ...baseCandidate,
      workerHost: "vps-1",
    }, {
      host: "local",
      capacity: 1,
      maxAttempts: 5,
    })).toBe(false);
  });

  it("claims stop intents even with zero start capacity", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      powerIntent: "OFF",
      runtimeState: "RUNNING",
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
    })).toEqual({ action: "ensure_stopped", runnerMode: "preview_only" });
  });

  it("does not start new runtime when start capacity is exhausted", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      containerName: null,
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
    })).toBeNull();
  });

  it("allows zero-capacity starts only when they replace an existing runtime slot", () => {
    expect(getClaimableRuntimeIntent({
      ...baseCandidate,
      containerName: null,
    }, {
      host: "local",
      capacity: 0,
      maxAttempts: 5,
      canReplaceExistingRuntime: true,
    })).toEqual({ action: "ensure_running", runnerMode: "preview_only" });
  });
});

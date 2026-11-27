import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectExplain } from "./project-explain.js";

test("buildProjectExplain classifies healthy preview-only rows", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-1",
      name: "Preview Only",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-preview-only",
      repoBranch: "arena/project-project-1",
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      toolId: "tool-codex",
      agentLoopVersionId: "ralph-v2",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-1",
        workerHost: "local",
        lastHeartbeat: "2026-04-21T18:30:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "healthy_preview_only");
  assert.deepEqual(explain.allowedActions, ["app_off", "agent_on", "relaunch", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.why.join(" "), /completed work while the agent loop is intentionally off/i);
  assert.match(explain.operatorNotes.join(" "), /Source truth: repo=https:\/\/github.com\/example\/arena-preview-only, branch=arena\/project-project-1/i);
  assert.equal(explain.truth.agent, "codex");
  assert.equal(explain.truth.model, "gpt-5.5");
  assert.match(explain.operatorNotes.join(" "), /Runtime system: agent=codex, loop=ralph, toolId=tool-codex, loopVersionId=ralph-v2, model=gpt-5\.5/i);
  assert.match(explain.operatorNotes.join(" "), /Runtime auth modes: claude=null, codex=subscription, agentStartAllowed=yes/i);
  assert.equal(explain.truth.runtimeGenerationStatus, null);
  assert.deepEqual(explain.truth.runtimeGenerationReasons, []);
});

test("buildProjectExplain keeps failed retained preview in the same class but explains the failure", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-failed-preview",
      name: "Failed Preview",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-failed-preview",
      repoBranch: "arena/project-project-failed-preview",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-failed-preview",
        workerHost: "local",
        lastHeartbeat: "2026-04-23T02:20:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "healthy_preview_only");
  assert.match(explain.why.join(" "), /failed agent run while the agent loop is intentionally off/i);
});

test("buildProjectExplain does not hide failed idle agent runs behind healthy_agent_run", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-failed-agent-on",
      name: "Failed Agent On",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-failed-agent-on",
      repoBranch: "arena/project-project-failed-agent-on",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-failed-agent-on",
        workerHost: "local",
        lastHeartbeat: "2026-04-23T02:20:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "active_broken");
  assert.equal(explain.truth.lastOutcome, "FAILED");
  assert.notEqual(explain.recommendedNextAction, "no_action");
  assert.equal(explain.recommendedNextAction, "relaunch");
  assert.match(explain.why.join(" "), /last agent run failed while the preview remains live/i);
});

test("buildProjectExplain does not hide unfinished idle agent work behind healthy_agent_run", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-unfinished-agent-idle",
      name: "Unfinished Agent Idle",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-unfinished-agent-idle",
      repoBranch: "arena/project-project-unfinished-agent-idle",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 1,
        containerName: "preview-project-unfinished-agent-idle",
        workerHost: "local",
        lastHeartbeat: "2026-05-18T10:18:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "active_broken");
  assert.deepEqual(explain.allowedActions, ["recreate_runtime", "app_off", "app_on", "relaunch"]);
  assert.equal(explain.recommendedNextAction, "recreate_runtime");
  assert.match(explain.why.join(" "), /unfinished/i);
  assert.match(explain.why.join(" "), /cannot be claimed/i);
});

test("buildProjectExplain recommends runtime reclaim for stopped active agent work", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-stopped-active-work",
      name: "Stopped Active Work",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-stopped-active-work",
      repoBranch: "arena/project-project-stopped-active-work",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "STOPPED",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "UNKNOWN",
        previewUrl: null,
        retryAt: null,
        retryCount: 1,
        containerName: "preview-project-stopped-active-work",
        workerHost: "local",
        lastHeartbeat: "2026-06-11T14:08:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "not_found", exitCode: null, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "active_broken");
  assert.deepEqual(explain.allowedActions, ["recreate_runtime", "app_off", "app_on", "relaunch"]);
  assert.equal(explain.recommendedNextAction, "recreate_runtime");
  assert.match(explain.why.join(" "), /runtime is stopped, absent or idle/i);
});

test("buildProjectExplain treats manual blockers as explicit wait states", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-human-blocked",
      name: "Human Blocked",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-human-blocked",
      repoBranch: "arena/project-project-human-blocked",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["MANUAL"],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-human-blocked",
        workerHost: "local",
        lastHeartbeat: "2026-05-14T21:39:24.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "waiting_by_blocker");
  assert.deepEqual(explain.allowedActions, ["retry_now", "app_off", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.why.join(" "), /waiting for an explicit user, operator or platform action while the preview remains live/i);
  assert.match(explain.why.join(" "), /Current blockers: MANUAL/i);
});

test("buildProjectExplain keeps healthy blocked live agent rows out of unsupported runtime", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-rate-limit-blocked",
      name: "Rate Limited",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-rate-limit-blocked",
      repoBranch: "arena/project-project-rate-limit-blocked",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-rate-limit-blocked",
        workerHost: "local",
        lastHeartbeat: "2026-06-07T08:10:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: false,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "waiting_by_blocker");
  assert.deepEqual(explain.allowedActions, ["retry_now", "app_off", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.why.join(" "), /waiting on blockers while the preview remains live/i);
  assert.match(explain.why.join(" "), /Current blockers: RATE_LIMIT/i);
});

test("buildProjectExplain keeps worker-service generation drift separate from project runtime generation", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-runtime-drift",
      name: "Stale Preview Runtime",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-runtime-drift",
      repoBranch: "arena/project-project-runtime-drift",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-runtime-drift",
        workerHost: "local",
        lastHeartbeat: "2026-04-23T11:00:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
      parity: {
        status: "mismatch",
        reasons: ["worker_sha_mismatch:abc123", "runner_sha_mismatch:abc123"],
      },
    },
  });

  assert.equal(explain.classification, "healthy_preview_only");
  assert.equal(explain.truth.runtimeGenerationStatus, null);
  assert.deepEqual(explain.truth.runtimeGenerationReasons, []);
  assert.deepEqual(explain.allowedActions, ["app_off", "agent_on", "relaunch", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.operatorNotes.join(" "), /Worker service generation drift: worker_sha_mismatch:abc123, runner_sha_mismatch:abc123/i);
  assert.match(explain.operatorNotes.join(" "), /not a project-level runtime recreate/i);
});

test("buildProjectExplain surfaces actionable project runtime generation drift on retained previews", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-runtime-drift",
      name: "Stale Preview Runtime",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-runtime-drift",
      repoBranch: "arena/project-project-runtime-drift",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-runtime-drift",
        workerHost: "local",
        lastHeartbeat: "2026-04-23T11:00:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
      runtimeGeneration: {
        status: "mismatch",
        reasons: ["runtime_runner_version_mismatch:abc123"],
      },
    },
  });

  assert.equal(explain.classification, "healthy_preview_only");
  assert.equal(explain.truth.runtimeGenerationStatus, "mismatch");
  assert.deepEqual(explain.truth.runtimeGenerationReasons, [
    "runtime_runner_version_mismatch:abc123",
  ]);
  assert.deepEqual(explain.allowedActions, ["app_off", "agent_on", "recreate_runtime", "relaunch", "no_action"]);
  assert.equal(explain.recommendedNextAction, "recreate_runtime");
  assert.match(explain.operatorNotes.join(" "), /Project runtime generation drift: runtime_runner_version_mismatch:abc123/i);
});

test("buildProjectExplain does not treat missing expected parity as stale project runtime generation", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-parity-incomplete",
      name: "Parity Incomplete",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-parity-incomplete",
      repoBranch: "arena/project-project-parity-incomplete",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-parity-incomplete",
        workerHost: "local",
        lastHeartbeat: "2026-04-23T11:00:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
      parity: {
        status: "mismatch",
        reasons: ["expected_commit_missing"],
      },
    },
  });

  assert.equal(explain.classification, "healthy_preview_only");
  assert.equal(explain.truth.runtimeGenerationStatus, null);
  assert.deepEqual(explain.truth.runtimeGenerationReasons, []);
  assert.deepEqual(explain.allowedActions, ["app_off", "agent_on", "relaunch", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.operatorNotes.join(" "), /Worker service generation truth incomplete: expected_commit_missing/i);
});

test("buildProjectExplain distinguishes paused preview from completed preview-only rows", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-paused",
      name: "Paused Preview",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-paused-preview",
      repoBranch: "arena/project-project-paused",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-paused",
        workerHost: "local",
        lastHeartbeat: "2026-04-22T02:30:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "paused_preview");
  assert.deepEqual(explain.allowedActions, ["agent_on", "app_off", "relaunch", "no_action"]);
  assert.equal(explain.recommendedNextAction, "agent_on");
  assert.match(explain.why.join(" "), /manually paused/i);
});

test("buildProjectExplain classifies upgrade-required runtime as unsupported for agent work", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-2",
      name: "Pinned Loop",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-pinned",
      repoBranch: "arena/project-project-2",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-2",
        workerHost: "local",
        lastHeartbeat: null,
      },
      loopRuntime: "ralph Pinned v1.5.0",
      loopSupportStatus: "upgrade-required",
      loopSupportLabel: "upgrade required",
      loopSupportHint: "Pinned loop versions are history-only. Upgrade this project to the bundled default runtime before restarting it.",
      appStartAllowed: true,
      agentStartAllowed: false,
      relaunchAllowed: false,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
    },
  });

  assert.equal(explain.classification, "unsupported_runtime");
  assert.deepEqual(explain.allowedActions, ["upgrade_runtime", "app_off"]);
  assert.equal(explain.recommendedNextAction, "upgrade_runtime");
});

test("buildProjectExplain classifies bootstrap failures from worker logs", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-3",
      name: "Missing Bootstrap",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-broken",
      repoBranch: "arena/project-project-3",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: ["INFRA"],
        lastOutcome: "FAILED",
        previewHealth: "UNKNOWN",
        previewUrl: null,
        retryAt: null,
        retryCount: 1,
        containerName: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      logs: "No arena-start.sh found — cannot start preview",
      inspect: { status: "exited", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "empty_bootstrap");
  assert.deepEqual(explain.allowedActions, ["archive", "delete_project"]);
  assert.equal(explain.recommendedNextAction, "archive");
  assert.match(explain.why.join(" "), /bootstrap/i);
  assert.match(explain.operatorNotes.join(" "), /canonical bootstrap failure: no root arena-start\.sh/i);
});

test("buildProjectExplain classifies configured TG-Spec launch targets before manual rows", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-stook",
      name: "STOOK",
      archivedAt: null,
      repoUrl: null,
      repoBranch: null,
      providerBillingMode: "platform_credentials",
      tgSpecLaunchConfiguration: "tg_spec_launch_configuration_configured",
      budget: { isEnabled: false },
      app: {
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: null,
        previewUrl: null,
        retryAt: null,
        retryCount: 0,
        containerName: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
    },
  });

  assert.equal(explain.classification, "tg_spec_launch_gated");
  assert.equal(explain.truth.tgSpecLaunchConfiguration, "tg_spec_launch_configuration_configured");
  assert.deepEqual(explain.allowedActions, ["tg_spec_launch_start", "archive", "delete_project"]);
  assert.equal(explain.recommendedNextAction, "tg_spec_launch_start");
  assert.match(explain.why.join(" "), /waiting for explicit launch start/i);
  assert.match(explain.operatorNotes.join(" "), /TG-Spec launch configuration: tg_spec_launch_configuration_configured/i);
});

test("buildProjectExplain treats launch-started repo-less rows as provisioning wait, not manual trash", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-stook-started",
      name: "STOOK Started",
      archivedAt: null,
      repoUrl: null,
      repoBranch: null,
      providerBillingMode: "platform_credentials",
      tgSpecLaunchConfiguration: null,
      budget: { isEnabled: false },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "UNKNOWN",
        previewUrl: null,
        retryAt: null,
        retryCount: 0,
        containerName: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
    },
  });

  assert.equal(explain.classification, "provisioning_wait");
  assert.deepEqual(explain.allowedActions, ["app_off", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.doesNotMatch(explain.why.join(" "), /manual/i);
  assert.match(explain.why.join(" "), /waiting for the provisioner or worker path/i);
});

test("buildProjectExplain does not revive preview truth from raw project_health components", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-4",
      name: "Snapshot Wins",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-snapshot-wins",
      repoBranch: "arena/project-project-4",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: null,
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-4",
        workerHost: "local",
        lastHeartbeat: "2026-04-21T18:30:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.truth.previewHealth, null);
  assert.equal(explain.classification, "active_broken");
  assert.match(explain.why.join(" "), /not converging/i);
});

test("buildProjectExplain does not classify blocked running rows as healthy", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-5",
      name: "Budget Blocked",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-budget",
      repoBranch: "arena/project-project-5",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: ["BUDGET"],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-project-5",
        workerHost: "local",
        lastHeartbeat: "2026-04-21T18:30:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "active_broken");
  assert.deepEqual(explain.allowedActions, ["app_off", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.why.join(" "), /waiting on blockers/i);
  assert.match(explain.why.join(" "), /Current blockers: BUDGET/i);
});

test("buildProjectExplain treats rate limit blockers as wait states", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-rate-limited",
      name: "Rate Limited",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-rate-limited",
      repoBranch: "arena/project-project-rate-limited",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: "2026-05-15T01:40:00.000Z",
        retryCount: 1,
        containerName: "preview-project-rate-limited",
        workerHost: "local",
        lastHeartbeat: "2026-05-14T21:47:57.269Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
    },
  });

  assert.equal(explain.classification, "waiting_by_blocker");
  assert.deepEqual(explain.allowedActions, ["retry_now", "app_off", "no_action"]);
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.match(explain.why.join(" "), /waiting on blockers while the preview remains live/i);
  assert.match(explain.why.join(" "), /Retry is scheduled for 2026-05-15T01:40:00.000Z/i);
});

test("buildProjectExplain surfaces worker capacity exhaustion instead of recommending relaunch", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-capacity-wait",
      name: "Capacity Wait",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-capacity-wait",
      repoBranch: "main",
      budget: null,
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "UNKNOWN",
        previewUrl: null,
        retryAt: null,
        retryCount: 0,
        containerName: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      capacity: {
        maxConcurrentRuns: 32,
        activePreviewContainerCount: 35,
        availableStartCapacity: 0,
        trackedActivePreviewContainerCount: 29,
        staleTrackedPreviewContainers: [],
        untrackedActivePreviewContainers: [
          "preview-orphan-1",
          "preview-orphan-2",
        ],
      },
    },
  });

  assert.equal(explain.classification, "active_broken");
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.deepEqual(explain.truth.workerCapacity, {
    maxConcurrentRuns: 32,
    activePreviewContainerCount: 35,
    availableStartCapacity: 0,
    trackedActivePreviewContainerCount: 29,
    staleTrackedPreviewContainerCount: 0,
    untrackedActivePreviewContainerCount: 2,
    resourcePressure: null,
  });
  assert.match(explain.why.join(" "), /worker has no start capacity/i);
  assert.match(explain.operatorNotes.join(" "), /activePreviewContainers=35, maxConcurrentRuns=32, availableStartCapacity=0/i);
  assert.match(explain.operatorNotes.join(" "), /2 active preview container\(s\) not tracked/i);
});

test("buildProjectExplain surfaces worker resource pressure as capacity evidence", () => {
  const explain = buildProjectExplain({
    snapshot: {
      id: "project-pressure-wait",
      name: "Pressure Wait",
      archivedAt: null,
      repoUrl: "https://github.com/example/arena-pressure-wait",
      repoBranch: "main",
      budget: { isEnabled: false },
      app: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "UNKNOWN",
        previewUrl: null,
        retryAt: null,
        retryCount: 0,
        containerName: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    },
    worker: {
      workerUrl: "http://worker-agent:4201",
      capacity: {
        maxConcurrentRuns: 32,
        activePreviewContainerCount: 14,
        availableStartCapacity: 0,
        trackedActivePreviewContainerCount: 14,
        staleTrackedPreviewContainers: [],
        untrackedActivePreviewContainers: [],
        resourcePressure: {
          constrained: true,
          reasons: ["memory_pressure"],
          memory: {
            usageBytes: 900,
            limitBytes: 1000,
            usageRatio: 0.9,
            thresholdRatio: 0.9,
          },
          pids: {
            current: 854,
            threshold: 800,
          },
          containers: {
            sampled: 18,
            running: 20,
          },
        },
      },
    },
  });

  assert.equal(explain.classification, "active_broken");
  assert.equal(explain.recommendedNextAction, "no_action");
  assert.deepEqual(explain.truth.workerCapacity?.resourcePressure, {
    constrained: true,
    reasons: ["memory_pressure"],
    memoryUsageBytes: 900,
    memoryLimitBytes: 1000,
    memoryUsageRatio: 0.9,
    memoryThresholdRatio: 0.9,
    pidsCurrent: 854,
    pidsLimit: null,
    pidThreshold: 800,
    sampledContainerCount: 18,
    runningContainerCount: 20,
  });
  assert.match(explain.why.join(" "), /worker has no start capacity/i);
  assert.match(explain.operatorNotes.join(" "), /resource pressure: constrained=true, reasons=memory_pressure/i);
});

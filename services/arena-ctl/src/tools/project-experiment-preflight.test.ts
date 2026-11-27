import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RALPH_GITIGNORE_MANAGED_SECTION_END,
  RALPH_GITIGNORE_MANAGED_SECTION_START,
} from "@arena/contracts";
import {
  buildProjectExperimentPreflight,
  parsePorcelainPaths,
  readProjectExperimentPreflight,
} from "./project-experiment-preflight.js";

test("parsePorcelainPaths preserves leading-dot runner paths in compact status lines", () => {
  assert.deepEqual(
    parsePorcelainPaths([
      "D .arena/auth.json",
      " D .arena/progress.json",
      "?? .arena/result.json",
    ].join("\n")),
    [
      ".arena/auth.json",
      ".arena/progress.json",
      ".arena/result.json",
    ],
  );
});

test("buildProjectExperimentPreflight rejects VPS workspace evidence explicitly", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-vps-"));
  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-vps",
      name: "VPS Project",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-vps",
        name: "VPS Project",
        slug: "vps-project",
        runnerBackend: "vps",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.workspace.available, false);
  assert.match(preflight.workspace.unavailableReason ?? "", /VPS projects/i);
  assert.equal(preflight.workspaceDecision, null);
  assert.equal(preflight.sourceBootstrapReadiness.available, false);
  assert.equal(preflight.sourceBootstrapReadiness.evidenceSource, "unavailable");
  assert.equal(preflight.sourceBootstrapReadiness.reasonCode, "source_unavailable");
  assert.deepEqual(preflight.sourceBootstrapReadiness.issues, ["source_snapshot_unavailable"]);
  assert.equal(preflight.gitSyncRisk.available, false);
  assert.equal(preflight.bootstrap.arenaStartExists, null);
  assert.equal(preflight.mode.exactClaimPrediction, "would_not_create_lease");
  assert.equal(preflight.mode.claimDryRunAvailable, true);
  assert.equal(preflight.runnerExpectation.runnerModeSource, "governance_runtime_claim_dry_run");
  assert.equal(preflight.executionReadiness.status, "unknown");
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "none_wait_for_lifecycle_blocker");
  assert.equal(preflight.visualScenarioReadiness.status, "blocked");
  assert.equal(preflight.visualScenarioReadiness.previewUrl, null);
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, null);
  assert(preflight.visualScenarioReadiness.blockers.includes("preview_url_unavailable"));
  assert(preflight.visualScenarioReadiness.blockers.includes("runtime_not_running"));
  assert.deepEqual(preflight.executionReadiness.forbiddenImplicitActions, [
    "no_scheduler",
    "no_hidden_relaunch",
    "no_hidden_retry_unblock",
    "no_hidden_lifecycle_mutation",
    "no_raw_env_exposure",
  ]);
  assert.deepEqual(preflight.helperGaps, [
    "remoteFreshnessNotChecked",
    "vpsWorkspaceUnavailable",
  ]);
});

test("buildProjectExperimentPreflight keeps missing bootstrap non-blocking for agent run", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-local-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "README.md"), "demo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });
  await mkdir(path.join(workspacePath, ".arena"), { recursive: true });
  await writeFile(path.join(workspacePath, ".arena", "platform.md"), "platform\n", "utf8");

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-local",
      name: "Mini Jam",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-local",
        name: "Mini Jam",
        slug: "mini-jam",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "mini-jam",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.workspace.available, true);
  assert.equal(preflight.workspace.path, workspacePath);
  assert.equal(preflight.workspace.exists, true);
  assert.equal(preflight.workspace.nonEmpty, true);
  assert.equal(preflight.workspace.isGitRepo, true);
  assert.equal(preflight.workspace.originUrl, "https://github.com/example/demo");
  assert.equal(preflight.workspaceDecision?.reasonCode, "workspace_matches_repo");
  assert.equal(preflight.sourceBootstrapReadiness.available, true);
  assert.equal(preflight.sourceBootstrapReadiness.evidenceSource, "local_workspace_head_when_workspace_matches_repo");
  assert.equal(preflight.sourceBootstrapReadiness.status, "source_not_preview_runnable");
  assert.equal(preflight.sourceBootstrapReadiness.reasonCode, "readme_only_source");
  assert.equal(preflight.sourceBootstrapReadiness.trackedFilesCount, 1);
  assert.deepEqual(preflight.sourceBootstrapReadiness.trackedFilesPreview, ["README.md"]);
  assert.deepEqual(preflight.sourceBootstrapReadiness.requiredFiles, {
    arenaStartTracked: false,
    packageJsonTracked: false,
  });
  assert.deepEqual(preflight.sourceBootstrapReadiness.issues, [
    "source_bootstrap_missing",
    "source_seed_only",
  ]);
  assert.equal(preflight.gitSyncRisk.available, true);
  assert.equal(preflight.gitSyncRisk.dirty, true);
  assert.equal(preflight.gitSyncRisk.replayableOnly, true);
  assert.equal(preflight.gitSyncRisk.wouldBlockSync, false);
  assert.deepEqual(preflight.gitSyncRisk.blockingPaths, []);
  assert.match(preflight.gitSyncRisk.statusPreview.join("\n"), /\.arena/);
  assert.equal(preflight.bootstrap.arenaStartExists, false);
  assert.equal(preflight.bootstrap.expectedPreviewFailureCode, "preview_start_missing");
  assert.equal(preflight.runnerExpectation.projectBranch, null);
  assert.equal(preflight.runnerExpectation.runnerModeSource, "governance_runtime_claim_dry_run");
  assert.equal(preflight.mode.exactClaimPrediction, "would_create_lease");
  assert.equal(preflight.claimDryRun.wouldCreateLease, true);
  assert.equal(preflight.initReadiness.available, true);
  assert.equal(preflight.executionReadiness.status, "unknown");
  assert.deepEqual(preflight.executionReadiness.blockers, []);
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "none_wait_for_worker_claim");
  assert(preflight.executionReadiness.unknowns.includes("preview_bootstrap_missing_until_agent_writes_it"));
  assert.equal(preflight.visualScenarioReadiness.status, "blocked");
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, null);
  assert(preflight.visualScenarioReadiness.blockers.includes("preview_url_unavailable"));
  assert(preflight.visualScenarioReadiness.blockers.includes("runtime_not_running"));
  assert(preflight.visualScenarioReadiness.blockers.includes("preview_unhealthy"));
  assert(preflight.visualScenarioReadiness.unknowns.includes("source_not_preview_runnable"));
  assert(preflight.visualScenarioReadiness.unknowns.includes("execution_readiness_unknown_for_agent_run"));
});

test("buildProjectExperimentPreflight keeps deleted runner-managed arena files replayable", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-runner-managed-"));
  const workspacePath = await createTrackedWorkspace({
    workspaceRoot,
    slug: "runner-managed-dirty",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
      ".arena/auth.json": "{}\n",
      ".arena/progress.json": "{}\n",
    },
  });
  await rm(path.join(workspacePath, ".arena", "auth.json"));
  await rm(path.join(workspacePath, ".arena", "progress.json"));
  await writeFile(path.join(workspacePath, ".arena", "result.json"), "{}\n", "utf8");

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-runner-managed-dirty",
      name: "Runner Managed Dirty",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-runner-managed-dirty",
        name: "Runner Managed Dirty",
        slug: "runner-managed-dirty",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "runner-managed-dirty",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
  assert.equal(preflight.gitSyncRisk.available, true);
  assert.equal(preflight.gitSyncRisk.dirty, true);
  assert.equal(preflight.gitSyncRisk.replayableOnly, true);
  assert.equal(preflight.gitSyncRisk.wouldBlockSync, false);
  assert.deepEqual(preflight.gitSyncRisk.blockingPaths, []);
  assert.match(preflight.gitSyncRisk.statusPreview.join("\n"), /\.arena\/auth\.json/);
  assert.match(preflight.gitSyncRisk.statusPreview.join("\n"), /\.arena\/result\.json/);
  assert(!preflight.executionReadiness.blockers.includes("workspace_sync_blocked"));
});

test("buildProjectExperimentPreflight blocks agent retry when required Codex authd provider is missing", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-authd-missing-"));
  const workspacePath = await createTrackedWorkspace({
    workspaceRoot,
    slug: "authd-missing",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });
  const missingCodexAuthdHealth = {
    configured: true,
    available: true,
    ok: true,
    error: null,
    providers: {
      codex: {
        status: "missing",
        source: "codex-auth-json",
        version: null,
        checkedAt: "2026-06-11T01:26:52.188Z",
        detail: "Codex auth.json is missing or empty.",
      },
    },
  };

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-authd-missing",
      name: "Authd Missing",
      repoBranch: "main",
      blockers: [],
      previewHealth: "UNKNOWN",
    }),
    worker: {},
    health: {
      project: {
        id: "project-authd-missing",
        name: "Authd Missing",
        slug: "authd-missing",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "authd-missing",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      codexAuthMode: "subscription",
    }),
    authdHealth: missingCodexAuthdHealth,
  });

  assert.equal(preflight.workspace.path, workspacePath);
  assert.equal(preflight.runtimeAuthReadiness.status, "blocked");
  assert.deepEqual(preflight.runtimeAuthReadiness.requiredProviders, ["codex"]);
  assert.equal(preflight.runtimeAuthReadiness.providers.codex?.status, "missing");
  assert(preflight.executionReadiness.blockers.includes("runtime_auth_codex_missing"));
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "blocked");

  const waitingPreflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-authd-missing",
      name: "Authd Missing",
      repoBranch: "main",
      blockers: ["API"],
      runtimeState: "RUNNING",
      agentState: "IDLE",
      provisionedAt: "2026-06-11T01:14:31.791Z",
      previewHealth: "HEALTHY",
      previewUrl: "https://preview.example.test",
    }),
    worker: {},
    health: {
      project: {
        id: "project-authd-missing",
        name: "Authd Missing",
        slug: "authd-missing",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      codexAuthMode: "subscription",
    }),
    authdHealth: missingCodexAuthdHealth,
  });

  assert(waitingPreflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert(waitingPreflight.executionReadiness.blockers.includes("runtime_auth_codex_missing"));
  assert.equal(waitingPreflight.executionReadiness.status, "blocked");
  assert.equal(waitingPreflight.executionReadiness.expectedConvergence, "not_claimable");
  assert.equal(waitingPreflight.executionReadiness.proposedOperatorAction, "blocked");
});

test("buildProjectExperimentPreflight keeps quota-limited Claude OAuth health ready", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-claude-ready-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "claude-ready",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-claude-ready",
      name: "Claude Ready",
      repoBranch: "main",
      providerBillingMode: "platform_credentials",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      previewHealth: "HEALTHY",
      previewUrl: "https://preview.example.test",
      provisionedAt: "2026-06-25T17:36:00.000Z",
    }),
    worker: {},
    health: {
      project: {
        id: "project-claude-ready",
        name: "Claude Ready",
        slug: "claude-ready",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      agent: "claude-code",
      claudeAuthMode: "oauth",
      providerBillingMode: "platform_credentials",
    }),
    authdHealth: {
      configured: true,
      available: true,
      ok: true,
      error: null,
      providers: {
        claude: {
          provider: "claude",
          status: "ready",
          source: "claude-oauth-credentials",
          version: "claude-version",
          checkedAt: "2026-06-25T17:36:00.000Z",
          detail: "Anthropic OAuth usage API returned 429; Claude OAuth credentials are usable but quota is currently limited.",
        },
      },
    },
  });

  assert.equal(preflight.runtimeAuthReadiness.status, "ready");
  assert.equal(preflight.runtimeAuthReadiness.source, "authd");
  assert.deepEqual(preflight.runtimeAuthReadiness.requiredProviders, ["claude"]);
  assert.equal(preflight.runtimeAuthReadiness.providers.claude?.status, "ready");
  assert.match(preflight.runtimeAuthReadiness.providers.claude?.detail ?? "", /quota is currently limited/);
  assert.deepEqual(preflight.runtimeAuthReadiness.blockers, []);
  assert.deepEqual(preflight.runtimeAuthReadiness.unknowns, []);
  assert(!preflight.executionReadiness.blockers.includes("runtime_auth_claude_missing"));
  assert(!preflight.executionReadiness.unknowns.includes("runtime_auth_claude_unknown"));
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert.deepEqual(preflight.executionReadiness.blockers, ["claim_not_agent_run"]);
  assert.deepEqual(preflight.executionReadiness.lifecycleBlockers, ["RATE_LIMIT"]);
});

test("buildProjectExperimentPreflight proposes runtime recreate for stopped active work", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-stopped-active-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "stopped-active-work",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-stopped-active-work",
      name: "Stopped Active Work",
      repoBranch: "main",
      blockers: [],
      runtimeState: "STOPPED",
      agentState: "IDLE",
      provisionedAt: "2026-06-11T03:33:44.363Z",
      previewHealth: "UNKNOWN",
      previewUrl: null,
    }),
    worker: {},
    health: {
      project: {
        id: "project-stopped-active-work",
        name: "Stopped Active Work",
        slug: "stopped-active-work",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert.equal(preflight.lifecycleContext.recommendedNextAction, "recreate_runtime");
  assert(preflight.lifecycleContext.allowedActions.includes("recreate_runtime"));
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert.equal(preflight.executionReadiness.expectedConvergence, "not_claimable");
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "project_recreate_runtime");
  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
});

test("buildProjectExperimentPreflight treats Ralph-managed gitignore add as replayable", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-gitignore-"));
  const workspacePath = await createTrackedWorkspace({
    workspaceRoot,
    slug: "managed-gitignore",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });
  await writeFile(path.join(workspacePath, ".gitignore"), [
    "",
    RALPH_GITIGNORE_MANAGED_SECTION_START,
    "# Detected stack: generic",
    "node_modules/",
    ".arena/*",
    RALPH_GITIGNORE_MANAGED_SECTION_END,
    "",
  ].join("\n"), "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-managed-gitignore",
      name: "Managed Gitignore",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-managed-gitignore",
        name: "Managed Gitignore",
        slug: "managed-gitignore",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "managed-gitignore",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.gitSyncRisk.dirty, true);
  assert.equal(preflight.gitSyncRisk.replayableOnly, true);
  assert.equal(preflight.gitSyncRisk.wouldBlockSync, false);
  assert.deepEqual(preflight.gitSyncRisk.blockingPaths, []);
  assert.match(preflight.gitSyncRisk.statusPreview.join("\n"), /\.gitignore/);
  assert(!preflight.executionReadiness.blockers.includes("workspace_sync_blocked"));
});

test("buildProjectExperimentPreflight blocks user-owned gitignore edits", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-user-gitignore-"));
  const workspacePath = await createTrackedWorkspace({
    workspaceRoot,
    slug: "user-gitignore",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });
  await writeFile(path.join(workspacePath, ".gitignore"), ".env.local\n", "utf8");
  execFileSync("git", ["add", ".gitignore"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-user-gitignore",
      name: "User Gitignore",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-user-gitignore",
        name: "User Gitignore",
        slug: "user-gitignore",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "user-gitignore",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.gitSyncRisk.dirty, true);
  assert.equal(preflight.gitSyncRisk.replayableOnly, false);
  assert.equal(preflight.gitSyncRisk.wouldBlockSync, true);
  assert.deepEqual(preflight.gitSyncRisk.blockingPaths, [".gitignore"]);
  assert(preflight.executionReadiness.blockers.includes("workspace_sync_blocked"));
});

test("buildProjectExperimentPreflight treats arena-start chmod as replayable but content as blocking", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-arena-start-mode-"));
  const chmodWorkspace = await createTrackedWorkspace({
    workspaceRoot,
    slug: "arena-start-mode-only",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });
  execFileSync("git", ["update-index", "--chmod=+x", "arena-start.sh"], { cwd: chmodWorkspace, stdio: "ignore" });

  const modeOnlyPreflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-arena-start-mode-only",
      name: "Arena Start Mode Only",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-arena-start-mode-only",
        name: "Arena Start Mode Only",
        slug: "arena-start-mode-only",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "arena-start-mode-only",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(modeOnlyPreflight.gitSyncRisk.dirty, true);
  assert.equal(modeOnlyPreflight.gitSyncRisk.replayableOnly, true);
  assert.equal(modeOnlyPreflight.gitSyncRisk.wouldBlockSync, false);
  assert.deepEqual(modeOnlyPreflight.gitSyncRisk.blockingPaths, []);

  const contentWorkspace = await createTrackedWorkspace({
    workspaceRoot,
    slug: "arena-start-content-edit",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });
  await writeFile(path.join(contentWorkspace, "arena-start.sh"), "#!/usr/bin/env bash\nnpm start\n", "utf8");

  const contentPreflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-arena-start-content-edit",
      name: "Arena Start Content Edit",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-arena-start-content-edit",
        name: "Arena Start Content Edit",
        slug: "arena-start-content-edit",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "arena-start-content-edit",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(contentPreflight.gitSyncRisk.dirty, true);
  assert.equal(contentPreflight.gitSyncRisk.replayableOnly, false);
  assert.equal(contentPreflight.gitSyncRisk.wouldBlockSync, true);
  assert.deepEqual(contentPreflight.gitSyncRisk.blockingPaths, ["arena-start.sh"]);
  assert(contentPreflight.executionReadiness.blockers.includes("workspace_sync_blocked"));
});

test("buildProjectExperimentPreflight treats fresh project create as awaiting provisioner queue", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-provisioner-"));
  const workspacePath = path.join(workspaceRoot, "fresh-canary");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "README.md"), "fresh canary\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-fresh",
      name: "Fresh Canary",
      repoBranch: "main",
      blockers: [],
      provisionedAt: null,
    }),
    worker: {},
    health: {
      project: {
        id: "project-fresh",
        name: "Fresh Canary",
        slug: "fresh-canary",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.mode.exactClaimPrediction, "would_not_create_lease");
  assert.equal(preflight.lifecycleContext.tuple.provisionedAt, null);
  assert.equal(preflight.executionReadiness.status, "unknown");
  assert.deepEqual(preflight.executionReadiness.blockers, []);
  assert(preflight.executionReadiness.unknowns.includes("awaiting_provisioner_queue"));
  const executionBlockers: readonly string[] = preflight.executionReadiness.blockers;
  assert(!executionBlockers.includes("claim_not_agent_run"));
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "none_wait_for_provisioner_queue");
  assert.equal(preflight.executionReadiness.expectedConvergence, "provisioner_queues_agent_run");
});

test("buildProjectExperimentPreflight observes already-running agent run without false claim blockers", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-running-agent-"));
  const workspacePath = await createTrackedWorkspace({
    workspaceRoot,
    slug: "running-agent",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });
  await mkdir(path.join(workspacePath, ".ralph"), { recursive: true });
  await writeFile(path.join(workspacePath, ".ralph", "plan.json"), "{\"tasks\":[]}\n", "utf8");

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-running-agent",
      name: "Running Agent",
      repoBranch: "main",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      previewHealth: "HEALTHY",
      previewUrl: "https://preview.example.test",
      blockers: [],
      provisionedAt: "2026-06-07T07:30:32.397Z",
    }),
    worker: {},
    health: {
      project: {
        id: "project-running-agent",
        name: "Running Agent",
        slug: "running-agent",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.lifecycleContext.classification, "healthy_agent_run");
  assert.equal(preflight.gitSyncRisk.wouldBlockSync, true);
  assert.deepEqual(preflight.gitSyncRisk.blockingPaths, [".ralph/plan.json"]);
  assert.equal(preflight.executionReadiness.status, "unknown");
  const executionBlockers: readonly string[] = preflight.executionReadiness.blockers;
  assert.equal(executionBlockers.length, 0);
  assert(preflight.executionReadiness.unknowns.includes("agent_run_already_active"));
  assert(!executionBlockers.includes("claim_not_agent_run"));
  assert(!executionBlockers.includes("workspace_sync_blocked"));
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "none_observe_running_agent");
  assert.equal(preflight.executionReadiness.expectedConvergence, "agent_run_in_progress");
  assert.equal(preflight.visualScenarioReadiness.canRunVisualScenario, true);
  assert(!preflight.visualScenarioReadiness.unknowns.includes("execution_not_ready_for_agent_run"));
  assert(!preflight.visualScenarioReadiness.unknowns.includes("execution_readiness_unknown_for_agent_run"));
});

test("buildProjectExperimentPreflight surfaces runtime-intent policy rejections without proposing retry", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-policy-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam-policy");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "README.md"), "demo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-local-policy",
      name: "Mini Jam Policy",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-local-policy",
        name: "Mini Jam Policy",
        slug: "mini-jam-policy",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      policyRejectionReasons: ["start_retry_capacity_exhausted"],
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.deepEqual(preflight.executionReadiness.claimPolicyRejectionReasons, ["start_retry_capacity_exhausted"]);
  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert(preflight.executionReadiness.blockers.includes("claim_policy_start_retry_capacity_exhausted"));
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "blocked");
  assert.equal(preflight.executionReadiness.expectedConvergence, "not_claimable");
  assert.match(preflight.executionReadiness.requiredHumanEvidence.join(" "), /start retry capacity is exhausted/i);
  assert.equal(preflight.sourceBootstrapReadiness.reasonCode, "readme_only_source");
  assert.equal(preflight.visualScenarioReadiness.status, "blocked");
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, null);
  assert(preflight.visualScenarioReadiness.unknowns.includes("execution_not_ready_for_agent_run"));
  assert(preflight.visualScenarioReadiness.unknowns.includes("source_not_preview_runnable"));
});

test("buildProjectExperimentPreflight blocks unsupported agent runtime claim contradictions", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-unsupported-runtime-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "unsupported-runtime",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('demo')\n",
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-unsupported-runtime",
      name: "Unsupported Runtime",
      repoBranch: "main",
      blockers: [],
      loopSupportStatus: "upgrade-required",
      agentStartAllowed: false,
    }),
    worker: {},
    health: {
      project: {
        id: "project-unsupported-runtime",
        name: "Unsupported Runtime",
        slug: "unsupported-runtime",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      policyRejectionReasons: ["agent_runtime_unsupported"],
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.lifecycleContext.classification, "unsupported_runtime");
  assert.equal(preflight.mode.exactClaimPrediction, "would_not_create_lease");
  assert.deepEqual(preflight.executionReadiness.claimPolicyRejectionReasons, ["agent_runtime_unsupported"]);
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert(preflight.executionReadiness.blockers.includes("claim_policy_agent_runtime_unsupported"));
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "blocked");
  assert.equal(preflight.executionReadiness.expectedConvergence, "not_claimable");
  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
  assert(preflight.visualScenarioReadiness.unknowns.includes("execution_not_ready_for_agent_run"));
});

test("buildProjectExperimentPreflight imports TG-Spec launch-gated lifecycle truth", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-stook-"));

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-stook",
      name: "STOOK",
      repoUrl: null,
      repoBranch: null,
      providerBillingMode: "platform_credentials",
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      previewHealth: null,
      tgSpecLaunchConfiguration: "tg_spec_launch_configuration_configured",
    }),
    worker: {},
    health: {
      project: {
        id: "project-stook",
        name: "STOOK",
        slug: "stook",
        runnerBackend: "local",
        repoUrl: null,
        repoBranch: null,
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      codexAuthMode: "subscription",
    }),
    authdHealth: {
      configured: true,
      available: true,
      ok: false,
      providers: {
        codex: {
          provider: "codex",
          status: "missing",
          source: "authd",
          detail: "Codex auth.json is missing or empty.",
        },
      },
    },
  });

  assert.equal(preflight.lifecycleContext.classification, "tg_spec_launch_gated");
  assert.equal(preflight.lifecycleContext.tgSpecLaunchConfiguration, "tg_spec_launch_configuration_configured");
  assert.deepEqual(preflight.lifecycleContext.allowedActions, ["tg_spec_launch_start", "archive", "delete_project"]);
  assert.equal(preflight.lifecycleContext.recommendedNextAction, "tg_spec_launch_start");
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert(preflight.executionReadiness.blockers.includes("runtime_auth_codex_missing"));
  assert.equal(preflight.executionReadiness.expectedConvergence, "not_claimable");
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "blocked");
});

test("buildProjectExperimentPreflight proposes tg-spec launch start when only the explicit launch gate remains", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-tg-launch-clean-"));
  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-stook-clean",
      name: "STOOK Clean",
      repoUrl: null,
      repoBranch: "main",
      providerBillingMode: "platform_credentials",
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      previewHealth: null,
      tgSpecLaunchConfiguration: "tg_spec_launch_configuration_configured",
    }),
    worker: {},
    health: {
      project: {
        id: "project-stook-clean",
        name: "STOOK Clean",
        slug: "stook-clean",
        runnerBackend: "local",
        repoUrl: null,
        repoBranch: null,
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      codexAuthMode: "api_key",
      providerBillingMode: "platform_credentials",
    }),
    tokenStatus: buildTokenStatus({
      "openai-api": { hasToken: true, hash: "openai-hash", updatedAt: Date.parse("2026-06-11T00:00:00.000Z"), freshness: "fresh" },
    }),
  });

  assert.equal(preflight.lifecycleContext.classification, "tg_spec_launch_gated");
  assert.equal(preflight.lifecycleContext.recommendedNextAction, "tg_spec_launch_start");
  assert.equal(preflight.runtimeAuthReadiness.status, "ready");
  assert.equal(preflight.runtimeAuthReadiness.source, "token_manager");
  assert.deepEqual(preflight.runtimeAuthReadiness.requiredProviders, ["openai-api"]);
  assert(preflight.runtimeAuthReadiness.evidenceNotes.includes(
    "TokenManager-backed providers mean this run uses API-key credentials, not authd subscription/OAuth runtime auth.",
  ));
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert.deepEqual(preflight.executionReadiness.blockers, ["claim_not_agent_run"]);
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "tg_spec_launch_start");
  assert.equal(preflight.executionReadiness.expectedConvergence, "provisioner_queues_agent_run");
  assert.match(preflight.executionReadiness.reason, /waiting for explicit tg_spec_launch_start/);
  assert(preflight.executionReadiness.requiredHumanEvidence.includes(
    "Runtime auth readiness uses TokenManager API-key credentials; confirm the operator intentionally accepts API-key cost/auth path before mutating launch or retry.",
  ));
});

test("buildProjectExperimentPreflight blocks tg-spec launch start when platform Codex API key is missing", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-tg-launch-missing-token-"));
  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-stook-missing-token",
      name: "STOOK Missing Token",
      repoUrl: null,
      repoBranch: "main",
      providerBillingMode: "platform_credentials",
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      previewHealth: null,
      tgSpecLaunchConfiguration: "tg_spec_launch_configuration_configured",
    }),
    worker: {},
    health: {
      project: {
        id: "project-stook-missing-token",
        name: "STOOK Missing Token",
        slug: "stook-missing-token",
        runnerBackend: "local",
        repoUrl: null,
        repoBranch: null,
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      codexAuthMode: "api_key",
      providerBillingMode: "platform_credentials",
    }),
    tokenStatus: buildTokenStatus({
      "openai-api": { hasToken: false, freshness: "missing" },
    }),
  });

  assert.equal(preflight.lifecycleContext.classification, "tg_spec_launch_gated");
  assert.equal(preflight.lifecycleContext.recommendedNextAction, "tg_spec_launch_start");
  assert.equal(preflight.runtimeAuthReadiness.status, "blocked");
  assert.equal(preflight.runtimeAuthReadiness.source, "token_manager");
  assert.deepEqual(preflight.runtimeAuthReadiness.requiredProviders, ["openai-api"]);
  assert.equal(preflight.runtimeAuthReadiness.providers["openai-api"]?.status, "missing");
  assert(preflight.runtimeAuthReadiness.evidenceNotes.includes(
    "TokenManager-backed providers mean this run uses API-key credentials, not authd subscription/OAuth runtime auth.",
  ));
  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert(preflight.executionReadiness.blockers.includes("runtime_auth_openai_api_missing"));
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "blocked");
  assert.equal(preflight.executionReadiness.expectedConvergence, "not_claimable");
});

test("buildProjectExperimentPreflight waits when lifecycle owner recommends no_action for rate limits", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-rate-limit-wait-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "stook-wait",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\nnode server.mjs\n",
      "package.json": "{\"scripts\":{\"start\":\"node server.mjs\"}}\n",
      "server.mjs": "console.log('ready');\n",
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-stook-wait",
      name: "STOOK Wait",
      repoBranch: "main",
      providerBillingMode: "platform_credentials",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      previewHealth: "HEALTHY",
      previewUrl: "https://preview.example.com",
      provisionedAt: "2026-06-11T03:33:44.363Z",
    }),
    worker: {},
    health: {
      project: {
        id: "project-stook-wait",
        name: "STOOK Wait",
        slug: "stook-wait",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    }),
    initReadiness: buildInitReadiness({
      commandResolvable: true,
      codexAuthMode: "api_key",
      providerBillingMode: "platform_credentials",
    }),
    tokenStatus: buildTokenStatus({
      "openai-api": {
        hasToken: true,
        hash: "openai-hash",
        updatedAt: Date.parse("2026-06-11T00:00:00.000Z"),
        freshness: "fresh",
      },
    }),
  });

  assert.equal(preflight.lifecycleContext.classification, "waiting_by_blocker");
  assert.equal(preflight.lifecycleContext.recommendedNextAction, "no_action");
  assert.equal(preflight.runtimeAuthReadiness.status, "ready");
  assert.equal(preflight.executionReadiness.status, "blocked");
  assert.deepEqual(preflight.executionReadiness.blockers, ["claim_not_agent_run"]);
  assert.deepEqual(preflight.executionReadiness.lifecycleBlockers, ["RATE_LIMIT"]);
  assert.equal(preflight.executionReadiness.proposedOperatorAction, "none_wait_for_lifecycle_blocker");
  assert.equal(preflight.executionReadiness.expectedConvergence, "supervisor_resume");
  assert.deepEqual(preflight.executionReadiness.requiredHumanEvidence, []);
  assert.match(preflight.executionReadiness.reason, /lifecycle owner recommends no_action/i);
  assert.match(preflight.executionReadiness.reason, /lifecycle blockers are RATE_LIMIT/i);
});

test("buildProjectExperimentPreflight blocks preview-only restore when bootstrap is missing", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-preview-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam-preview");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "README.md"), "demo\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-local-preview",
      name: "Mini Jam Preview",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-local-preview",
        name: "Mini Jam Preview",
        slug: "mini-jam-preview",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "preview_only",
        attempt: 1,
        workspaceLabel: "mini-jam-preview",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.executionReadiness.status, "blocked");
  assert.deepEqual(preflight.executionReadiness.blockers, ["bootstrap_missing"]);
  assert.equal(preflight.executionReadiness.expectedConvergence, "worker_claims_preview_only");
  assert.deepEqual(preflight.sourceBootstrapReadiness.issues, [
    "source_bootstrap_missing",
    "source_seed_only",
  ]);
  assert.equal(preflight.visualScenarioReadiness.status, "blocked");
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, null);
  assert(preflight.visualScenarioReadiness.unknowns.includes("source_not_preview_runnable"));
});

test("buildProjectExperimentPreflight does not classify source readiness from mismatched workspace", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-mismatch-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam-mismatch");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "dev"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "arena-start.sh"), "#!/usr/bin/env bash\n", "utf8");
  execFileSync("git", ["add", "arena-start.sh"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-local-mismatch",
      name: "Mini Jam Mismatch",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-local-mismatch",
        name: "Mini Jam Mismatch",
        slug: "mini-jam-mismatch",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
        workspaceLabel: "mini-jam-mismatch",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.notEqual(preflight.workspaceDecision?.reasonCode, "workspace_matches_repo");
  assert.equal(preflight.sourceBootstrapReadiness.available, false);
  assert.equal(preflight.sourceBootstrapReadiness.reasonCode, "workspace_not_source_snapshot");
  assert.deepEqual(preflight.sourceBootstrapReadiness.issues, ["source_snapshot_not_matching_configured_source"]);
  assert.deepEqual(preflight.sourceBootstrapReadiness.trackedFilesPreview, []);
  assert.equal(preflight.visualScenarioReadiness.status, "blocked");
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, null);
  assert(preflight.visualScenarioReadiness.blockers.includes("preview_url_unavailable"));
});

test("buildProjectExperimentPreflight trusts init readiness commit snapshot when health omits commitSha", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-init-commit-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam-init-commit");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "arena/project-project-init-commit"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "arena-start.sh"), "#!/usr/bin/env bash\n", "utf8");
  execFileSync("git", ["add", "arena-start.sh"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspacePath, encoding: "utf8" }).trim();

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-init-commit",
      name: "Mini Jam Init Commit",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-init-commit",
        name: "Mini Jam Init Commit",
        slug: "mini-jam-init-commit",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true, commitSha }),
  });

  assert.equal(preflight.runnerExpectation.commitSha, commitSha);
  assert.equal(preflight.workspaceDecision?.reasonCode, "workspace_matches_repo");
  assert.equal(preflight.sourceBootstrapReadiness.available, true);
  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
});

test("buildProjectExperimentPreflight exposes visual scenario base URL only for healthy preview evidence", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-visual-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam-visual");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "arena-start.sh"), "#!/usr/bin/env bash\n", "utf8");
  execFileSync("git", ["add", "arena-start.sh"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-visual",
      name: "Mini Jam Visual",
      repoBranch: "main",
      runtimeState: "RUNNING",
      previewHealth: "HEALTHY",
      previewUrl: "https://preview-mini-jam.example.test",
      blockers: [],
    }),
    worker: {},
    health: {
      project: {
        id: "project-visual",
        name: "Mini Jam Visual",
        slug: "mini-jam-visual",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "preview_only",
        attempt: 1,
        workspaceLabel: "mini-jam-visual",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
  assert.equal(preflight.visualScenarioReadiness.status, "ready");
  assert.equal(preflight.visualScenarioReadiness.canRunVisualScenario, true);
  assert.equal(preflight.visualScenarioReadiness.previewUrl, "https://preview-mini-jam.example.test");
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, "https://preview-mini-jam.example.test");
  assert.deepEqual(preflight.visualScenarioReadiness.blockers, []);
  assert.deepEqual(preflight.visualScenarioReadiness.unknowns, []);
  assert(preflight.sourceBootstrapReadiness.unknowns.includes("remoteFreshnessNotChecked"));
  assert(preflight.helperGaps.includes("remoteFreshnessNotChecked"));
  assert.match(preflight.visualScenarioReadiness.reason, /healthy enough/i);
  assert.match(preflight.visualScenarioReadiness.evidenceNotes.join(" "), /does not start previews/);
  assert.match(preflight.visualScenarioReadiness.evidenceNotes.join(" "), /do not block capture/);
  assert.match(preflight.visualScenarioReadiness.evidenceNotes.join(" "), /owner fields instead of making current-preview visual scenario readiness unknown/i);
});

test("buildProjectExperimentPreflight keeps current healthy preview capture independent from agent-run readiness", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-visual-current-"));
  const workspacePath = path.join(workspaceRoot, "healthy-current-preview");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "arena-start.sh"), "#!/usr/bin/env bash\n", "utf8");
  execFileSync("git", ["add", "arena-start.sh"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "agent_run",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-healthy-current-preview",
      name: "Healthy Current Preview",
      repoBranch: "main",
      runtimeState: "RUNNING",
      previewHealth: "HEALTHY",
      previewUrl: "https://preview-current.example.test",
      blockers: [],
    }),
    worker: {},
    health: {
      project: {
        id: "project-healthy-current-preview",
        name: "Healthy Current Preview",
        slug: "healthy-current-preview",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: false,
      policyRejectionReasons: ["start_retry_capacity_exhausted"],
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.executionReadiness.status, "blocked");
  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
  assert.equal(preflight.visualScenarioReadiness.canRunVisualScenario, true);
  assert.equal(preflight.visualScenarioReadiness.status, "ready");
  assert.deepEqual(preflight.visualScenarioReadiness.blockers, []);
  assert.deepEqual(preflight.visualScenarioReadiness.unknowns, []);
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, "https://preview-current.example.test");
  assert(preflight.executionReadiness.blockers.includes("claim_not_agent_run"));
});

test("buildProjectExperimentPreflight blocks visual scenarios when preview URL exists but preview is unhealthy", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-visual-unhealthy-"));
  const workspacePath = path.join(workspaceRoot, "mini-jam-visual-unhealthy");
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });
  await writeFile(path.join(workspacePath, "arena-start.sh"), "#!/usr/bin/env bash\n", "utf8");
  execFileSync("git", ["add", "arena-start.sh"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-visual-unhealthy",
      name: "Mini Jam Visual Unhealthy",
      repoBranch: "main",
      runtimeState: "RUNNING",
      previewHealth: "UNHEALTHY",
      previewUrl: "https://preview-mini-jam.example.test",
      blockers: ["INFRA"],
    }),
    worker: {},
    health: {
      project: {
        id: "project-visual-unhealthy",
        name: "Mini Jam Visual Unhealthy",
        slug: "mini-jam-visual-unhealthy",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "preview_only",
        attempt: 1,
        workspaceLabel: "mini-jam-visual-unhealthy",
        workerImage: "arena-public-worker:local",
      },
    }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.visualScenarioReadiness.status, "blocked");
  assert.equal(preflight.visualScenarioReadiness.previewUrl, "https://preview-mini-jam.example.test");
  assert.equal(preflight.visualScenarioReadiness.recommendedBaseUrl, null);
  assert(preflight.visualScenarioReadiness.blockers.includes("preview_unhealthy"));
});

test("buildProjectExperimentPreflight reports missing Visual Workbench manifest without fallback capture", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-workbench-missing-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "workbench-missing",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-workbench-missing",
      name: "Workbench Missing",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-workbench-missing",
        name: "Workbench Missing",
        slug: "workbench-missing",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.sourceBootstrapReadiness.status, "preview_runnable");
  assert.equal(preflight.visualWorkbenchManifestReadiness.status, "blocked");
  assert.equal(preflight.visualWorkbenchManifestReadiness.canRunWorkbenchCapture, false);
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture, null);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.blockers, ["manifest_missing"]);
  assert.match(preflight.visualWorkbenchManifestReadiness.evidenceNotes.join(" "), /no page-screenshot fallback/i);
});

test("buildProjectExperimentPreflight extracts valid Visual Workbench manifest readiness", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-workbench-valid-"));
  const manifest = buildVisualWorkbenchManifest({
    stories: [
      buildVisualWorkbenchStory({
        id: "jam-room.empty.mobile",
        kind: "feature",
        feature: "jam-room",
        widget: "JamRoom",
        state: "empty",
        viewport: { name: "mobile", width: 390, height: 844 },
      }),
      buildVisualWorkbenchStory({
        id: "transport.playing.desktop",
        kind: "widget",
        feature: "transport",
        widget: "TransportControls",
        state: "playing",
        viewport: { name: "desktop", width: 1440, height: 900 },
      }),
    ],
  });
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "workbench-valid",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "visual-workbench/manifest.json": JSON.stringify(manifest, null, 2),
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-workbench-valid",
      name: "Workbench Valid",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-workbench-valid",
        name: "Workbench Valid",
        slug: "workbench-valid",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.visualWorkbenchManifestReadiness.available, true);
  assert.equal(preflight.visualWorkbenchManifestReadiness.status, "ready");
  assert.equal(preflight.visualWorkbenchManifestReadiness.canRunWorkbenchCapture, true);
  assert.equal(preflight.visualWorkbenchManifestReadiness.schemaVersion, "ra-355.visual-coverage-manifest.v0");
  assert.equal(preflight.visualWorkbenchManifestReadiness.projectClass, "ordinary_web");
  assert.equal(preflight.visualWorkbenchManifestReadiness.serveCommand, "npm run visual-workbench");
  assert.equal(preflight.visualWorkbenchManifestReadiness.storyRoutePattern, "/__visual/:storyId");
  assert.equal(preflight.visualWorkbenchManifestReadiness.storyCount, 2);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.features, ["jam-room", "transport"]);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.widgets, ["JamRoom", "TransportControls"]);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.states, ["empty", "playing"]);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.viewportNames, ["desktop", "mobile"]);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.stories.map((story) => ({
    id: story.id,
    kind: story.kind,
    feature: story.feature,
    widget: story.widget,
    state: story.state,
    route: story.route,
    mockStateName: story.mockStateName,
    viewportNames: story.viewportNames,
    taskRelevanceDefaultFor: story.taskRelevanceDefaultFor,
  })), [{
    id: "jam-room.empty.mobile",
    kind: "feature",
    feature: "jam-room",
    widget: "JamRoom",
    state: "empty",
    route: "/__visual/jam-room.empty.mobile",
    mockStateName: "JamRoom.empty",
    viewportNames: ["mobile"],
    taskRelevanceDefaultFor: [],
  }, {
    id: "transport.playing.desktop",
    kind: "widget",
    feature: "transport",
    widget: "TransportControls",
    state: "playing",
    route: "/__visual/transport.playing.desktop",
    mockStateName: "TransportControls.playing",
    viewportNames: ["desktop"],
    taskRelevanceDefaultFor: [],
  }]);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.blockers, []);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.unknowns, []);
  assert(preflight.sourceBootstrapReadiness.unknowns.includes("remoteFreshnessNotChecked"));
  assert(preflight.helperGaps.includes("remoteFreshnessNotChecked"));
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture?.stageId, "visual_workbench_capture");
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture?.selection, "full_manifest");
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture?.baseUrlHint, "http://127.0.0.1:<operator-selected-free-port>");
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture?.baseUrlPurpose, "local_workbench_server");
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture?.previewUrlIsNotWorkbenchBaseUrl, true);
  assert.match(preflight.visualWorkbenchManifestReadiness.recommendedCapture?.outputDirHint ?? "", /project-workbench-valid/);
  assert.match(
    preflight.visualWorkbenchManifestReadiness.evidenceNotes.join(" "),
    /preview URL is not a substitute/i,
  );
  assert.match(
    preflight.visualWorkbenchManifestReadiness.evidenceNotes.join(" "),
    /source-owned coverage catalog/i,
  );
  assert.match(
    preflight.visualWorkbenchManifestReadiness.evidenceNotes.join(" "),
    /external expected-state catalog/i,
  );
  assert.match(
    preflight.visualWorkbenchManifestReadiness.evidenceNotes.join(" "),
    /Remote freshness remains a top-level preflight\/source-bootstrap caveat/i,
  );
});

test("buildProjectExperimentPreflight blocks invalid Visual Workbench manifest JSON", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-workbench-invalid-json-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "workbench-invalid-json",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "visual-workbench/manifest.json": "{ not-json\n",
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-workbench-invalid-json",
      name: "Workbench Invalid JSON",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-workbench-invalid-json",
        name: "Workbench Invalid JSON",
        slug: "workbench-invalid-json",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.visualWorkbenchManifestReadiness.status, "blocked");
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.blockers, ["manifest_invalid_json"]);
  assert.equal(preflight.visualWorkbenchManifestReadiness.canRunWorkbenchCapture, false);
});

test("buildProjectExperimentPreflight reports unsupported Visual Workbench schema version", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-workbench-schema-drift-"));
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "workbench-schema-drift",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "visual-workbench/manifest.json": JSON.stringify({
        ...buildVisualWorkbenchManifest({
          stories: [buildVisualWorkbenchStory({
            id: "jam-room.empty.mobile",
            kind: "feature",
            feature: "jam-room",
            widget: "JamRoom",
            state: "empty",
            viewport: { name: "mobile", width: 390, height: 844 },
          })],
        }),
        schemaVersion: "ra-356.visual-coverage-manifest.v1",
      }, null, 2),
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-workbench-schema-drift",
      name: "Workbench Schema Drift",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-workbench-schema-drift",
        name: "Workbench Schema Drift",
        slug: "workbench-schema-drift",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.visualWorkbenchManifestReadiness.status, "blocked");
  assert.equal(preflight.visualWorkbenchManifestReadiness.schemaVersion, "ra-356.visual-coverage-manifest.v1");
  assert(preflight.visualWorkbenchManifestReadiness.blockers.includes("manifest_schema_unsupported"));
  assert.equal(preflight.visualWorkbenchManifestReadiness.canRunWorkbenchCapture, false);
});

test("buildProjectExperimentPreflight blocks duplicate Visual Workbench story ids", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-workbench-duplicates-"));
  const story = buildVisualWorkbenchStory({
    id: "jam-room.empty.mobile",
    kind: "feature",
    feature: "jam-room",
    widget: "JamRoom",
    state: "empty",
    viewport: { name: "mobile", width: 390, height: 844 },
  });
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "workbench-duplicates",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "visual-workbench/manifest.json": JSON.stringify(buildVisualWorkbenchManifest({
        stories: [story, story],
      }), null, 2),
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-workbench-duplicates",
      name: "Workbench Duplicates",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-workbench-duplicates",
        name: "Workbench Duplicates",
        slug: "workbench-duplicates",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.visualWorkbenchManifestReadiness.status, "blocked");
  assert(preflight.visualWorkbenchManifestReadiness.blockers.includes("story_id_duplicate"));
  assert.equal(preflight.visualWorkbenchManifestReadiness.canRunWorkbenchCapture, false);
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture, null);
});

test("buildProjectExperimentPreflight reports Visual Workbench manifest issue details", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-workbench-issue-details-"));
  const story = {
    ...buildVisualWorkbenchStory({
      id: "jam-room.empty.mobile",
      kind: "feature",
      feature: "jam-room",
      widget: "JamRoom",
      state: "empty",
      viewport: { name: "mobile", width: 390, height: 844 },
    }),
    source: "stories/jam-room.empty.mobile.json",
  };
  await createTrackedWorkspace({
    workspaceRoot,
    slug: "workbench-issue-details",
    files: {
      "arena-start.sh": "#!/usr/bin/env bash\n",
      "visual-workbench/manifest.json": JSON.stringify(buildVisualWorkbenchManifest({
        stories: [story],
      }), null, 2),
    },
  });

  const preflight = await buildProjectExperimentPreflight({
    requestedMode: "preview_only",
    ctx: { config: { workspaceRoot } },
    snapshot: buildSnapshot({
      id: "project-workbench-issue-details",
      name: "Workbench Issue Details",
      repoBranch: "main",
    }),
    worker: {},
    health: {
      project: {
        id: "project-workbench-issue-details",
        name: "Workbench Issue Details",
        slug: "workbench-issue-details",
        runnerBackend: "local",
        repoUrl: "https://github.com/example/demo",
        repoBranch: "main",
        commitSha: null,
      },
    },
    claimDryRun: buildClaimDryRun({ wouldCreateLease: false }),
    initReadiness: buildInitReadiness({ commandResolvable: true }),
  });

  assert.equal(preflight.visualWorkbenchManifestReadiness.status, "blocked");
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.blockers, ["story_required_field_missing"]);
  assert.equal(preflight.visualWorkbenchManifestReadiness.issueDetails.length, 1);
  assert.deepEqual(preflight.visualWorkbenchManifestReadiness.issueDetails[0], {
    ...preflight.visualWorkbenchManifestReadiness.issueDetails[0],
    code: "story_required_field_missing",
    path: ["stories", 0],
    field: "source",
    storyIndex: 0,
    storyId: "jam-room.empty.mobile",
    keys: ["source"],
  });
  assert.match(preflight.visualWorkbenchManifestReadiness.issueDetails[0]?.message ?? "", /source/);
  assert.equal(preflight.visualWorkbenchManifestReadiness.recommendedCapture, null);
});

test("readProjectExperimentPreflight sends current worker capacity to governance dry-run", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-capacity-context-"));
  const dryRunCalls: Array<{ projectId: string; opts: Record<string, unknown> }> = [];
  const workerSnapshot = {
    workerUrl: "http://worker-agent:4201",
    health: {
      activePreviewContainers: ["preview-one", "preview-two"],
      availableStartCapacity: 3,
      maxConcurrentRuns: 5,
      activePreviewContainerCount: 2,
    },
    capacity: {
      maxConcurrentRuns: 5,
      activePreviewContainerCount: 2,
      availableStartCapacity: 3,
      trackedActivePreviewContainerCount: 2,
      staleTrackedPreviewContainers: [],
      untrackedActivePreviewContainers: [],
      resourcePressure: {
        constrained: true,
        reasons: ["resource_pressure_unavailable"],
      },
    },
  };
  const ctx = {
    config: { workspaceRoot },
    governance: {
      getProjectSnapshot: async () => buildSnapshot({
        id: "project-capacity-context",
        name: "Capacity Context",
        repoBranch: "main",
        blockers: [],
        provisionedAt: "2026-06-07T07:30:32.397Z",
      }),
      getProjectWorkerSnapshot: async () => workerSnapshot,
      getProjectHealth: async () => ({
        project: {
          id: "project-capacity-context",
          name: "Capacity Context",
          slug: "capacity-context",
          runnerBackend: "local",
          repoUrl: "https://github.com/example/demo",
          repoBranch: "main",
          commitSha: null,
        },
      }),
      getProjectRuntimeClaimDryRun: async (projectId: string, opts: Record<string, unknown>) => {
        dryRunCalls.push({ projectId, opts });
        return buildClaimDryRun({
          wouldCreateLease: false,
          blockingReasons: ["existing_lifecycle_blocker"],
        });
      },
      getProjectRunnerInitReadiness: async () => buildInitReadiness({ commandResolvable: true }),
    },
  };

  const preflight = await readProjectExperimentPreflight({
    ctx: ctx as any,
    projectId: "project-capacity-context",
    requestedMode: "agent_run",
  });

  assert.equal(dryRunCalls.length, 1);
  assert.equal(dryRunCalls[0]?.projectId, "project-capacity-context");
  assert.deepEqual(dryRunCalls[0]?.opts, {
    host: "local",
    capacity: 3,
    activePreviewContainers: ["preview-one", "preview-two"],
  });
  assert.equal(preflight.mode.exactClaimPrediction, "would_not_create_lease");
  assert.deepEqual(preflight.executionReadiness.claimPolicyRejectionReasons, []);
  assert.deepEqual(preflight.workerCapacityInput, {
    source: "capacity_diagnostics",
    capacityForDryRun: 3,
    failClosed: false,
    activePreviewContainersSupplied: true,
    activePreviewContainersPreview: ["preview-one", "preview-two"],
    maxConcurrentRuns: 5,
    activePreviewContainerCount: 2,
    availableStartCapacity: 3,
    resourcePressureConstrained: true,
    resourcePressureReasons: ["resource_pressure_unavailable"],
    healthError: null,
    notes: [
      "Worker capacity input explains the evidence forwarded into governance runtime-claim dry-run.",
      "Worker resource-pressure telemetry was unavailable; capacityForDryRun still comes from worker capacity diagnostics, and this note does not create lifecycle, retry or proof truth.",
    ],
  });
});

test("readProjectExperimentPreflight fails closed when worker capacity is unavailable", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "arena-preflight-capacity-unavailable-"));
  const dryRunCalls: Array<{ projectId: string; opts: Record<string, unknown> }> = [];
  const ctx = {
    config: { workspaceRoot },
    governance: {
      getProjectSnapshot: async () => buildSnapshot({
        id: "project-capacity-unavailable",
        name: "Capacity Unavailable",
        repoBranch: "main",
        blockers: [],
        provisionedAt: "2026-06-07T07:30:32.397Z",
      }),
      getProjectWorkerSnapshot: async () => ({
        workerUrl: "http://worker-agent:4201",
        health: null,
        capacity: null,
        errors: {
          health: {
            ok: false,
            status: 504,
            error: "worker health timed out",
          },
        },
      }),
      getProjectHealth: async () => ({
        project: {
          id: "project-capacity-unavailable",
          name: "Capacity Unavailable",
          slug: "capacity-unavailable",
          runnerBackend: "local",
          repoUrl: "https://github.com/example/demo",
          repoBranch: "main",
          commitSha: null,
        },
      }),
      getProjectRuntimeClaimDryRun: async (projectId: string, opts: Record<string, unknown>) => {
        dryRunCalls.push({ projectId, opts });
        return buildClaimDryRun({
          wouldCreateLease: false,
          policyRejectionReasons: ["start_capacity_exhausted"],
        });
      },
      getProjectRunnerInitReadiness: async () => buildInitReadiness({ commandResolvable: true }),
    },
  };

  const preflight = await readProjectExperimentPreflight({
    ctx: ctx as any,
    projectId: "project-capacity-unavailable",
    requestedMode: "agent_run",
  });

  assert.deepEqual(dryRunCalls[0]?.opts, {
    host: "local",
    capacity: 0,
  });
  assert(preflight.helperGaps.includes("workerCapacityUnavailable"));
  assert(preflight.executionReadiness.claimPolicyRejectionReasons.includes("start_capacity_exhausted"));
  assert.deepEqual(preflight.workerCapacityInput, {
    source: "unavailable",
    capacityForDryRun: 0,
    failClosed: true,
    activePreviewContainersSupplied: false,
    activePreviewContainersPreview: [],
    maxConcurrentRuns: null,
    activePreviewContainerCount: null,
    availableStartCapacity: null,
    resourcePressureConstrained: null,
    resourcePressureReasons: [],
    healthError: "504: worker health timed out",
    notes: [
      "Worker capacity input explains the evidence forwarded into governance runtime-claim dry-run.",
      "Worker capacity was unavailable, so preflight sent capacity=0 to fail closed instead of inventing start capacity.",
    ],
  });
});

function buildSnapshot(input: {
  id: string;
  name: string;
  repoBranch: string | null;
  repoUrl?: string | null;
  providerBillingMode?: string | null;
  powerIntent?: string;
  agentIntent?: string;
  runtimeState?: string;
  previewHealth?: string | null;
  previewUrl?: string | null;
  blockers?: string[];
  lastOutcome?: string | null;
  provisionedAt?: string | null;
  loopSupportStatus?: string;
  agentStartAllowed?: boolean;
  agentState?: string;
  tgSpecLaunchConfiguration?: "tg_spec_launch_configuration_required" | "tg_spec_launch_configuration_configured" | null;
}) {
  return {
    id: input.id,
    name: input.name,
    archivedAt: null,
    repoUrl: "repoUrl" in input ? input.repoUrl ?? null : "https://github.com/example/demo",
    repoBranch: input.repoBranch,
    providerBillingMode: input.providerBillingMode ?? "api",
    tgSpecLaunchConfiguration: input.tgSpecLaunchConfiguration ?? null,
    budget: { isEnabled: false },
    app: {
      powerIntent: input.powerIntent ?? "ON",
      agentIntent: input.agentIntent ?? "ON",
      runtimeState: input.runtimeState ?? "ABSENT",
      agentState: input.agentState ?? "IDLE",
      blockers: input.blockers ?? ["INFRA"],
      lastOutcome: input.lastOutcome ?? null,
      provisionedAt: input.provisionedAt ?? null,
      previewHealth: "previewHealth" in input ? input.previewHealth ?? null : "UNHEALTHY",
      previewUrl: input.previewUrl ?? null,
      retryAt: null,
      retryCount: 0,
      containerName: null,
      workerHost: "local",
      lastHeartbeat: null,
    },
    loopRuntime: "ralph Bundled default",
    loopSupportStatus: input.loopSupportStatus ?? "supported",
    loopSupportLabel: input.loopSupportStatus ?? "supported",
    loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
    appStartAllowed: true,
    agentStartAllowed: input.agentStartAllowed ?? true,
    relaunchAllowed: input.agentStartAllowed ?? true,
  };
}

function buildClaimDryRun(input: {
  wouldCreateLease: boolean;
  wouldClaim?: Record<string, unknown> | null;
  policyRejectionReasons?: string[];
  blockingReasons?: string[];
}) {
  return {
    schemaVersion: "ra-356.runtime-claim-dry-run.v1",
    projectId: "project-1",
    host: "local",
    backend: "local" as const,
    capacity: 1,
    activePreviewContainersSupplied: false,
    evaluatedAt: "2026-06-06T00:00:00.000Z",
    candidate: null,
    policyDecision: null,
    policyRejectionReasons: input.policyRejectionReasons ?? [],
    wouldCreateLease: input.wouldCreateLease,
    wouldClaim: input.wouldClaim ?? null,
    launch: {
      required: input.wouldCreateLease,
      status: input.wouldCreateLease ? "ready" : "not_required",
      sanitized: true,
      payload: input.wouldCreateLease
        ? {
          workspaceLabel: "mini-jam",
          workerImage: "arena-public-worker:local",
          envSummary: {
            exposesValues: false,
            categories: ["arena_core"],
            projectEnvOverrideCount: 0,
            projectSecretCount: 0,
            auth: "provider_proxy",
          },
        }
        : null,
      message: null,
    },
    blockingReasons: input.blockingReasons ?? [],
    evidenceNotes: [],
  };
}

function buildInitReadiness(input: {
  commandResolvable: boolean;
  agent?: string;
  codexAuthMode?: string | null;
  claudeAuthMode?: string | null;
  providerBillingMode?: string;
  commitSha?: string | null;
}) {
  return {
    schemaVersion: "ra-356.runner-init-readiness.v1",
    projectId: "project-1",
    available: true,
    project: {
      id: "project-1",
      name: "Mini Jam",
      hasPendingLoopWork: true,
      agent: input.agent ?? "codex",
      agentImpl: "ralph",
      model: "gpt-5.4",
      claudeAuthMode: input.claudeAuthMode ?? null,
      codexAuthMode: input.codexAuthMode ?? null,
      providerBillingMode: input.providerBillingMode ?? "platform_credits",
      commitSha: input.commitSha ?? null,
      agentIntent: "ON",
    },
    command: {
      present: input.commandResolvable,
      source: input.commandResolvable ? "agent_loop_version" : "missing",
      resolvable: input.commandResolvable,
      unresolvedPlaceholders: [],
    },
    blockers: input.commandResolvable ? [] : ["init_command_missing"],
  };
}

function buildTokenStatus(providers: Record<string, {
  hasToken: boolean;
  hash?: string;
  updatedAt?: number;
  freshness?: string;
}>) {
  return {
    available: true,
    providers,
  };
}

async function createTrackedWorkspace(input: {
  workspaceRoot: string;
  slug: string;
  files: Record<string, string>;
}) {
  const workspacePath = path.join(input.workspaceRoot, input.slug);
  await mkdir(workspacePath, { recursive: true });
  execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["checkout", "-B", "main"], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "arena-test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Arena Test"], { cwd: workspacePath });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/demo.git"], { cwd: workspacePath });

  for (const [relativePath, contents] of Object.entries(input.files)) {
    const absolutePath = path.join(workspacePath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }

  execFileSync("git", ["add", "."], { cwd: workspacePath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspacePath, stdio: "ignore" });

  return workspacePath;
}

function buildVisualWorkbenchManifest(input: {
  stories: Record<string, unknown>[];
}) {
  return {
    schemaVersion: "ra-355.visual-coverage-manifest.v0",
    projectClass: "ordinary_web",
    workbench: {
      serveCommand: "npm run visual-workbench",
      baseUrlEnv: "VISUAL_WORKBENCH_BASE_URL",
      storyRoutePattern: "/__visual/:storyId",
    },
    coveragePolicy: {
      mode: "strict_canary",
      selectionDefault: "full_manifest",
      simplificationRequiresEvidence: true,
    },
    stories: input.stories,
  };
}

function buildVisualWorkbenchStory(input: {
  id: string;
  kind: string;
  feature: string;
  widget: string;
  state: string;
  viewport: { name: string; width: number; height: number };
}) {
  return {
    id: input.id,
    title: `${input.widget} / ${input.state}`,
    kind: input.kind,
    feature: input.feature,
    widget: input.widget,
    state: input.state,
    claim: `${input.widget} renders the ${input.state} state.`,
    render: {
      type: "workbench_route",
      path: `/__visual/${input.id}`,
    },
    mockState: {
      name: `${input.widget}.${input.state}`,
    },
    viewports: [input.viewport],
  };
}

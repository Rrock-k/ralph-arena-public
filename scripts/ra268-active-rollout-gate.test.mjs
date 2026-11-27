#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthdEndpointReport } from "./authd-http-canary.mjs";
import { buildReadinessCanaryReport } from "./governance-rollout-canary.mjs";
import {
  buildDirtyWorktreeReport,
  buildRa268ActiveRolloutGateReport,
  buildWorkerMetaEndpointReport,
} from "./ra268-active-rollout-gate.mjs";

const readyReadiness = {
  schemaVersion: "ra-344.governance-readiness.v1",
  status: "ready",
  generatedAt: "2026-06-26T00:00:00.000Z",
  build: {
    id: "build-123",
    sha: "abcdef123456",
    source: "GOVERNANCE_BUILD_ID",
  },
  slot: {
    id: "ra268",
  },
  scheduler: {
    role: "active",
    enabled: true,
  },
  database: {
    status: "reachable",
  },
  migration: {
    status: "not_required",
  },
  blockers: [],
};
const expectedGovernanceReleaseSha = "abcdef123456";

const quotaSnapshot = {
  generatedAt: "2026-06-26T00:00:00.000Z",
  results: [
    {
      provider: "anthropic",
      source: "anthropic-oauth",
      ok: false,
      error: "Anthropic OAuth usage API returned 429; quota is currently limited.",
      windows: [],
    },
    {
      provider: "openai",
      source: "codex-rpc",
      ok: true,
      windows: [{ label: "5h" }],
    },
  ],
};

const postMortem = {
  provider: "claude",
  health: {
    status: "ready",
    source: "claude-oauth-credentials",
  },
  quota: {
    ok: false,
    error: "Anthropic OAuth usage API returned 429; quota is currently limited.",
  },
  diagnosis: "quota_limited",
  detail: "Anthropic OAuth usage API returned 429; quota is currently limited.",
};

const workerMeta = {
  hostId: "local",
  capturedAt: "2026-06-26T00:00:00.000Z",
  worker: {
    version: "1.0.0",
    gitSha: "127357b33850",
    buildTime: null,
    image: "arena-public-worker:local",
    nodeVersion: "v22.0.0",
    platform: "linux",
    arch: "arm64",
    hostname: "worker-agent",
  },
  runner: {
    gitSha: "127357b33850",
    buildTime: null,
    defaultImage: "arena-public-worker:local",
  },
  containerRuntime: {
    engine: "docker",
    version: "27.0.0",
    network: "arena-public-network",
    previewDomain: "localhost:8080",
  },
};

test("passes when local/public readiness and active authd endpoint all pass", () => {
  const report = buildRa268ActiveRolloutGateReport({
    generatedAt: "2026-06-26T00:00:00.000Z",
    expectedGovernanceReleaseSha,
    expectedWorkerGitSha: "127357b33850",
    expectedWorkerImage: "arena-public-worker:local",
    dirtyWorktreeReport: buildDirtyWorktreeReport([]),
    localReadinessReport: readinessReport(readyReadiness, 200),
    publicReadinessReport: readinessReport(readyReadiness, 200),
    authdEndpointReport: buildAuthdEndpointReport({
      url: "http://127.0.0.1:4311",
      quotaSnapshot,
      postMortem,
    }),
    workerMetaEndpointReport: workerMetaReport(workerMeta),
  });

  assert.equal(report.taskId, "RA-268");
  assert.equal(report.mode, "active-rollout-gate");
  assert.equal(report.nonIntervention, true);
  assert.equal(report.activeServiceMutation, false);
  assert.equal(report.target.expectedGovernanceReleaseSha, expectedGovernanceReleaseSha);
  assert.equal(report.decision, "pass");
  assert.deepEqual(report.blockedReasons, []);
});

test("blocks when readiness and active authd endpoint still expose old active state", () => {
  const notReady = {
    ...readyReadiness,
    status: "not_ready",
    build: { id: null, sha: null, source: null },
    slot: { id: null },
    migration: { status: "not_reported" },
    blockers: ["missing_build_id", "missing_slot_id", "migration_not_reported"],
  };
  const report = buildRa268ActiveRolloutGateReport({
    dirtyWorktreeReport: buildDirtyWorktreeReport([]),
    expectedGovernanceReleaseSha,
    localReadinessReport: readinessReport(notReady, 503),
    publicReadinessReport: readinessReport(notReady, 503),
    authdEndpointReport: buildAuthdEndpointReport({
      url: "http://127.0.0.1:4311",
      quotaSnapshot: {
        ...quotaSnapshot,
        results: [
          {
            provider: "anthropic",
            source: "anthropic-oauth",
            ok: false,
            error: "Anthropic OAuth usage API returned 429.",
            windows: [],
          },
          quotaSnapshot.results[1],
        ],
      },
      postMortem: {
        ...postMortem,
        quota: {
          ok: false,
          error: "Anthropic OAuth usage API returned 429.",
        },
        diagnosis: "quota_unavailable",
        detail: "Anthropic OAuth usage API returned 429.",
      },
    }),
    workerMetaEndpointReport: workerMetaReport(workerMeta),
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("local-readiness-decision:")));
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("public-readiness-decision:")));
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("authd-endpoint-decision:")));
});

test("allows unrelated dirty paths while surfacing them in the gate report", () => {
  const dirtyWorktreeReport = buildDirtyWorktreeReport([
    " M services/arena-ctl/src/tools/project-explain.ts",
    "?? apps/governance-platform/public/short-html/example.html",
  ]);
  const report = buildRa268ActiveRolloutGateReport({
    dirtyWorktreeReport,
    expectedGovernanceReleaseSha,
    localReadinessReport: readinessReport(readyReadiness, 200),
    publicReadinessReport: readinessReport(readyReadiness, 200),
    authdEndpointReport: buildAuthdEndpointReport({
      url: "http://127.0.0.1:4311",
      quotaSnapshot,
      postMortem,
    }),
    workerMetaEndpointReport: workerMetaReport(workerMeta),
  });

  assert.equal(dirtyWorktreeReport.allowed, true);
  assert.equal(report.decision, "pass");
  assert.deepEqual(report.dirtyWorktree.ignoredDirectStaticPublicInputs, [
    "apps/governance-platform/public/short-html/example.html",
  ]);
  assert.deepEqual(report.dirtyWorktree.unrelatedDirty, [
    "services/arena-ctl/src/tools/project-explain.ts",
  ]);
});

test("blocks dirty authd worker and rollout-control build inputs", () => {
  const dirtyWorktreeReport = buildDirtyWorktreeReport([
    " M services/authd/src/index.ts",
    " M packages/contracts/src/provider-auth.ts",
    " M services/arena-runner/src/index.ts",
    " M scripts/docker-local-stack.sh",
  ]);
  const report = buildRa268ActiveRolloutGateReport({
    dirtyWorktreeReport,
    expectedGovernanceReleaseSha,
    localReadinessReport: readinessReport(readyReadiness, 200),
    publicReadinessReport: readinessReport(readyReadiness, 200),
    authdEndpointReport: buildAuthdEndpointReport({
      url: "http://127.0.0.1:4311",
      quotaSnapshot,
      postMortem,
    }),
    workerMetaEndpointReport: workerMetaReport(workerMeta),
  });

  assert.equal(dirtyWorktreeReport.allowed, false);
  assert.ok(dirtyWorktreeReport.authdBuildInputs.includes("services/authd/src/index.ts"));
  assert.ok(dirtyWorktreeReport.workerBuildInputs.includes("services/arena-runner/src/index.ts"));
  assert.ok(dirtyWorktreeReport.rolloutControlInputs.includes("scripts/docker-local-stack.sh"));
  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("dirty-worktree-gate:")));
});

test("blocks when active worker meta reports stale worker-service generation", () => {
  const staleWorkerMeta = {
    ...workerMeta,
    worker: {
      ...workerMeta.worker,
      gitSha: "oldworker1234",
    },
    runner: {
      ...workerMeta.runner,
      gitSha: "oldrunner1234",
    },
  };
  const report = buildRa268ActiveRolloutGateReport({
    expectedWorkerGitSha: "127357b33850",
    expectedWorkerImage: "arena-public-worker:local",
    expectedGovernanceReleaseSha,
    dirtyWorktreeReport: buildDirtyWorktreeReport([]),
    localReadinessReport: readinessReport(readyReadiness, 200),
    publicReadinessReport: readinessReport(readyReadiness, 200),
    authdEndpointReport: buildAuthdEndpointReport({
      url: "http://127.0.0.1:4311",
      quotaSnapshot,
      postMortem,
    }),
    workerMetaEndpointReport: workerMetaReport(staleWorkerMeta),
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("worker-meta-decision:")));
  assert.deepEqual(report.reports.workerMeta.parity.reasons, [
    "worker_sha_mismatch:oldworker1234",
    "runner_sha_mismatch:oldrunner1234",
  ]);
});

test("blocks when active governance readiness reports stale release sha", () => {
  const staleReadiness = {
    ...readyReadiness,
    build: {
      ...readyReadiness.build,
      sha: "oldrelease123",
    },
  };
  const report = buildRa268ActiveRolloutGateReport({
    expectedGovernanceReleaseSha,
    expectedWorkerGitSha: "127357b33850",
    expectedWorkerImage: "arena-public-worker:local",
    dirtyWorktreeReport: buildDirtyWorktreeReport([]),
    localReadinessReport: readinessReport(staleReadiness, 200, "oldrelease123"),
    publicReadinessReport: readinessReport(readyReadiness, 200),
    authdEndpointReport: buildAuthdEndpointReport({
      url: "http://127.0.0.1:4311",
      quotaSnapshot,
      postMortem,
    }),
    workerMetaEndpointReport: workerMetaReport(workerMeta),
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("local-readiness-release-sha:")));
});

function readinessReport(readiness, httpStatus, expectedReleaseSha = expectedGovernanceReleaseSha) {
  return buildReadinessCanaryReport({
    readiness,
    httpStatus,
    contentType: "application/json; charset=utf-8",
    expectedSchedulerRole: "active",
    expectedReleaseSha,
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
}

function workerMetaReport(meta) {
  return buildWorkerMetaEndpointReport({
    url: "http://127.0.0.1:4201/meta",
    httpStatus: 200,
    contentType: "application/json; charset=utf-8",
    workerMeta: meta,
    expectedWorkerGitSha: "127357b33850",
    expectedWorkerImage: "arena-public-worker:local",
    workerSecretProvided: true,
  });
}

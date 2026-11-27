#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runAuthdEndpointCheck } from "./authd-http-canary.mjs";
import { buildReadinessCanaryReport } from "./governance-rollout-canary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

const defaultLocalReadinessUrl = "http://127.0.0.1:3000/api/readiness";
const defaultPublicReadinessUrl = "https://app.arena.example.test/api/readiness";
const defaultAuthdUrl = "http://127.0.0.1:4311";
const defaultWorkerUrl = "http://127.0.0.1:4201";
const defaultWorkerImage = "arena-public-worker:local";
const workerServiceGenerationPaths = [
  "services/worker-agent",
  "services/arena-runner",
  "packages/loops/ralph-runtime",
  "packages/contracts",
];
const directStaticPublicInputPrefixes = [
  "apps/governance-platform/public/short-html/",
];
const authdBuildInputPrefixes = [
  "packages/contracts/",
  "services/authd/",
];
const authdBuildInputFiles = [
  "services/authd/Dockerfile",
  "docker-compose.local.yml",
  ".dockerignore",
];
const workerBuildInputPrefixes = [
  "packages/contracts/",
  "packages/loops/ralph-runtime/",
  "services/arena-runner/",
];
const workerBuildInputFiles = [
  "services/worker-agent/Dockerfile.worker",
  "services/worker-agent/arena-agy-with-keyring.sh",
  ".dockerignore",
];
const governanceCommittedInputPrefixes = [
  "apps/governance-platform/",
  "packages/contracts/",
  "packages/loops/ralph-runtime/",
];
const governanceCommittedInputFiles = [
  "apps/governance-platform/Dockerfile.local-production",
  "package.json",
  "package-lock.json",
];
const rolloutControlFiles = [
  "scripts/docker-local-stack.sh",
  "scripts/authd-http-canary.mjs",
  "scripts/governance-rollout-canary.mjs",
  "scripts/ra268-active-rollout-gate.mjs",
  "docker-compose.local.yml",
];

export function buildRa268ActiveRolloutGateReport(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const expectedGovernanceReleaseSha = normalizeOptionalGitSha(options.expectedGovernanceReleaseSha);
  const dirtyWorktree = options.dirtyWorktreeReport ?? null;
  const localReadiness = options.localReadinessReport ?? null;
  const publicReadiness = options.publicReadinessReport ?? null;
  const authdEndpoint = options.authdEndpointReport ?? null;
  const workerMeta = options.workerMetaEndpointReport ?? null;
  const checks = [];

  validateDirtyWorktreeReport(dirtyWorktree, checks);
  validateReadinessReport(localReadiness, "local", checks, expectedGovernanceReleaseSha);
  validateReadinessReport(publicReadiness, "public", checks, expectedGovernanceReleaseSha);
  validateAuthdEndpointReport(authdEndpoint, checks);
  validateWorkerMetaEndpointReport(workerMeta, checks);

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-268",
    mode: "active-rollout-gate",
    generatedAt,
    operator: "scripts/ra268-active-rollout-gate.mjs",
    nonIntervention: true,
    activeServiceMutation: false,
    target: {
      localReadinessUrl: options.localReadinessUrl ?? defaultLocalReadinessUrl,
      publicReadinessUrl: options.publicReadinessUrl ?? defaultPublicReadinessUrl,
      expectedGovernanceReleaseSha,
      authdUrl: options.authdUrl ?? defaultAuthdUrl,
      workerUrl: options.workerUrl ?? defaultWorkerUrl,
      expectedWorkerGitSha: options.expectedWorkerGitSha ?? workerMeta?.target?.expectedWorkerGitSha ?? null,
      expectedWorkerImage: options.expectedWorkerImage ?? workerMeta?.target?.expectedWorkerImage ?? defaultWorkerImage,
    },
    dirtyWorktree: summarizeDirtyWorktreeReport(dirtyWorktree),
    reports: {
      localReadiness: summarizeReadinessReport(localReadiness),
      publicReadiness: summarizeReadinessReport(publicReadiness),
      authdEndpoint: summarizeAuthdEndpointReport(authdEndpoint),
      workerMeta: summarizeWorkerMetaEndpointReport(workerMeta),
    },
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "pass" : "block",
  };
}

export async function runRa268ActiveRolloutGate(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const fetchTimeoutMs = Number(options.fetchTimeoutMs ?? 10_000);
  const localReadinessUrl = normalizeUrl(options.localReadinessUrl ?? defaultLocalReadinessUrl, "local readiness URL");
  const publicReadinessUrl = normalizeUrl(options.publicReadinessUrl ?? defaultPublicReadinessUrl, "public readiness URL");
  const authdUrl = normalizeUrl(options.authdUrl ?? defaultAuthdUrl, "authd URL").replace(/\/+$/, "");
  const workerUrl = normalizeUrl(options.workerUrl ?? defaultWorkerUrl, "worker URL").replace(/\/+$/, "");
  const env = loadLocalEnvNoOverride();
  const expectedGovernanceReleaseSha = normalizeOptionalGitSha(
    options.expectedGovernanceReleaseSha ?? readExpectedGovernanceGitSha(),
  );
  const expectedWorkerGitSha = normalizeOptionalGitSha(
    options.expectedWorkerGitSha ?? readExpectedWorkerServiceGitSha(),
  );
  const expectedWorkerImage = normalizeOptionalString(
    options.expectedWorkerImage ?? env.WORKER_IMAGE ?? defaultWorkerImage,
  );
  const workerSecret = `${options.workerSecret ?? env.WORKER_SECRET ?? env.RUNNER_WEBHOOK_SECRET ?? ""}`;
  const dirtyWorktreeReport = buildDirtyWorktreeReport(readGitStatusShort());

  const [localReadinessReport, publicReadinessReport, authdEndpointReport, workerMetaEndpointReport] = await Promise.all([
    runReadinessCanary(localReadinessUrl, { generatedAt, fetchTimeoutMs, expectedGovernanceReleaseSha }),
    runReadinessCanary(publicReadinessUrl, { generatedAt, fetchTimeoutMs, expectedGovernanceReleaseSha }),
    runAuthdEndpointCheck({ url: authdUrl, generatedAt, fetchTimeoutMs }),
    runWorkerMetaEndpointCheck({
      url: workerUrl,
      generatedAt,
      fetchTimeoutMs,
      expectedWorkerGitSha,
      expectedWorkerImage,
      workerSecret,
    }),
  ]);

  return buildRa268ActiveRolloutGateReport({
    generatedAt,
    localReadinessUrl,
    publicReadinessUrl,
    expectedGovernanceReleaseSha,
    authdUrl,
    workerUrl,
    expectedWorkerGitSha,
    expectedWorkerImage,
    dirtyWorktreeReport,
    localReadinessReport,
    publicReadinessReport,
    authdEndpointReport,
    workerMetaEndpointReport,
  });
}

export function buildWorkerMetaEndpointReport(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [];
  const workerMeta = options.workerMeta ?? null;
  const expectedWorkerGitSha = normalizeOptionalGitSha(options.expectedWorkerGitSha);
  const expectedWorkerImage = normalizeOptionalString(options.expectedWorkerImage ?? defaultWorkerImage);
  const parity = buildWorkerServiceParity({
    expectedWorkerGitSha,
    expectedWorkerImage,
    workerMeta,
  });

  if (options.transportError) {
    checks.push(block("worker-meta-fetch", `worker /meta fetch failed: ${options.transportError}`));
  } else if (options.httpStatus === 200) {
    checks.push(pass("worker-meta-http-status", "worker /meta returned 200"));
  } else {
    checks.push(block("worker-meta-http-status", `worker /meta returned ${options.httpStatus ?? "missing"}`));
  }

  if (options.contentType !== undefined) {
    if (isJsonContentType(options.contentType)) {
      checks.push(pass("worker-meta-content-type", "worker /meta returned JSON"));
    } else {
      checks.push(block("worker-meta-content-type", `worker /meta returned ${options.contentType || "unknown"}`));
    }
  }

  if (workerMeta && typeof workerMeta === "object" && !Array.isArray(workerMeta)) {
    checks.push(pass("worker-meta-json", "worker /meta payload is a JSON object"));
  } else {
    checks.push(block("worker-meta-json", "worker /meta payload is not a JSON object"));
  }

  if (expectedWorkerGitSha) {
    checks.push(pass("expected-worker-git-sha", `expected worker-service sha is ${expectedWorkerGitSha}`));
  } else {
    checks.push(block("expected-worker-git-sha", "expected worker-service sha is unavailable"));
  }

  if (expectedWorkerImage) {
    checks.push(pass("expected-worker-image", `expected worker image is ${expectedWorkerImage}`));
  } else {
    checks.push(block("expected-worker-image", "expected worker image is unavailable"));
  }

  if (parity.status === "clean") {
    checks.push(pass("worker-service-parity", "worker /meta matches expected worker-service generation"));
  } else {
    checks.push(block("worker-service-parity", `worker /meta mismatch: ${parity.reasons.join(", ") || "unknown"}`));
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-268",
    mode: "worker-meta-endpoint-check",
    generatedAt,
    operator: "scripts/ra268-active-rollout-gate.mjs",
    activeServiceMutation: false,
    temporaryContainer: false,
    target: {
      url: options.url ?? null,
      expectedWorkerGitSha,
      expectedWorkerImage,
      workerSecretProvided: Boolean(options.workerSecretProvided),
    },
    workerMeta: summarizeWorkerMeta(workerMeta),
    parity,
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "pass" : "block",
  };
}

export function buildDirtyWorktreeReport(statusSummary = []) {
  const entries = statusSummary.map(parseDirtyStatusLine).filter(Boolean);
  const authdBuildInputs = entries
    .filter((entry) => entry.categories.includes("authd-build-input"))
    .map((entry) => entry.path);
  const workerBuildInputs = entries
    .filter((entry) => entry.categories.includes("worker-build-input"))
    .map((entry) => entry.path);
  const rolloutControlInputs = entries
    .filter((entry) => entry.categories.includes("rollout-control-input"))
    .map((entry) => entry.path);
  const governanceCommittedInputs = entries
    .filter((entry) => entry.categories.includes("governance-committed-input"))
    .map((entry) => entry.path);
  const directStaticPublicInputs = entries
    .filter((entry) => entry.categories.includes("direct-static-public-input"))
    .map((entry) => entry.path);
  const docsOrWorkNotes = entries
    .filter((entry) => entry.categories.includes("docs-or-work-note"))
    .map((entry) => entry.path);
  const unrelatedDirty = entries
    .filter((entry) => entry.categories.includes("unrelated"))
    .map((entry) => entry.path);
  const blockingPaths = unique([
    ...authdBuildInputs,
    ...workerBuildInputs,
    ...rolloutControlInputs,
  ]);

  return {
    clean: entries.length === 0,
    allowed: blockingPaths.length === 0,
    statusSummary,
    entries,
    authdBuildInputs,
    workerBuildInputs,
    rolloutControlInputs,
    blockingPaths,
    governanceCommittedInputs,
    directStaticPublicInputs,
    docsOrWorkNotes,
    unrelatedDirty,
    ignoredGovernanceCommittedInputs: governanceCommittedInputs,
    ignoredDirectStaticPublicInputs: directStaticPublicInputs,
  };
}

async function runReadinessCanary(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.fetchTimeoutMs ?? 10_000));

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let readiness = null;
    if (isJsonContentType(contentType)) {
      readiness = await response.json();
    } else {
      await response.text();
    }
    return buildReadinessCanaryReport({
      url,
      readiness,
      httpStatus: response.status,
      contentType,
      expectedSchedulerRole: "active",
      expectedReleaseSha: options.expectedGovernanceReleaseSha,
      generatedAt: options.generatedAt,
    });
  } catch (error) {
    return buildReadinessCanaryReport({
      url,
      readiness: null,
      transportError: error instanceof Error ? error.message : String(error),
      expectedSchedulerRole: "active",
      expectedReleaseSha: options.expectedGovernanceReleaseSha,
      generatedAt: options.generatedAt,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runWorkerMetaEndpointCheck(options = {}) {
  const url = `${normalizeUrl(options.url ?? defaultWorkerUrl, "worker URL").replace(/\/+$/, "")}/meta`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.fetchTimeoutMs ?? 10_000));
  const headers = { accept: "application/json" };
  const workerSecret = `${options.workerSecret ?? ""}`;
  if (workerSecret) {
    headers["x-worker-secret"] = workerSecret;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let workerMeta = null;
    if (isJsonContentType(contentType)) {
      workerMeta = await response.json();
    } else {
      await response.text();
    }
    return buildWorkerMetaEndpointReport({
      generatedAt: options.generatedAt,
      url,
      httpStatus: response.status,
      contentType,
      workerMeta,
      expectedWorkerGitSha: options.expectedWorkerGitSha,
      expectedWorkerImage: options.expectedWorkerImage,
      workerSecretProvided: Boolean(workerSecret),
    });
  } catch (error) {
    return buildWorkerMetaEndpointReport({
      generatedAt: options.generatedAt,
      url,
      transportError: error instanceof Error ? error.message : String(error),
      workerMeta: null,
      expectedWorkerGitSha: options.expectedWorkerGitSha,
      expectedWorkerImage: options.expectedWorkerImage,
      workerSecretProvided: Boolean(workerSecret),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function validateDirtyWorktreeReport(report, checks) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    checks.push(block("dirty-worktree-report", "dirty worktree report is missing"));
    return;
  }

  checks.push(pass("dirty-worktree-report", "dirty worktree report is present"));
  if (report.allowed === true) {
    const reason = report.clean
      ? "git worktree is clean"
      : "git worktree has no RA-268 build-critical dirty paths";
    checks.push(pass("dirty-worktree-gate", reason));
  } else {
    checks.push(block(
      "dirty-worktree-gate",
      `RA-268 build-critical dirty paths: ${(report.blockingPaths ?? []).join(", ") || "unknown"}`,
    ));
  }
}

function validateReadinessReport(report, scope, checks, expectedGovernanceReleaseSha) {
  const label = `${scope} readiness`;
  if (
    report?.taskId === "RA-344"
    && report.mode === "readiness-canary"
    && report.nonIntervention === true
  ) {
    checks.push(pass(`${scope}-readiness-identity`, `${label} uses the canonical readiness canary`));
  } else {
    checks.push(block(`${scope}-readiness-identity`, `${label} report is missing or has the wrong identity`));
  }

  if (report?.decision === "allow-promotion" && (report.blockedReasons?.length ?? 0) === 0) {
    checks.push(pass(`${scope}-readiness-decision`, `${label} is ready`));
  } else {
    checks.push(block(
      `${scope}-readiness-decision`,
      `${label} is ${report?.decision ?? "missing"}: ${(report?.blockedReasons ?? []).join("; ") || "no report"}`,
    ));
  }

  const actualReleaseSha = normalizeOptionalGitSha(report?.readiness?.releaseSha);
  if (!expectedGovernanceReleaseSha) {
    checks.push(block(`${scope}-readiness-release-sha`, "expected governance release sha is unavailable"));
  } else if (gitShaMatches(actualReleaseSha, expectedGovernanceReleaseSha)) {
    checks.push(pass(
      `${scope}-readiness-release-sha`,
      `${label} release sha matches ${expectedGovernanceReleaseSha}`,
    ));
  } else {
    checks.push(block(
      `${scope}-readiness-release-sha`,
      `${label} release sha is ${actualReleaseSha || "missing"}, expected ${expectedGovernanceReleaseSha}`,
    ));
  }
}

function summarizeDirtyWorktreeReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  return {
    clean: report.clean ?? null,
    allowed: report.allowed ?? null,
    statusSummary: Array.isArray(report.statusSummary) ? report.statusSummary : null,
    authdBuildInputs: Array.isArray(report.authdBuildInputs) ? report.authdBuildInputs : null,
    workerBuildInputs: Array.isArray(report.workerBuildInputs) ? report.workerBuildInputs : null,
    rolloutControlInputs: Array.isArray(report.rolloutControlInputs) ? report.rolloutControlInputs : null,
    blockingPaths: Array.isArray(report.blockingPaths) ? report.blockingPaths : null,
    governanceCommittedInputs: Array.isArray(report.governanceCommittedInputs)
      ? report.governanceCommittedInputs
      : null,
    directStaticPublicInputs: Array.isArray(report.directStaticPublicInputs)
      ? report.directStaticPublicInputs
      : null,
    ignoredGovernanceCommittedInputs: Array.isArray(report.ignoredGovernanceCommittedInputs)
      ? report.ignoredGovernanceCommittedInputs
      : null,
    ignoredDirectStaticPublicInputs: Array.isArray(report.ignoredDirectStaticPublicInputs)
      ? report.ignoredDirectStaticPublicInputs
      : null,
    docsOrWorkNotes: Array.isArray(report.docsOrWorkNotes) ? report.docsOrWorkNotes : null,
    unrelatedDirty: Array.isArray(report.unrelatedDirty) ? report.unrelatedDirty : null,
  };
}

function validateAuthdEndpointReport(report, checks) {
  if (
    report?.taskId === "RA-268"
    && report.mode === "authd-http-endpoint-check"
    && report.activeServiceMutation === false
    && report.temporaryContainer === false
  ) {
    checks.push(pass("authd-endpoint-identity", "active authd endpoint uses the RA-268 endpoint check"));
  } else {
    checks.push(block("authd-endpoint-identity", "active authd endpoint report is missing or has the wrong identity"));
  }

  if (report?.decision === "pass" && (report.blockedReasons?.length ?? 0) === 0) {
    checks.push(pass("authd-endpoint-decision", "active authd endpoint passes quota/post-mortem checks"));
  } else {
    checks.push(block(
      "authd-endpoint-decision",
      `active authd endpoint is ${report?.decision ?? "missing"}: ${(report?.blockedReasons ?? []).join("; ") || "no report"}`,
    ));
  }
}

function validateWorkerMetaEndpointReport(report, checks) {
  if (
    report?.taskId === "RA-268"
    && report.mode === "worker-meta-endpoint-check"
    && report.activeServiceMutation === false
    && report.temporaryContainer === false
  ) {
    checks.push(pass("worker-meta-identity", "active worker /meta uses the RA-268 endpoint check"));
  } else {
    checks.push(block("worker-meta-identity", "active worker /meta report is missing or has the wrong identity"));
  }

  if (report?.decision === "pass" && (report.blockedReasons?.length ?? 0) === 0) {
    checks.push(pass("worker-meta-decision", "active worker /meta matches expected worker-service generation"));
  } else {
    checks.push(block(
      "worker-meta-decision",
      `active worker /meta is ${report?.decision ?? "missing"}: ${(report?.blockedReasons ?? []).join("; ") || "no report"}`,
    ));
  }
}

function summarizeReadinessReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  return {
    taskId: report.taskId ?? null,
    mode: report.mode ?? null,
    decision: report.decision ?? null,
    url: report.target?.url ?? null,
    readiness: report.readiness ?? null,
    blockedReasons: Array.isArray(report.blockedReasons) ? report.blockedReasons : null,
  };
}

function summarizeAuthdEndpointReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  return {
    taskId: report.taskId ?? null,
    mode: report.mode ?? null,
    decision: report.decision ?? null,
    url: report.target?.url ?? null,
    quotaSnapshot: report.quotaSnapshot ?? null,
    postMortem: report.postMortem ?? null,
    blockedReasons: Array.isArray(report.blockedReasons) ? report.blockedReasons : null,
  };
}

function summarizeWorkerMetaEndpointReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  return {
    taskId: report.taskId ?? null,
    mode: report.mode ?? null,
    decision: report.decision ?? null,
    url: report.target?.url ?? null,
    expectedWorkerGitSha: report.target?.expectedWorkerGitSha ?? null,
    expectedWorkerImage: report.target?.expectedWorkerImage ?? null,
    workerSecretProvided: report.target?.workerSecretProvided ?? null,
    workerMeta: report.workerMeta ?? null,
    parity: report.parity ?? null,
    blockedReasons: Array.isArray(report.blockedReasons) ? report.blockedReasons : null,
  };
}

function summarizeWorkerMeta(workerMeta) {
  if (!workerMeta || typeof workerMeta !== "object" || Array.isArray(workerMeta)) return null;
  return {
    hostId: workerMeta.hostId ?? null,
    capturedAt: workerMeta.capturedAt ?? null,
    worker: {
      version: workerMeta.worker?.version ?? null,
      gitSha: workerMeta.worker?.gitSha ?? null,
      buildTime: workerMeta.worker?.buildTime ?? null,
      image: workerMeta.worker?.image ?? null,
      nodeVersion: workerMeta.worker?.nodeVersion ?? null,
      platform: workerMeta.worker?.platform ?? null,
      arch: workerMeta.worker?.arch ?? null,
      hostname: workerMeta.worker?.hostname ?? null,
    },
    runner: {
      gitSha: workerMeta.runner?.gitSha ?? null,
      buildTime: workerMeta.runner?.buildTime ?? null,
      defaultImage: workerMeta.runner?.defaultImage ?? null,
    },
    containerRuntime: {
      engine: workerMeta.containerRuntime?.engine ?? null,
      version: workerMeta.containerRuntime?.version ?? null,
      network: workerMeta.containerRuntime?.network ?? null,
      previewDomain: workerMeta.containerRuntime?.previewDomain ?? null,
    },
  };
}

function buildWorkerServiceParity(input = {}) {
  const expectedWorkerGitSha = normalizeOptionalString(input.expectedWorkerGitSha);
  const expectedWorkerImage = normalizeOptionalString(input.expectedWorkerImage);
  const workerMeta = input.workerMeta && typeof input.workerMeta === "object" && !Array.isArray(input.workerMeta)
    ? input.workerMeta
    : null;
  const actualWorkerGitSha = normalizeOptionalString(workerMeta?.worker?.gitSha);
  const actualRunnerGitSha = normalizeOptionalString(workerMeta?.runner?.gitSha);
  const actualWorkerImage = normalizeOptionalString(workerMeta?.worker?.image);
  const reasons = [];

  if (!workerMeta) reasons.push("worker_meta_missing");
  if (!expectedWorkerGitSha) reasons.push("expected_worker_git_sha_missing");
  if (!actualWorkerGitSha) reasons.push("worker_git_sha_missing");
  if (!actualRunnerGitSha) reasons.push("runner_git_sha_missing");

  if (
    expectedWorkerGitSha
    && actualWorkerGitSha
    && !actualWorkerGitSha.startsWith(expectedWorkerGitSha)
  ) {
    reasons.push(`worker_sha_mismatch:${actualWorkerGitSha}`);
  }
  if (
    expectedWorkerGitSha
    && actualRunnerGitSha
    && !actualRunnerGitSha.startsWith(expectedWorkerGitSha)
  ) {
    reasons.push(`runner_sha_mismatch:${actualRunnerGitSha}`);
  }
  if (
    expectedWorkerImage
    && actualWorkerImage
    && actualWorkerImage !== expectedWorkerImage
  ) {
    reasons.push(`worker_image_mismatch:${actualWorkerImage}`);
  }

  return {
    expectedWorkerGitSha,
    expectedWorkerImage,
    actualWorkerGitSha,
    actualRunnerGitSha,
    actualWorkerImage,
    status: reasons.length === 0 ? "clean" : "mismatch",
    reasons,
  };
}

function normalizeUrl(value, name) {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeOptionalString(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function normalizeOptionalGitSha(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  return /^[0-9a-f]{7,40}$/i.test(normalized) ? normalized.toLowerCase().slice(0, 12) : normalized;
}

function gitShaMatches(actual, expected) {
  if (!actual || !expected) return false;
  if (!/^[0-9a-f]{7,40}$/i.test(actual) || !/^[0-9a-f]{7,40}$/i.test(expected)) {
    return actual === expected;
  }
  return actual.startsWith(expected) || expected.startsWith(actual);
}

function loadLocalEnvNoOverride(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const filePath of [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, "apps/governance-platform/.env"),
    path.join(repoRoot, "apps/governance-platform/.env.local"),
  ]) {
    loadEnvFileNoOverride(filePath, env);
  }
  return env;
}

function loadEnvFileNoOverride(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(env, key)) continue;
    env[key] = stripDotenvQuotes(trimmed.slice(equalsIndex + 1).trim());
  }
}

function stripDotenvQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readExpectedWorkerServiceGitSha() {
  const result = spawnSync("git", [
    "log",
    "-1",
    "--format=%H",
    "HEAD",
    "--",
    ...workerServiceGenerationPaths,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const sha = result.status === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{12,40}$/i.test(sha) ? sha.slice(0, 12) : null;
}

function readExpectedGovernanceGitSha() {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const sha = result.status === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{12,40}$/i.test(sha) ? sha.slice(0, 12) : null;
}

function readGitStatusShort() {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function parseDirtyStatusLine(line) {
  const raw = `${line ?? ""}`;
  if (!raw.trim()) return null;
  let status = raw.slice(0, 2);
  let rawPath = raw.length > 3 ? raw.slice(3) : raw.trim();
  if (raw.length > 1 && raw[1] === " " && raw[2] !== " ") {
    status = `${raw[0]} `;
    rawPath = raw.slice(2);
  }
  const pathValue = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
  return {
    status,
    path: pathValue,
    raw,
    categories: classifyDirtyPath(pathValue),
  };
}

function classifyDirtyPath(pathValue) {
  const categories = [];
  if (matchesAny(pathValue, [], directStaticPublicInputPrefixes)) {
    categories.push("direct-static-public-input");
  }
  if (matchesAny(pathValue, authdBuildInputFiles, authdBuildInputPrefixes)) {
    categories.push("authd-build-input");
  }
  if (matchesAny(pathValue, workerBuildInputFiles, workerBuildInputPrefixes)) {
    categories.push("worker-build-input");
  }
  if (matchesAny(pathValue, rolloutControlFiles, [])) {
    categories.push("rollout-control-input");
  }
  if (
    !categories.includes("direct-static-public-input")
    && matchesAny(pathValue, governanceCommittedInputFiles, governanceCommittedInputPrefixes)
  ) {
    categories.push("governance-committed-input");
  }
  if (pathValue.startsWith("docs/") || pathValue.startsWith("work/")) {
    categories.push("docs-or-work-note");
  }
  if (categories.length === 0) {
    categories.push("unrelated");
  }
  return categories;
}

function matchesAny(pathValue, files, prefixes) {
  return files.includes(pathValue) || prefixes.some((prefix) => pathValue.startsWith(prefix));
}

function unique(values) {
  return [...new Set(values)];
}

function isJsonContentType(contentType) {
  return contentType.toLowerCase().split(";")[0].trim() === "application/json";
}

function pass(id, reason) {
  return { id, status: "pass", reason };
}

function block(id, reason) {
  return { id, status: "block", reason };
}

function parseArgs(argv) {
  const parsed = {
    localReadinessUrl: defaultLocalReadinessUrl,
    publicReadinessUrl: defaultPublicReadinessUrl,
    authdUrl: defaultAuthdUrl,
    workerUrl: defaultWorkerUrl,
    expectedGovernanceReleaseSha: null,
    expectedWorkerGitSha: null,
    expectedWorkerImage: null,
    workerSecret: null,
    fetchTimeoutMs: 10_000,
    reportPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--local-readiness-url") {
      parsed.localReadinessUrl = argv[++index];
    } else if (arg === "--public-readiness-url") {
      parsed.publicReadinessUrl = argv[++index];
    } else if (arg === "--authd-url") {
      parsed.authdUrl = argv[++index];
    } else if (arg === "--worker-url") {
      parsed.workerUrl = argv[++index];
    } else if (arg === "--expected-governance-sha") {
      parsed.expectedGovernanceReleaseSha = argv[++index];
    } else if (arg === "--expected-worker-sha") {
      parsed.expectedWorkerGitSha = argv[++index];
    } else if (arg === "--expected-worker-image") {
      parsed.expectedWorkerImage = argv[++index];
    } else if (arg === "--worker-secret") {
      parsed.workerSecret = argv[++index];
    } else if (arg === "--fetch-timeout-ms") {
      parsed.fetchTimeoutMs = Number(argv[++index]);
    } else if (arg === "--report") {
      parsed.reportPath = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.fetchTimeoutMs) || parsed.fetchTimeoutMs <= 0) {
    throw new Error("--fetch-timeout-ms must be a positive integer");
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/ra268-active-rollout-gate.mjs [options]

Read-only post-recreate gate for RA-268 active evidence. It validates local and
public governance readiness through the canonical readiness canary, then
validates active authd quota/post-mortem behavior through the RA-268 endpoint
check, and validates active worker-agent /meta against the expected
worker-service generation. It does not build, restart, promote or mutate
services.

Options:
  --local-readiness-url <url>      Default: ${defaultLocalReadinessUrl}
  --public-readiness-url <url>     Default: ${defaultPublicReadinessUrl}
  --authd-url <base-url>           Default: ${defaultAuthdUrl}
  --worker-url <base-url>          Default: ${defaultWorkerUrl}
  --expected-governance-sha <sha>  Default: committed HEAD used by the local governance image wrapper.
  --expected-worker-sha <sha>      Default: latest worker-service-affecting commit.
  --expected-worker-image <image>  Default: WORKER_IMAGE env or ${defaultWorkerImage}
  --worker-secret <secret>         Default: WORKER_SECRET/RUNNER_WEBHOOK_SECRET from env files.
  --fetch-timeout-ms <ms>          Default: 10000
  --report <path>                  Write report JSON.
  --json                           Print report JSON.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = await runRa268ActiveRolloutGate(args);
  if (args.reportPath) {
    const reportPath = path.resolve(repoRoot, args.reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`RA-268 active rollout gate: ${report.decision}`);
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }

  if (report.decision !== "pass") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}

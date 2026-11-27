#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

const requiredProbeIds = [
  "readiness",
  "auth-session",
  "project-page",
  "static-asset",
  "runtime-intents-route",
  "runner-status-route",
  "preview-normal-path",
  "preview-websocket",
  "preview-sw",
  "preview-generation",
  "preview-project-sw",
  "sse",
];

const probeDefinitions = new Map([
  ["readiness", {
    path: "/api/readiness",
    method: "GET",
    validate: validateReadinessProbe,
  }],
  ["auth-session", {
    path: "/api/auth/session",
    method: "GET",
    validate: (probe, checks) => validateJsonStatusProbe(probe, checks, [200]),
  }],
  ["project-page", {
    pathPrefix: "/projects/",
    method: "GET",
    validate: validateProjectPageProbe,
  }],
  ["static-asset", {
    pathPrefix: "/_next/static/",
    method: "GET",
    validate: validateStaticAssetProbe,
  }],
  ["runtime-intents-route", {
    path: "/api/internal/runtime-intents/claim",
    method: "POST",
    validate: validateAuthOnlyInternalProbe,
  }],
  ["runner-status-route", {
    pathPattern: /^\/api\/internal\/projects\/[^/]+\/status$/,
    method: "GET",
    validate: validateAuthOnlyInternalProbe,
  }],
  ["preview-normal-path", {
    method: "GET",
    through: "caddy",
    validate: validatePreviewNormalProbe,
  }],
  ["preview-websocket", {
    method: "GET",
    through: "caddy",
    validate: validatePreviewWebsocketProbe,
  }],
  ["preview-sw", {
    path: "/sw.js",
    method: "GET",
    through: "caddy",
    validate: validatePreviewScriptProbe,
  }],
  ["preview-generation", {
    path: "/__arena/preview-generation",
    method: "GET",
    through: "caddy",
    validate: validatePreviewGenerationProbe,
  }],
  ["preview-project-sw", {
    path: "/__arena/project-sw.js",
    method: "GET",
    through: "caddy",
    validate: validatePreviewProjectServiceWorkerProbe,
  }],
  ["sse", {
    path: "/api/events",
    method: "GET",
    validate: validateSseProbe,
  }],
]);

export function buildRouteCanaryReport(options = {}) {
  const checks = [];
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const input = options.input ?? { probes: options.probes ?? [] };
  const probes = normalizeProbeList(input.probes ?? input);
  const byId = new Map();
  const duplicateIds = new Set();

  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.taskId !== undefined && input.taskId !== "RA-344") {
      checks.push(block("probe-input-task", "probe input taskId must be RA-344"));
    }
    if (input.nonIntervention !== undefined && input.nonIntervention !== true) {
      checks.push(block("probe-input-boundary", "probe input must be non-intervention evidence"));
    }
  }

  for (const probe of probes) {
    const id = readText(probe.id);
    if (!id) {
      checks.push(block("probe-id", "probe id is missing"));
      continue;
    }
    if (byId.has(id)) {
      duplicateIds.add(id);
      continue;
    }
    byId.set(id, probe);
  }

  for (const id of duplicateIds) {
    checks.push(block(`probe-${id}`, "duplicate probe id"));
  }

  for (const id of requiredProbeIds) {
    const probe = byId.get(id);
    if (!probe) {
      checks.push(block(`probe-${id}`, "required route canary probe is missing"));
      continue;
    }
    validateProbe(id, probe, checks);
  }

  for (const id of byId.keys()) {
    if (!probeDefinitions.has(id)) {
      checks.push(block(`probe-${id}`, "unknown route canary probe id"));
    }
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "route-canary-matrix",
    generatedAt,
    operator: "scripts/governance-rollout-route-canary.mjs",
    nonIntervention: true,
    requiredProbes: requiredProbeIds,
    probes: probes.map(summarizeProbe),
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "allow-promotion" : "block",
  };
}

function normalizeProbeList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.probes)) {
    return value.probes;
  }
  return [];
}

function validateProbe(id, probe, checks) {
  const definition = probeDefinitions.get(id);
  const pathValue = readTargetPath(probe);
  const method = readText(probe.method || "GET").toUpperCase();

  if (definition.path && pathValue === definition.path) {
    checks.push(pass(`${id}-path`, `probe targets ${definition.path}`));
  } else if (definition.path) {
    checks.push(block(`${id}-path`, `probe path is ${pathValue || "missing"}, expected ${definition.path}`));
  }

  if (definition.pathPrefix && pathValue.startsWith(definition.pathPrefix)) {
    checks.push(pass(`${id}-path`, `probe targets ${definition.pathPrefix}*`));
  } else if (definition.pathPrefix) {
    checks.push(block(`${id}-path`, `probe path is ${pathValue || "missing"}, expected ${definition.pathPrefix}*`));
  }

  if (definition.pathPattern && definition.pathPattern.test(pathValue)) {
    checks.push(pass(`${id}-path`, "probe targets expected route pattern"));
  } else if (definition.pathPattern) {
    checks.push(block(`${id}-path`, `probe path is ${pathValue || "missing"}, expected route pattern`));
  }

  if (method === definition.method) {
    checks.push(pass(`${id}-method`, `probe method is ${definition.method}`));
  } else {
    checks.push(block(`${id}-method`, `probe method is ${method || "missing"}, expected ${definition.method}`));
  }

  if (definition.through) {
    if (probe.through === definition.through) {
      checks.push(pass(`${id}-through`, `probe went through ${definition.through}`));
    } else {
      checks.push(block(`${id}-through`, `probe through is ${probe.through || "missing"}, expected ${definition.through}`));
    }
  }

  if (probe.mutates === true || probe.liveMutation === true) {
    checks.push(block(`${id}-mutation`, "route canary probe must not mutate live state"));
  }

  definition.validate(probe, checks, id);
}

function validateReadinessProbe(probe, checks) {
  validateJsonStatusProbe(probe, checks, [200]);
  if (readJsonStatus(probe) === "ready") {
    checks.push(pass("readiness-payload-status", "readiness payload is ready"));
  } else {
    checks.push(block("readiness-payload-status", "readiness payload is not ready"));
  }
}

function validateJsonStatusProbe(probe, checks, allowedStatuses) {
  requireStatus(probe, checks, allowedStatuses);
  requireJsonContentType(probe, checks);
  rejectHtmlBody(probe, checks);
}

function validateProjectPageProbe(probe, checks) {
  requireStatus(probe, checks, [200]);
  requireContentType(probe, checks, ["text/html"]);
  const bodySample = readBodySample(probe);
  if (!bodySample) {
    checks.push(block("project-page-body", "project page probe must include a body sample"));
  } else if (hasRouteCacheOrMaintenanceSignature(bodySample)) {
    checks.push(block("project-page-body", "project page body looks like route-cache 404 or maintenance HTML"));
  } else {
    checks.push(pass("project-page-body", "project page body sample does not match known failure signatures"));
  }
}

function validateStaticAssetProbe(probe, checks) {
  requireStatus(probe, checks, [200]);
  rejectHtmlContentType(probe, checks);
  const contentType = baseContentType(probe.contentType);
  if (contentType && (
    contentType.startsWith("application/")
    || contentType.startsWith("image/")
    || contentType.startsWith("font/")
    || contentType === "text/css"
    || contentType === "text/javascript"
  )) {
    checks.push(pass("static-asset-asset-content-type", `static asset content type is ${contentType}`));
  } else {
    checks.push(block("static-asset-asset-content-type", `static asset content type is ${contentType || "missing"}`));
  }
  rejectHtmlBody(probe, checks);
}

function validateAuthOnlyInternalProbe(probe, checks) {
  if (probe.authenticated === true) {
    checks.push(block(`${probe.id}-auth-boundary`, "internal route canary must be unauthenticated"));
  }
  requireStatus(probe, checks, [401, 403]);
  requireJsonContentType(probe, checks);
  rejectHtmlBody(probe, checks);
}

function validatePreviewNormalProbe(probe, checks) {
  requireStatus(probe, checks, [200, 302, 401, 403, 503]);
  rejectRouteOnlyProof(probe, checks);
  rejectHtmlFailureBody(probe, checks, "preview-normal-body");
}

function validatePreviewWebsocketProbe(probe, checks) {
  if (probe.upgradeRequested === true || readHeader(probe, "upgrade") === "websocket") {
    checks.push(pass("preview-websocket-upgrade", "websocket upgrade was requested"));
  } else {
    checks.push(block("preview-websocket-upgrade", "websocket probe must record an upgrade request"));
  }
  requireStatus(probe, checks, [101, 200, 302, 401, 403, 502]);
  rejectRouteOnlyProof(probe, checks);
  rejectHtmlFailureBody(probe, checks, "preview-websocket-body");
}

function validatePreviewScriptProbe(probe, checks) {
  requireStatus(probe, checks, [200]);
  rejectRouteOnlyProof(probe, checks);
  const contentType = baseContentType(probe.contentType);
  if (contentType === "application/javascript" || contentType === "text/javascript") {
    checks.push(pass(`${probe.id}-content-type`, `preview script content type is ${contentType}`));
  } else {
    checks.push(block(`${probe.id}-content-type`, `preview script content type is ${contentType || "missing"}`));
  }
  rejectHtmlBody(probe, checks);
}

function validatePreviewProjectServiceWorkerProbe(probe, checks) {
  requireStatus(probe, checks, [200]);
  rejectRouteOnlyProof(probe, checks);
  const contentType = baseContentType(probe.contentType);
  if (contentType === "application/javascript" || contentType === "text/javascript") {
    checks.push(pass(`${probe.id}-content-type`, `preview script content type is ${contentType}`));
    rejectHtmlBody(probe, checks);
    return;
  }
  if (contentType === "text/html") {
    checks.push(pass(`${probe.id}-content-type`, "project service worker falls back to project HTML"));
    rejectHtmlFailureBody(probe, checks, `${probe.id}-body`);
    return;
  }
  checks.push(block(`${probe.id}-content-type`, `preview script content type is ${contentType || "missing"}`));
  rejectHtmlBody(probe, checks);
}

function validatePreviewGenerationProbe(probe, checks) {
  validateJsonStatusProbe(probe, checks, [200]);
  rejectRouteOnlyProof(probe, checks);
}

function validateSseProbe(probe, checks) {
  requireStatus(probe, checks, [200]);
  requireContentType(probe, checks, ["text/event-stream"]);
  rejectHtmlBody(probe, checks);
}

function requireStatus(probe, checks, allowedStatuses) {
  const status = Number(probe.httpStatus ?? probe.status);
  if (allowedStatuses.includes(status)) {
    checks.push(pass(`${probe.id}-http-status`, `probe returned ${status}`));
  } else {
    checks.push(block(`${probe.id}-http-status`, `probe returned ${Number.isFinite(status) ? status : "missing"}, expected ${allowedStatuses.join("|")}`));
  }
}

function requireJsonContentType(probe, checks) {
  requireContentType(probe, checks, ["application/json"]);
}

function requireContentType(probe, checks, expected) {
  const contentType = baseContentType(probe.contentType);
  if (expected.includes(contentType)) {
    checks.push(pass(`${probe.id}-content-type`, `content type is ${contentType}`));
  } else {
    checks.push(block(`${probe.id}-content-type`, `content type is ${contentType || "missing"}, expected ${expected.join("|")}`));
  }
}

function rejectHtmlContentType(probe, checks) {
  const contentType = baseContentType(probe.contentType);
  if (contentType === "text/html") {
    checks.push(block(`${probe.id}-html-content-type`, "HTML content type is not valid for this canary probe"));
  } else {
    checks.push(pass(`${probe.id}-html-content-type`, `content type is ${contentType || "missing"}`));
  }
}

function rejectHtmlBody(probe, checks) {
  const bodySample = readBodySample(probe);
  if (bodySample && hasHtmlSignature(bodySample)) {
    checks.push(block(`${probe.id}-body`, "body sample looks like HTML"));
  } else {
    checks.push(pass(`${probe.id}-body`, "body sample is not HTML"));
  }
}

function rejectHtmlFailureBody(probe, checks, id) {
  const bodySample = readBodySample(probe);
  if (bodySample && hasRouteCacheOrMaintenanceSignature(bodySample)) {
    checks.push(block(id, "body sample looks like route-cache 404 or maintenance HTML"));
  } else {
    checks.push(pass(id, "body sample does not match known failure signatures"));
  }
}

function rejectRouteOnlyProof(probe, checks) {
  if (probe.through === "caddy") {
    checks.push(pass(`${probe.id}-route-owner`, "probe is not direct route-only proof"));
  } else {
    checks.push(block(`${probe.id}-route-owner`, "preview canary must go through Caddy"));
  }
}

function readJsonStatus(probe) {
  if (!probe.json || typeof probe.json !== "object" || Array.isArray(probe.json)) {
    return null;
  }
  return readText(probe.json.status);
}

function readTargetPath(probe) {
  const target = readText(probe.path ?? probe.target ?? probe.url);
  if (!target) return "";
  if (target.startsWith("/")) return target.split("?")[0];
  try {
    return new URL(target).pathname;
  } catch {
    return "";
  }
}

function summarizeProbe(probe) {
  return {
    id: readText(probe.id) || null,
    target: readText(probe.target ?? probe.path ?? probe.url) || null,
    path: readTargetPath(probe) || null,
    method: readText(probe.method || "GET").toUpperCase(),
    httpStatus: Number.isFinite(Number(probe.httpStatus ?? probe.status)) ? Number(probe.httpStatus ?? probe.status) : null,
    contentType: readText(probe.contentType) || null,
    through: readText(probe.through) || null,
  };
}

function baseContentType(contentType) {
  return readText(contentType).toLowerCase().split(";")[0].trim();
}

function readBodySample(probe) {
  return readText(probe.bodySample ?? probe.body ?? probe.text);
}

function readHeader(probe, name) {
  const headers = probe.headers && typeof probe.headers === "object" ? probe.headers : {};
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return readText(value).toLowerCase();
  }
  return "";
}

function hasHtmlSignature(value) {
  return /<!doctype html|<html[\s>]|<\/html>/i.test(value);
}

function hasRouteCacheOrMaintenanceSignature(value) {
  return /This page could not be found|NEXT_NOT_FOUND|404:\s*This page|__next_error__|maintenance|Service Unavailable/i.test(value);
}

function readText(value) {
  const text = `${value ?? ""}`.trim();
  return text;
}

function pass(id, reason) {
  return { id, status: "pass", reason };
}

function block(id, reason) {
  return { id, status: "block", reason };
}

function parseArgs(argv) {
  const parsed = {
    probesPath: null,
    reportPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--probes") {
      parsed.probesPath = argv[++index];
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

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-route-canary.mjs --probes <route-probes.json> [options]

Options:
  --report <path>  Write route canary matrix report JSON.
  --json           Print route canary matrix report JSON.
`);
}

function readProbeInput(probesPath) {
  if (!probesPath) throw new Error("--probes is required");
  const absolutePath = path.resolve(repoRoot, probesPath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function writeReport(reportPath, report) {
  const absolutePath = path.resolve(repoRoot, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

function printSummary(report) {
  console.log(`RA-344 governance route canary matrix: ${report.decision}`);
  if (report.blockedReasons.length > 0) {
    console.log("blocked reasons:");
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    const input = readProbeInput(args.probesPath);
    const report = buildRouteCanaryReport({ input });
    if (args.reportPath) {
      writeReport(args.reportPath, report);
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report);
    }
    process.exit(report.decision === "allow-promotion" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}

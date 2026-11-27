#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const defaultTimeoutMs = 5000;
const defaultBodySampleBytes = 4096;

export async function buildRouteProbesReport(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const input = normalizeInput(options);
  const requestTarget = options.requestProbeTarget ?? requestProbeTarget;
  const previewCookieJar = createCookieJar(input.previewCookie);
  const probes = [];

  for (const probePlan of buildProbePlan(input)) {
    probes.push(await collectProbe(probePlan, input, requestTarget, previewCookieJar));
  }

  const blockedReasons = probes
    .filter((probe) => probe.transportError)
    .map((probe) => `${probe.id}: ${probe.transportError}`);

  return {
    taskId: "RA-344",
    mode: "route-probes",
    generatedAt,
    operator: "scripts/governance-rollout-route-probes.mjs",
    nonIntervention: true,
    input: {
      appBaseUrl: input.appBaseUrl,
      previewBaseUrl: input.previewBaseUrl,
      previewCookieProvided: Boolean(input.previewCookie),
      projectId: input.projectId,
      projectPath: input.projectPath,
      staticAssetPath: input.staticAssetPath,
      previewPath: input.previewPath,
      previewWebsocketPath: input.previewWebsocketPath,
      timeoutMs: input.timeoutMs,
      bodySampleBytes: input.bodySampleBytes,
    },
    probes,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "captured" : "partial",
  };
}

export function writeRouteProbesReport(report, reportPath) {
  const absolutePath = path.resolve(repoRoot, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
  return absolutePath;
}

async function collectProbe(probePlan, input, requestTarget, previewCookieJar) {
  const headers = { ...probePlan.headers };
  const isPreviewProbe = probePlan.id.startsWith("preview-");
  const previewCookieHeader = isPreviewProbe ? previewCookieJar.header() : null;
  if (previewCookieHeader) {
    headers.cookie = previewCookieHeader;
  }

  const response = await requestTarget(probePlan.target, {
    bodySampleBytes: input.bodySampleBytes,
    headers,
    method: probePlan.method,
    timeoutMs: input.timeoutMs,
  });
  if (isPreviewProbe) {
    previewCookieJar.storeFromHeaders(response.headers);
  }

  const probe = {
    id: probePlan.id,
    method: probePlan.method,
    target: probePlan.target,
    mutates: false,
    liveMutation: false,
    ...probePlan.annotations,
    ...response,
  };

  if (probePlan.id === "runtime-intents-route" || probePlan.id === "runner-status-route") {
    probe.authenticated = false;
  }
  if (probePlan.id.startsWith("preview-")) {
    probe.through = "caddy";
    probe.previewCookieSent = Boolean(previewCookieHeader);
  }
  if (probePlan.id === "preview-websocket") {
    probe.upgradeRequested = true;
  }
  return probe;
}

export function buildProbePlan(input) {
  return [
    {
      id: "readiness",
      method: "GET",
      target: joinUrl(input.appBaseUrl, "/api/readiness"),
      headers: jsonHeaders(),
    },
    {
      id: "auth-session",
      method: "GET",
      target: joinUrl(input.appBaseUrl, "/api/auth/session"),
      headers: jsonHeaders(),
    },
    {
      id: "project-page",
      method: "GET",
      target: joinUrl(input.appBaseUrl, input.projectPath),
      headers: htmlHeaders(),
    },
    {
      id: "static-asset",
      method: "GET",
      target: joinUrl(input.appBaseUrl, input.staticAssetPath),
      headers: assetHeaders(),
    },
    {
      id: "runtime-intents-route",
      method: "POST",
      target: joinUrl(input.appBaseUrl, "/api/internal/runtime-intents/claim"),
      headers: jsonHeaders(),
    },
    {
      id: "runner-status-route",
      method: "GET",
      target: joinUrl(input.appBaseUrl, `/api/internal/projects/${encodeURIComponent(input.projectId)}/status`),
      headers: jsonHeaders(),
    },
    {
      id: "preview-normal-path",
      method: "GET",
      target: joinUrl(input.previewBaseUrl, input.previewPath),
      headers: htmlHeaders(),
    },
    {
      id: "preview-websocket",
      method: "GET",
      target: joinUrl(input.previewBaseUrl, input.previewWebsocketPath),
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
      },
    },
    {
      id: "preview-sw",
      method: "GET",
      target: joinUrl(input.previewBaseUrl, "/sw.js"),
      headers: assetHeaders(),
    },
    {
      id: "preview-generation",
      method: "GET",
      target: joinUrl(input.previewBaseUrl, "/__arena/preview-generation"),
      headers: jsonHeaders(),
    },
    {
      id: "preview-project-sw",
      method: "GET",
      target: joinUrl(input.previewBaseUrl, "/__arena/project-sw.js"),
      headers: assetHeaders(),
    },
    {
      id: "sse",
      method: "GET",
      target: joinUrl(input.appBaseUrl, "/api/events"),
      headers: {
        accept: "text/event-stream",
      },
    },
  ];
}

export function requestProbeTarget(target, options = {}) {
  const method = `${options.method ?? "GET"}`.toUpperCase();
  const timeoutMs = Number(options.timeoutMs ?? defaultTimeoutMs);
  const bodySampleBytes = Number(options.bodySampleBytes ?? defaultBodySampleBytes);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let responseStarted = false;
    let statusCode = null;
    let responseHeaders = {};
    const chunks = [];
    let sampledBytes = 0;
    let totalBytes = 0;
    let request = null;
    let responseStream = null;

    const finishRaw = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardDeadline);
      resolve(payload);
    };

    const finish = (extra = {}) => {
      if (settled) return;
      const bodyBuffer = Buffer.concat(chunks);
      const contentType = readHeader(responseHeaders, "content-type");
      const bodySample = bodyBuffer.toString("utf8");
      const json = parseJsonSample(contentType, bodySample);
      finishRaw({
        httpStatus: statusCode,
        contentType,
        headers: normalizeHeaders(responseHeaders),
        bodySample,
        bodySampleBytes: bodyBuffer.length,
        responseBytesSeen: totalBytes,
        durationMs: Date.now() - startedAt,
        ...(json === null ? {} : { json }),
        ...extra,
      });
    };

    const hardDeadline = setTimeout(() => {
      if (responseStream) responseStream.destroy();
      if (request) request.destroy();
      if (responseStarted) {
        finish({ truncated: true, stopReason: `probe stopped after ${timeoutMs}ms` });
      } else {
        finish({ transportError: `request timed out after ${timeoutMs}ms` });
      }
    }, timeoutMs);

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      finishRaw({
        httpStatus: null,
        contentType: null,
        headers: {},
        bodySample: "",
        bodySampleBytes: 0,
        responseBytesSeen: 0,
        durationMs: Date.now() - startedAt,
        transportError: "invalid target URL",
      });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    request = client.request(parsed, {
      headers: {
        "user-agent": "ra-344-route-probes/1",
        ...(options.headers ?? {}),
      },
      method,
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      if (responseStarted) {
        finish();
      } else {
        finish({ transportError: `request timed out after ${timeoutMs}ms` });
      }
    });

    request.on("response", (response) => {
      responseStarted = true;
      responseStream = response;
      statusCode = response.statusCode ?? null;
      responseHeaders = response.headers ?? {};
      response.on("data", (chunk) => {
        totalBytes += chunk.length;
        const remaining = bodySampleBytes - sampledBytes;
        if (remaining > 0) {
          const sampleChunk = chunk.subarray(0, Math.min(remaining, chunk.length));
          chunks.push(sampleChunk);
          sampledBytes += sampleChunk.length;
        }
        if (sampledBytes >= bodySampleBytes) {
          request.destroy();
          finish();
        }
      });
      response.on("end", () => finish());
      response.on("error", (error) => {
        finish({ transportError: error instanceof Error ? error.message : String(error) });
      });
    });

    request.on("upgrade", (response, socket) => {
      responseStarted = true;
      statusCode = response.statusCode ?? 101;
      responseHeaders = response.headers ?? {};
      socket.destroy();
      finish();
    });

    request.on("error", (error) => {
      if (settled) return;
      if (responseStarted) {
        finish();
        return;
      }
      finish({ transportError: error instanceof Error ? error.message : String(error) });
    });

    request.end();
  });
}

function normalizeInput(options) {
  const appBaseUrl = normalizeBaseUrl(options.appBaseUrl, "app base URL");
  const previewBaseUrl = normalizeBaseUrl(options.previewBaseUrl, "preview base URL");
  const projectId = normalizePathSegment(options.projectId, "project id");
  return {
    appBaseUrl,
    previewBaseUrl,
    projectId,
    projectPath: normalizePath(options.projectPath ?? `/projects/${projectId}`, "project path"),
    staticAssetPath: normalizePath(options.staticAssetPath, "static asset path"),
    previewPath: normalizePath(options.previewPath ?? "/", "preview path"),
    previewWebsocketPath: normalizePath(options.previewWebsocketPath ?? "/socket", "preview websocket path"),
    previewCookie: normalizeOptionalHeaderValue(options.previewCookie, "preview cookie"),
    timeoutMs: normalizePositiveInt(options.timeoutMs ?? defaultTimeoutMs, "timeout ms"),
    bodySampleBytes: normalizePositiveInt(options.bodySampleBytes ?? defaultBodySampleBytes, "body sample bytes"),
  };
}

function normalizeBaseUrl(value, name) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) throw new Error(`${name} is required`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function normalizePath(value, name) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) throw new Error(`${name} is required`);
  if (!raw.startsWith("/")) throw new Error(`${name} must start with /`);
  if (raw.includes("\0") || raw.includes("\n")) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return raw;
}

function normalizePathSegment(value, name) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) throw new Error(`${name} is required`);
  if (!/^[A-Za-z0-9_.:-]+$/.test(raw)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return raw;
}

function normalizePositiveInt(value, name) {
  const raw = Number(value);
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return raw;
}

function normalizeOptionalHeaderValue(value, name) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) return null;
  if (raw.includes("\0") || raw.includes("\n") || raw.includes("\r")) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return raw;
}

function joinUrl(baseUrl, routePath) {
  const parsed = new URL(baseUrl);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}${routePath}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function jsonHeaders() {
  return { accept: "application/json" };
}

function htmlHeaders() {
  return { accept: "text/html,application/xhtml+xml" };
}

function assetHeaders() {
  return { accept: "*/*" };
}

function readHeader(headers, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== lowerName) continue;
    if (Array.isArray(value)) return value.join(", ");
    return `${value ?? ""}`;
  }
  return "";
}

function createCookieJar(initialCookieHeader) {
  const cookies = new Map();
  storeCookieHeader(cookies, initialCookieHeader);
  return {
    header() {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
    storeFromHeaders(headers) {
      const setCookieHeader = readHeader(headers, "set-cookie");
      for (const cookieLine of splitSetCookieHeader(setCookieHeader)) {
        const firstPart = cookieLine.split(";")[0] ?? "";
        const eq = firstPart.indexOf("=");
        if (eq <= 0) continue;
        const name = firstPart.slice(0, eq).trim();
        const value = firstPart.slice(eq + 1).trim();
        if (name !== "arena_anon" || !value) continue;
        cookies.set(name, value);
      }
    },
  };
}

function storeCookieHeader(cookies, cookieHeader) {
  for (const part of `${cookieHeader ?? ""}`.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !value) continue;
    cookies.set(name, value);
  }
}

function splitSetCookieHeader(value) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) return [];
  return raw.split(/,\s*(?=[^;,=\s]+=[^;,]*)/g).map((part) => part.trim()).filter(Boolean);
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : `${value ?? ""}`;
  }
  return normalized;
}

function parseJsonSample(contentType, bodySample) {
  if (!contentType.toLowerCase().split(";")[0].trim().endsWith("json")) return null;
  if (!bodySample) return null;
  try {
    return JSON.parse(bodySample);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const parsed = {
    appBaseUrl: null,
    bodySampleBytes: defaultBodySampleBytes,
    generatedAt: null,
    json: false,
    previewBaseUrl: null,
    previewCookie: null,
    previewPath: "/",
    previewWebsocketPath: "/socket",
    projectId: null,
    projectPath: null,
    reportPath: null,
    staticAssetPath: null,
    timeoutMs: defaultTimeoutMs,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app-base-url") {
      parsed.appBaseUrl = argv[++index];
    } else if (arg === "--body-sample-bytes") {
      parsed.bodySampleBytes = argv[++index];
    } else if (arg === "--generated-at") {
      parsed.generatedAt = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--preview-base-url") {
      parsed.previewBaseUrl = argv[++index];
    } else if (arg === "--preview-cookie") {
      parsed.previewCookie = argv[++index];
    } else if (arg === "--preview-path") {
      parsed.previewPath = argv[++index];
    } else if (arg === "--preview-websocket-path") {
      parsed.previewWebsocketPath = argv[++index];
    } else if (arg === "--project-id") {
      parsed.projectId = argv[++index];
    } else if (arg === "--project-path") {
      parsed.projectPath = argv[++index];
    } else if (arg === "--report") {
      parsed.reportPath = argv[++index];
    } else if (arg === "--static-asset-path") {
      parsed.staticAssetPath = argv[++index];
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-route-probes.mjs --app-base-url <url> --preview-base-url <url> --project-id <id> --static-asset-path <path> --report <route-probes.json> [options]

Options:
  --project-path <path>              Project page path. Defaults to /projects/<project-id>.
  --preview-cookie <cookie>          Cookie header sent only to preview probes.
  --preview-path <path>              Preview normal path. Defaults to /.
  --preview-websocket-path <path>    Preview websocket path. Defaults to /socket.
  --timeout-ms <ms>                  Per-probe timeout. Default: ${defaultTimeoutMs}.
  --body-sample-bytes <bytes>        Max response body sample bytes. Default: ${defaultBodySampleBytes}.
  --generated-at <iso>               Fixed timestamp for deterministic tests.
  --json                             Print route-probes.json.

The collector performs unauthenticated route-shape probes only. It does not send secrets, authenticate internal routes, run live claims, write DB rows, reload Caddy/systemd, or mutate project/runtime lifecycle truth.
`);
}

function printSummary(report, writtenPath) {
  console.log(`RA-344 governance route probes: ${report.decision}`);
  console.log(`probes: ${report.probes.length}`);
  if (writtenPath) console.log(`report: ${writtenPath}`);
  if (report.blockedReasons.length > 0) {
    console.log("blocked reasons:");
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    if (!args.reportPath && !args.json) {
      throw new Error("--report or --json is required");
    }
    const report = await buildRouteProbesReport(args);
    const writtenPath = args.reportPath ? writeRouteProbesReport(report, args.reportPath) : null;
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report, writtenPath);
    }
    process.exit(report.decision === "captured" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}

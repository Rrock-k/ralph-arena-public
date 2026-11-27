#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRouteCanaryReport } from "./governance-rollout-route-canary.mjs";

function validProbes(overrides = {}) {
  const probes = [
    {
      id: "readiness",
      method: "GET",
      target: "https://app.arena.example.test/api/readiness",
      httpStatus: 200,
      contentType: "application/json; charset=utf-8",
      json: { status: "ready" },
    },
    {
      id: "auth-session",
      method: "GET",
      target: "https://app.arena.example.test/api/auth/session",
      httpStatus: 200,
      contentType: "application/json",
      json: { user: null },
    },
    {
      id: "project-page",
      method: "GET",
      target: "https://app.arena.example.test/projects/proj_123",
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodySample: "<main><h1>Project</h1><div id=\"app\"></div></main>",
    },
    {
      id: "static-asset",
      method: "GET",
      target: "https://app.arena.example.test/_next/static/chunks/app.js",
      httpStatus: 200,
      contentType: "application/javascript; charset=utf-8",
      bodySample: "self.__next_f.push([])",
    },
    {
      id: "runtime-intents-route",
      method: "POST",
      target: "https://app.arena.example.test/api/internal/runtime-intents/claim",
      httpStatus: 401,
      contentType: "application/json",
      authenticated: false,
      json: { error: "unauthorized" },
    },
    {
      id: "runner-status-route",
      method: "GET",
      target: "https://app.arena.example.test/api/internal/projects/proj_123/status",
      httpStatus: 401,
      contentType: "application/json",
      authenticated: false,
      json: { error: "unauthorized" },
    },
    {
      id: "preview-normal-path",
      method: "GET",
      target: "https://proj-123.arena.example.test/",
      through: "caddy",
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodySample: "<main>Preview app</main>",
    },
    {
      id: "preview-websocket",
      method: "GET",
      target: "https://proj-123.arena.example.test/socket",
      through: "caddy",
      upgradeRequested: true,
      httpStatus: 101,
      headers: { Upgrade: "websocket" },
    },
    {
      id: "preview-sw",
      method: "GET",
      target: "https://proj-123.arena.example.test/sw.js",
      through: "caddy",
      httpStatus: 200,
      contentType: "application/javascript; charset=utf-8",
      bodySample: "self.addEventListener('install', () => {})",
    },
    {
      id: "preview-generation",
      method: "GET",
      target: "https://proj-123.arena.example.test/__arena/preview-generation",
      through: "caddy",
      httpStatus: 200,
      contentType: "application/json",
      json: { generation: "abcdef" },
    },
    {
      id: "preview-project-sw",
      method: "GET",
      target: "https://proj-123.arena.example.test/__arena/project-sw.js",
      through: "caddy",
      httpStatus: 200,
      contentType: "application/javascript; charset=utf-8",
      bodySample: "self.addEventListener('fetch', () => {})",
    },
    {
      id: "sse",
      method: "GET",
      target: "https://app.arena.example.test/api/events",
      httpStatus: 200,
      contentType: "text/event-stream; charset=utf-8",
      bodySample: ":keepalive\n\n",
    },
  ];

  return probes.map((probe) => overrides[probe.id] ? { ...probe, ...overrides[probe.id] } : probe);
}

test("allows a complete non-intervention route canary matrix", () => {
  const report = buildRouteCanaryReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes(),
    },
  });

  assert.equal(report.taskId, "RA-344");
  assert.equal(report.mode, "route-canary-matrix");
  assert.equal(report.nonIntervention, true);
  assert.equal(report.decision, "allow-promotion");
  assert.deepEqual(report.blockedReasons, []);
  assert.equal(report.requiredProbes.includes("runtime-intents-route"), true);
});

test("blocks HTML route-cache responses on API probes", () => {
  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes({
        "auth-session": {
          httpStatus: 200,
          contentType: "text/html",
          bodySample: "<!doctype html><html><body>404: This page could not be found</body></html>",
        },
      }),
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("auth-session-content-type")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("auth-session-body")));
});

test("blocks project page Next route-cache failure HTML", () => {
  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes({
        "project-page": {
          bodySample: "<html><body>404: This page could not be found</body></html>",
        },
      }),
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("project-page-body")));
});

test("blocks internal claim canary if it authenticates and mutates", () => {
  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes({
        "runtime-intents-route": {
          httpStatus: 200,
          authenticated: true,
          mutates: true,
          json: { claimed: true },
        },
      }),
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("runtime-intents-route-auth-boundary")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("runtime-intents-route-mutation")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("runtime-intents-route-http-status")));
});

test("blocks preview probes that bypass Caddy", () => {
  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes({
        "preview-generation": {
          through: "direct",
        },
      }),
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("preview-generation-through")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("preview-generation-route-owner")));
});

test("allows preview fixture without websocket or project-owned service worker", () => {
  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes({
        "preview-websocket": {
          httpStatus: 502,
          contentType: "text/plain; charset=utf-8",
          bodySample: "error code: 502",
        },
        "preview-project-sw": {
          contentType: "text/html; charset=utf-8",
          bodySample: "<!doctype html><html><body><main>Preview app</main></body></html>",
        },
      }),
    },
  });

  assert.equal(report.decision, "allow-promotion");
});

test("blocks project service worker route-cache failure HTML", () => {
  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes: validProbes({
        "preview-project-sw": {
          contentType: "text/html; charset=utf-8",
          bodySample: "<!doctype html><html><body>404: This page could not be found</body></html>",
        },
      }),
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("preview-project-sw-body")));
});

test("blocks missing required probes and unknown probe ids", () => {
  const probes = validProbes().filter((probe) => probe.id !== "sse");
  probes.push({
    id: "unknown",
    method: "GET",
    target: "https://app.arena.example.test/unknown",
    httpStatus: 200,
    contentType: "text/plain",
  });

  const report = buildRouteCanaryReport({
    input: {
      taskId: "RA-344",
      nonIntervention: true,
      probes,
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("probe-sse")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("probe-unknown")));
});

test("supports file-shaped probe input", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-route-canary-"));
  const probesPath = path.join(tempDir, "route-probes.json");
  fs.writeFileSync(probesPath, JSON.stringify({
    taskId: "RA-344",
    nonIntervention: true,
    probes: validProbes(),
  }, null, 2));
  const input = JSON.parse(fs.readFileSync(probesPath, "utf8"));
  const report = buildRouteCanaryReport({ input });

  assert.equal(report.decision, "allow-promotion");
});

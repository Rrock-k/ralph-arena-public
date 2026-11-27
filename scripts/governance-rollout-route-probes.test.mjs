#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRouteCanaryReport } from "./governance-rollout-route-canary.mjs";
import {
  buildRouteProbesReport,
  requestProbeTarget,
  writeRouteProbesReport,
} from "./governance-rollout-route-probes.mjs";

test("collects a complete non-intervention route-probes report", async () => {
  const report = await buildRouteProbesReport({
    ...collectorOptions(),
    generatedAt: "2026-06-15T00:00:00.000Z",
    requestProbeTarget: fakeRequestProbeTarget(),
  });

  assert.equal(report.taskId, "RA-344");
  assert.equal(report.mode, "route-probes");
  assert.equal(report.nonIntervention, true);
  assert.equal(report.decision, "captured");
  assert.equal(report.probes.length, 12);
  assert.deepEqual(report.blockedReasons, []);

  const runtimeProbe = report.probes.find((probe) => probe.id === "runtime-intents-route");
  assert.equal(runtimeProbe.method, "POST");
  assert.equal(runtimeProbe.authenticated, false);
  assert.equal(runtimeProbe.mutates, false);
  assert.equal(runtimeProbe.httpStatus, 401);

  const previewProbe = report.probes.find((probe) => probe.id === "preview-normal-path");
  assert.equal(previewProbe.through, "caddy");

  const matrix = buildRouteCanaryReport({ input: report });
  assert.equal(matrix.decision, "allow-promotion");
});

test("writes route-probes report artifacts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-route-probes-"));
  const report = await buildRouteProbesReport({
    ...collectorOptions(),
    requestProbeTarget: fakeRequestProbeTarget(),
  });
  const reportPath = writeRouteProbesReport(report, path.join(tempDir, "route-probes.json"));
  const written = JSON.parse(fs.readFileSync(reportPath, "utf8"));

  assert.equal(written.mode, "route-probes");
  assert.equal(written.probes.some((probe) => probe.id === "sse"), true);
});

test("sends preview cookie only to preview probes", async () => {
  const seen = [];
  const report = await buildRouteProbesReport({
    ...collectorOptions(),
    previewCookie: "arena_consent=1; arena_anon=test",
    requestProbeTarget: async (target, options = {}) => {
      seen.push({ path: new URL(target).pathname, cookie: options.headers.cookie ?? null });
      return fakeRequestProbeTarget()(target, options);
    },
  });

  assert.equal(report.input.previewCookieProvided, true);
  assert.equal(report.decision, "captured");
  assert.equal(
    seen.find((entry) => entry.path === "/api/readiness").cookie,
    null,
  );
  assert.equal(
    seen.find((entry) => entry.path === "/__arena/preview-generation").cookie,
    "arena_consent=1; arena_anon=test",
  );
});

test("carries preview anon cookie between preview probes", async () => {
  const seen = [];
  const report = await buildRouteProbesReport({
    ...collectorOptions(),
    previewCookie: "arena_consent=1",
    requestProbeTarget: async (target, options = {}) => {
      const url = new URL(target);
      seen.push({ path: url.pathname, cookie: options.headers.cookie ?? null });
      if (url.pathname === "/") {
        return response(302, "", "", {
          "set-cookie": "arena_anon=signed-anon-cookie; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure",
          location: "https://proj-123.arena.example.test/",
        });
      }
      return fakeRequestProbeTarget()(target, options);
    },
  });

  assert.equal(report.input.previewCookieProvided, true);
  assert.equal(report.decision, "captured");
  assert.equal(
    seen.find((entry) => entry.path === "/api/readiness").cookie,
    null,
  );
  assert.equal(
    seen.find((entry) => entry.path === "/__arena/preview-generation").cookie,
    "arena_consent=1; arena_anon=signed-anon-cookie",
  );
  assert.equal(
    report.probes.find((probe) => probe.id === "preview-generation").previewCookieSent,
    true,
  );
});

test("records transport errors as partial evidence", async () => {
  const report = await buildRouteProbesReport({
    ...collectorOptions(),
    requestProbeTarget: async (target) => ({
      httpStatus: null,
      contentType: null,
      headers: {},
      bodySample: "",
      bodySampleBytes: 0,
      responseBytesSeen: 0,
      durationMs: 1,
      transportError: `blocked ${new URL(target).pathname}`,
    }),
  });

  assert.equal(report.decision, "partial");
  assert.equal(report.probes.length, 12);
  assert.ok(report.blockedReasons.some((reason) => reason.includes("readiness")));
});

test("rejects unsafe collector inputs before probing", async () => {
  await assert.rejects(
    () => buildRouteProbesReport({
      ...collectorOptions(),
      projectId: "proj/123",
      requestProbeTarget: fakeRequestProbeTarget(),
    }),
    /project id contains unsupported characters/,
  );
});

test("request helper reports invalid URLs without network access", async () => {
  const response = await requestProbeTarget("not a url", {
    method: "GET",
    timeoutMs: 1000,
  });

  assert.equal(response.httpStatus, null);
  assert.equal(response.transportError, "invalid target URL");
});

test("request helper stops long-lived streams on the hard deadline", async () => {
  const originalRequest = http.request;
  let destroyed = false;
  http.request = () => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = () => {
      destroyed = true;
    };
    request.end = () => {
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = { "content-type": "text/event-stream; charset=utf-8" };
        response.destroy = () => {
          destroyed = true;
        };
        request.emit("response", response);
        response.emit("data", Buffer.from(":keepalive\n\n"));
      });
    };
    return request;
  };

  try {
    const response = await requestProbeTarget("http://example.test/api/events", {
      method: "GET",
      timeoutMs: 100,
      bodySampleBytes: 1024,
    });

    assert.equal(response.httpStatus, 200);
    assert.equal(response.contentType, "text/event-stream; charset=utf-8");
    assert.equal(response.truncated, true);
    assert.equal(response.stopReason, "probe stopped after 100ms");
    assert.match(response.bodySample, /keepalive/);
    assert.equal(destroyed, true);
    assert.ok(response.durationMs < 1000);
  } finally {
    http.request = originalRequest;
  }
});

function collectorOptions() {
  return {
    appBaseUrl: "https://app.arena.example.test",
    bodySampleBytes: 1024,
    previewBaseUrl: "https://proj-123.arena.example.test",
    previewWebsocketPath: "/socket",
    projectId: "proj_123",
    staticAssetPath: "/_next/static/chunks/app.js",
    timeoutMs: 1000,
  };
}

function fakeRequestProbeTarget() {
  return async (target, options = {}) => {
    const url = new URL(target);
    if (url.pathname === "/api/readiness") {
      return response(200, "application/json", { status: "ready" });
    }
    if (url.pathname === "/api/auth/session") {
      return response(200, "application/json", { user: null });
    }
    if (url.pathname === "/projects/proj_123") {
      return response(200, "text/html; charset=utf-8", "<main><h1>Project</h1></main>");
    }
    if (url.pathname === "/_next/static/chunks/app.js") {
      return response(200, "application/javascript; charset=utf-8", "self.__next_f=[];");
    }
    if (url.pathname === "/api/internal/runtime-intents/claim") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, undefined);
      return response(401, "application/json", { error: "unauthorized" });
    }
    if (url.pathname === "/api/internal/projects/proj_123/status") {
      assert.equal(options.headers.authorization, undefined);
      return response(401, "application/json", { error: "unauthorized" });
    }
    if (url.pathname === "/") {
      return response(200, "text/html; charset=utf-8", "<main>Preview app</main>");
    }
    if (url.pathname === "/socket") {
      assert.equal(options.headers.upgrade, "websocket");
      return response(401, "text/plain", "unauthorized websocket");
    }
    if (url.pathname === "/sw.js") {
      return response(200, "application/javascript; charset=utf-8", "self.addEventListener('install',()=>{});");
    }
    if (url.pathname === "/__arena/preview-generation") {
      return response(200, "application/json", { generation: "abcdef" });
    }
    if (url.pathname === "/__arena/project-sw.js") {
      return response(200, "application/javascript; charset=utf-8", "self.addEventListener('fetch',()=>{});");
    }
    if (url.pathname === "/api/events") {
      return response(200, "text/event-stream; charset=utf-8", ":keepalive\n\n");
    }
    return response(404, "text/plain", "not found");
  };
}

function response(httpStatus, contentType, body, headers = {}) {
  const bodySample = typeof body === "string" ? body : JSON.stringify(body);
  return {
    httpStatus,
    contentType,
    headers: { "content-type": contentType, ...headers },
    bodySample,
    bodySampleBytes: Buffer.byteLength(bodySample),
    responseBytesSeen: Buffer.byteLength(bodySample),
    durationMs: 1,
    ...(typeof body === "string" ? {} : { json: body }),
  };
}

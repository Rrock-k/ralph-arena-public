#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthdCanaryReport,
  buildAuthdEndpointReport,
} from "./authd-http-canary.mjs";

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
      windows: [{ label: "5h limit" }],
    },
  ],
};

const postMortem = {
  provider: "claude",
  health: {
    provider: "claude",
    source: "claude-oauth-credentials",
    status: "ready",
  },
  quota: {
    provider: "anthropic",
    source: "anthropic-oauth",
    ok: false,
    error: "Anthropic OAuth usage API returned 429; quota is currently limited.",
    windows: [],
  },
  diagnosis: "quota_limited",
  detail: "Anthropic OAuth usage API returned 429; quota is currently limited.",
};

test("passes when authd HTTP canary proves quota-limited endpoint behavior and cleanup", () => {
  const report = buildAuthdCanaryReport({
    generatedAt: "2026-06-26T00:00:00.000Z",
    containerStarted: true,
    quotaSnapshot,
    postMortem,
    logs: "[authd] listening on :4311\n",
    cleanupConfirmed: true,
  });

  assert.equal(report.taskId, "RA-268");
  assert.equal(report.mode, "authd-http-canary");
  assert.equal(report.activeServiceMutation, false);
  assert.equal(report.temporaryContainer, true);
  assert.equal(report.decision, "pass");
  assert.deepEqual(report.blockedReasons, []);
  assert.equal(report.quotaSnapshot.results[0].error, "Anthropic OAuth usage API returned 429; quota is currently limited.");
  assert.equal(report.postMortem.diagnosis, "quota_limited");
});

test("blocks when active endpoint behavior still has old quota wording", () => {
  const report = buildAuthdCanaryReport({
    containerStarted: true,
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
    postMortem,
    logs: "[authd] listening on :4311\n",
    cleanupConfirmed: true,
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("anthropic-quota-limited-text")));
});

test("blocks when temporary canary cleanup is not confirmed", () => {
  const report = buildAuthdCanaryReport({
    containerStarted: true,
    quotaSnapshot,
    postMortem,
    logs: "[authd] listening on :4311\n",
    cleanupConfirmed: false,
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("cleanup")));
});

test("passes endpoint check when an existing authd endpoint has new quota wording", () => {
  const report = buildAuthdEndpointReport({
    generatedAt: "2026-06-26T00:00:00.000Z",
    url: "http://127.0.0.1:4311",
    quotaSnapshot,
    postMortem,
  });

  assert.equal(report.mode, "authd-http-endpoint-check");
  assert.equal(report.activeServiceMutation, false);
  assert.equal(report.temporaryContainer, false);
  assert.equal(report.decision, "pass");
  assert.equal(report.target.url, "http://127.0.0.1:4311");
});

test("blocks endpoint check when active authd still has old quota wording", () => {
  const report = buildAuthdEndpointReport({
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
    postMortem,
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("anthropic-quota-limited-text")));
});

test("blocks endpoint check with explicit authd re-login guidance on Claude auth invalid", () => {
  const report = buildAuthdEndpointReport({
    url: "http://127.0.0.1:4311",
    quotaSnapshot: {
      ...quotaSnapshot,
      results: [
        {
          provider: "anthropic",
          source: "anthropic-oauth",
          ok: false,
          error: "Anthropic OAuth usage API returned 401; Claude OAuth credentials are not usable.",
          windows: [],
        },
        quotaSnapshot.results[1],
      ],
    },
    postMortem: {
      ...postMortem,
      health: {
        ...postMortem.health,
        status: "invalid",
      },
      quota: {
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: false,
        error: "Anthropic OAuth usage API returned 401; Claude OAuth credentials are not usable.",
        windows: [],
      },
      diagnosis: "auth_invalid",
      detail: "Anthropic OAuth usage API returned 401; Claude OAuth credentials are not usable.",
    },
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("anthropic-auth-invalid:")));
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("post-mortem-auth-invalid:")));
  assert.equal(
    report.blockedReasons.some((reason) => reason.startsWith("anthropic-quota-limited-text:")),
    false,
  );
  assert.equal(
    report.blockedReasons.some((reason) => reason.startsWith("post-mortem-diagnosis:")),
    false,
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import { detectRateLimitSignal } from "../dist/rate-limit.js";

test("detects Claude rate_limit_event and preserves provider reset time", () => {
  const detected = detectRateLimitSignal(
    '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1773939600}}',
  );

  assert.ok(detected);
  assert.equal(detected.reasonCode, "rate_limit");
  assert.equal(detected.source, "claude_rate_limit_event");
  assert.equal(detected.retryAt?.toISOString(), "2026-03-19T17:00:00.000Z");
  assert.match(detected.reasonMessage, /Auto-retry at 2026-03-19T17:00:00\.000Z/);
});

test("infers next UTC reset time from Claude limit text when epoch is absent", () => {
  const detected = detectRateLimitSignal(
    "You've hit your limit · resets 5pm (UTC)",
    { referenceTime: new Date("2026-03-19T16:51:24.000Z") },
  );

  assert.ok(detected);
  assert.equal(detected.source, "claude_limit_text");
  assert.equal(detected.retryAt?.toISOString(), "2026-03-19T17:00:00.000Z");
});

test("detects generic provider 429 responses", () => {
  const detected = detectRateLimitSignal("HTTP 429 Too Many Requests: rate limit exceeded");

  assert.ok(detected);
  assert.equal(detected.source, "provider_429");
  assert.equal(detected.retryAt, null);
});

test("detects Codex quota exhausted billing output", () => {
  const detected = detectRateLimitSignal("ERROR: Quota exceeded. Check your plan and billing details.");

  assert.ok(detected);
  assert.equal(detected.source, "quota_exceeded");
  assert.equal(detected.reasonCode, "rate_limit");
});

test("detects codex-style rate_limit codes even without numeric status", () => {
  const detected = detectRateLimitSignal('{"type":"turn.failed","error":{"code":"rate_limit","message":"usage limit reached"}}');

  assert.ok(detected);
  assert.equal(detected.source, "provider_429");
});

test("detects Codex 'You've hit your usage limit' phrasing", () => {
  const detected = detectRateLimitSignal("You've hit your usage limit");

  assert.ok(detected);
  assert.equal(detected.source, "claude_limit_text");
});

test("detects Claude 'You've hit your session limit' phrasing without structured event", () => {
  const detected = detectRateLimitSignal(
    "You've hit your session limit · resets 2:40am (UTC)",
    { referenceTime: new Date("2026-06-06T23:52:34.000Z") },
  );

  assert.ok(detected);
  assert.equal(detected.source, "claude_limit_text");
  assert.equal(detected.retryAt?.toISOString(), "2026-06-07T02:40:00.000Z");
});

test("detects Codex subscription 'reached your N-hour message limit'", () => {
  const detected = detectRateLimitSignal("You've reached your 5-hour message limit. Please wait or upgrade.");

  assert.ok(detected);
  assert.equal(detected.source, "provider_429");
});

test("detects Codex subscription 'hit your 3-hour limit'", () => {
  const detected = detectRateLimitSignal("hit your 3-hour limit");

  assert.ok(detected);
  assert.equal(detected.source, "provider_429");
});

test("ignores unrelated log text", () => {
  const detected = detectRateLimitSignal("Controller verdict: continue, plan is up to date.");
  assert.equal(detected, null);
});

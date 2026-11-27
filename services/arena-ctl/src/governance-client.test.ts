import assert from "node:assert/strict";
import test from "node:test";
import { formatGovernanceTransportError } from "./governance-client.js";

test("formatGovernanceTransportError explains governance transport failures without secrets", () => {
  const message = formatGovernanceTransportError({
    method: "GET",
    path: "/projects/project-1/proof-reviews",
    governanceUrl: "http://127.0.0.1:3000",
    timeoutMs: 20_000,
    cause: new TypeError("fetch failed"),
  });

  assert.match(message, /GET \/api\/admin\/ctl\/projects\/project-1\/proof-reviews failed before HTTP response from http:\/\/127\.0\.0\.1:3000/);
  assert.match(message, /TypeError: fetch failed/);
  assert.match(message, /Check that governance is running/);
  assert.ok(message.includes("GOVERNANCE_ADMIN_URL/GOVERNANCE_URL"));
  assert.doesNotMatch(message, /ARENA_ADMIN_SECRET|x-arena-admin-secret|secret-value/);
});

test("formatGovernanceTransportError makes timeout cause explicit", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";

  const message = formatGovernanceTransportError({
    method: "POST",
    path: "/projects/project-1/retry-now",
    governanceUrl: "http://127.0.0.1:3000",
    timeoutMs: 15_000,
    cause: timeout,
  });

  assert.match(message, /POST \/api\/admin\/ctl\/projects\/project-1\/retry-now failed before HTTP response/);
  assert.match(message, /timed out after 15000ms/);
  assert.doesNotMatch(message, /retry automatically|fallback/i);
});

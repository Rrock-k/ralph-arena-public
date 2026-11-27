import test from "node:test";
import assert from "node:assert/strict";

import { getPausedSupervisorAction } from "../dist/supervisor.js";

test("paused supervisor resumes when governance stop truth is clear", () => {
  assert.equal(getPausedSupervisorAction({ shouldStop: false }), "resume");
});

test("paused supervisor waits for retryable blockers", () => {
  assert.equal(
    getPausedSupervisorAction({
      shouldStop: true,
      reason: "status_paused_rate_limit",
    }),
    "stay_paused",
  );
  assert.equal(
    getPausedSupervisorAction({
      shouldStop: true,
      reason: "status_paused_api",
    }),
    "stay_paused",
  );
});

test("paused supervisor shuts down for explicit off/archive states", () => {
  assert.equal(getPausedSupervisorAction({ shouldStop: true, reason: "power_off" }), "shutdown");
  assert.equal(getPausedSupervisorAction({ shouldStop: true, reason: "agent_off" }), "shutdown");
  assert.equal(getPausedSupervisorAction({ shouldStop: true, reason: "status_archived" }), "shutdown");
});

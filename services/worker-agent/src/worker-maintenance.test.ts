import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerMaintenanceController } from "./worker-maintenance.js";

test("requestSelfRestart schedules a single exit and becomes idempotent", () => {
  const scheduled: Array<() => void> = [];
  const delays: number[] = [];
  let shutdowns = 0;
  let unrefCalls = 0;

  const controller = createWorkerMaintenanceController({
    delayMs: 180,
    shutdownImpl: () => {
      shutdowns += 1;
    },
    scheduleImpl: (callback, delayMs) => {
      scheduled.push(callback);
      delays.push(delayMs);
      return {
        unref: () => {
          unrefCalls += 1;
        },
      };
    },
  });

  const first = controller.requestSelfRestart("manual_upgrade");
  const second = controller.requestSelfRestart("manual_upgrade");

  assert.equal(first.status, "scheduled");
  assert.equal(second.status, "already_scheduled");
  assert.equal(controller.isRestartScheduled(), true);
  assert.deepEqual(delays, [180]);
  assert.equal(unrefCalls, 1);
  assert.equal(scheduled.length, 1);

  scheduled[0]?.();
  assert.equal(shutdowns, 1);
});

test("requestSelfRestart normalizes invalid delays to a small positive default", () => {
  let capturedDelay = 0;

  const controller = createWorkerMaintenanceController({
    delayMs: -50,
    shutdownImpl: () => {},
    scheduleImpl: (_callback, delayMs) => {
      capturedDelay = delayMs;
    },
  });

  const outcome = controller.requestSelfRestart();

  assert.equal(outcome.status, "scheduled");
  assert.equal(capturedDelay, 25);
  assert.equal(outcome.delayMs, 25);
});

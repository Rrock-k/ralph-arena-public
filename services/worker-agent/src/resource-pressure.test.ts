import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnavailableWorkerResourcePressure,
  calculateResourceAwareClaimCapacity,
  readWorkerResourcePressureConfig,
  summarizeWorkerResourcePressure,
} from "./resource-pressure.js";

test("summarizeWorkerResourcePressure marks memory pressure above threshold", () => {
  const pressure = summarizeWorkerResourcePressure([
    { memoryUsageBytes: 600, memoryLimitBytes: 1000, pidsCurrent: 100 },
    { memoryUsageBytes: 350, memoryLimitBytes: 1000, pidsCurrent: 50 },
  ], {
    memoryThresholdRatio: 0.9,
    pidPressureThreshold: null,
    capturedAt: "2026-06-06T00:00:00.000Z",
  }, {
    runningContainerCount: 3,
  });

  assert.equal(pressure.constrained, true);
  assert.deepEqual(pressure.reasons, ["memory_pressure"]);
  assert.equal(pressure.memory?.usageBytes, 950);
  assert.equal(pressure.memory?.limitBytes, 1000);
  assert.equal(pressure.memory?.usageRatio, 0.95);
  assert.equal(pressure.pids?.current, 150);
  assert.deepEqual(pressure.containers, { sampled: 2, running: 3 });
});

test("calculateResourceAwareClaimCapacity returns zero when pressure is constrained", () => {
  assert.equal(calculateResourceAwareClaimCapacity({
    activeContainerCount: 14,
    maxConcurrentRuns: 40,
    resourcePressure: { constrained: true },
  }), 0);
});

test("calculateResourceAwareClaimCapacity preserves ordinary active-container capacity", () => {
  assert.equal(calculateResourceAwareClaimCapacity({
    activeContainerCount: 14,
    maxConcurrentRuns: 40,
    resourcePressure: { constrained: false },
  }), 26);
});

test("unavailable resource pressure preserves container-count capacity", () => {
  const pressure = buildUnavailableWorkerResourcePressure("docker stats timed out", {
    runningContainerCount: 7,
    capturedAt: "2026-06-07T00:00:00.000Z",
  });

  assert.equal(pressure.constrained, true);
  assert.deepEqual(pressure.reasons, ["resource_pressure_unavailable"]);
  assert.deepEqual(pressure.containers, { sampled: 0, running: 7 });
  assert.equal(pressure.error, "docker stats timed out");
  assert.equal(calculateResourceAwareClaimCapacity({
    activeContainerCount: 7,
    maxConcurrentRuns: 40,
    resourcePressure: pressure,
  }), 33);
});

test("readWorkerResourcePressureConfig keeps PID pressure opt-in", () => {
  assert.deepEqual(readWorkerResourcePressureConfig({
    WORKER_MEMORY_PRESSURE_THRESHOLD_RATIO: "0.8",
  }), {
    memoryThresholdRatio: 0.8,
    pidPressureThreshold: null,
  });
  assert.equal(readWorkerResourcePressureConfig({
    WORKER_PID_PRESSURE_MAX: "800",
  }).pidPressureThreshold, 800);
});

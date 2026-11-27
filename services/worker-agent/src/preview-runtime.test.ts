import assert from "node:assert/strict";
import test from "node:test";
import {
  waitForContainerRunning,
  waitForPreviewServing,
  waitForRunnerControlServing,
} from "./preview-runtime.js";

function createClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
  };
}

test("waitForPreviewServing requires consecutive healthy probes", async () => {
  const clock = createClock();
  const fetchCalls: string[] = [];
  const responses = [
    { ok: true, status: 200 },
    { ok: false, status: 503 },
    { ok: true, status: 200 },
    { ok: true, status: 200 },
  ];

  await waitForPreviewServing("preview-robot", {
    inspectContainer: async () => ({ State: { Running: true, Status: "running", ExitCode: 0 } }),
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      const response = responses.shift();
      assert.ok(response, "unexpected extra fetch");
      return response;
    },
    now: clock.now,
    sleep: clock.sleep,
    healthTimeoutMs: 50,
    healthPollMs: 1,
    requiredSuccesses: 2,
  });

  assert.deepEqual(fetchCalls, [
    "http://preview-robot:3000/health",
    "http://preview-robot:3000/health",
    "http://preview-robot:3000/health",
    "http://preview-robot:3000/health",
  ]);
});

test("waitForPreviewServing falls back to root when /health is not implemented", async () => {
  const clock = createClock();
  const fetchCalls: string[] = [];
  const responses = [
    { ok: false, status: 404 },
    { ok: true, status: 200 },
    { ok: false, status: 404 },
    { ok: true, status: 200 },
  ];

  await waitForPreviewServing("preview-fallback", {
    inspectContainer: async () => ({ State: { Running: true, Status: "running", ExitCode: 0 } }),
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      const response = responses.shift();
      assert.ok(response, "unexpected extra fetch");
      return response;
    },
    now: clock.now,
    sleep: clock.sleep,
    healthTimeoutMs: 50,
    healthPollMs: 1,
    requiredSuccesses: 2,
  });

  assert.deepEqual(fetchCalls, [
    "http://preview-fallback:3000/health",
    "http://preview-fallback:3000/",
    "http://preview-fallback:3000/health",
    "http://preview-fallback:3000/",
  ]);
});

test("waitForPreviewServing fails when container exits before becoming healthy", async () => {
  const clock = createClock();

  await assert.rejects(
    () => waitForPreviewServing("preview-dead", {
      inspectContainer: async () => ({ State: { Running: false, Status: "exited", ExitCode: 254 } }),
      fetchImpl: async () => {
        throw new Error("fetch should not run for stopped containers");
      },
      now: clock.now,
      sleep: clock.sleep,
      healthTimeoutMs: 3,
      healthPollMs: 1,
      requiredSuccesses: 2,
    }),
    /Preview health check failed for preview-dead: container is exited \(exit 254\)/,
  );
});

test("waitForPreviewServing fails immediately when the container disappears", async () => {
  await assert.rejects(
    () => waitForPreviewServing("preview-missing", {
      inspectContainer: async () => null,
      healthTimeoutMs: 10,
      healthPollMs: 1,
      requiredSuccesses: 1,
    }),
    /Preview container preview-missing disappeared before health check/,
  );
});

test("waitForContainerRunning succeeds after consecutive running polls", async () => {
  const clock = createClock();
  const states = [
    { State: { Running: true, Status: "running", ExitCode: 0 } },
    { State: { Running: true, Status: "running", ExitCode: 0 } },
  ];

  await waitForContainerRunning("preview-agent-run", {
    inspectContainer: async () => {
      const state = states.shift();
      assert.ok(state, "unexpected extra inspect");
      return state;
    },
    now: clock.now,
    sleep: clock.sleep,
    runningTimeoutMs: 10,
    runningPollMs: 1,
    requiredRunningPolls: 2,
  });
});

test("waitForContainerRunning fails when container exits before stabilizing", async () => {
  const clock = createClock();

  await assert.rejects(
    () => waitForContainerRunning("preview-agent-run-dead", {
      inspectContainer: async () => ({ State: { Running: false, Status: "exited", ExitCode: 1 } }),
      now: clock.now,
      sleep: clock.sleep,
      runningTimeoutMs: 3,
      runningPollMs: 1,
      requiredRunningPolls: 2,
    }),
    /Runtime start check failed for preview-agent-run-dead: container is exited \(exit 1\)/,
  );
});

test("waitForContainerRunning fails immediately when container disappears", async () => {
  await assert.rejects(
    () => waitForContainerRunning("preview-agent-run-missing", {
      inspectContainer: async () => null,
      runningTimeoutMs: 10,
      runningPollMs: 1,
      requiredRunningPolls: 1,
    }),
    /Runtime container preview-agent-run-missing disappeared before startup confirmation/,
  );
});

test("waitForRunnerControlServing requires consecutive healthy control probes", async () => {
  const clock = createClock();
  const fetchCalls: string[] = [];
  const responses = [
    { ok: true, status: 200 },
    { ok: false, status: 503 },
    { ok: true, status: 200 },
    { ok: true, status: 200 },
  ];

  await waitForRunnerControlServing("preview-agent-run", {
    inspectContainer: async () => ({ State: { Running: true, Status: "running", ExitCode: 0 } }),
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      const response = responses.shift();
      assert.ok(response, "unexpected extra fetch");
      return response;
    },
    now: clock.now,
    sleep: clock.sleep,
    controlTimeoutMs: 50,
    controlPollMs: 1,
    requiredSuccesses: 2,
  });

  assert.deepEqual(fetchCalls, [
    "http://preview-agent-run:3999/__arena/preview-generation",
    "http://preview-agent-run:3999/__arena/preview-generation",
    "http://preview-agent-run:3999/__arena/preview-generation",
    "http://preview-agent-run:3999/__arena/preview-generation",
  ]);
});

test("waitForRunnerControlServing fails when runner exits before control plane is ready", async () => {
  const clock = createClock();

  await assert.rejects(
    () => waitForRunnerControlServing("preview-agent-run-dead", {
      inspectContainer: async () => ({ State: { Running: false, Status: "exited", ExitCode: 1 } }),
      fetchImpl: async () => {
        throw new Error("fetch should not run for stopped containers");
      },
      now: clock.now,
      sleep: clock.sleep,
      controlTimeoutMs: 3,
      controlPollMs: 1,
      requiredSuccesses: 2,
    }),
    /Runner control check failed for preview-agent-run-dead: container is exited \(exit 1\)/,
  );
});

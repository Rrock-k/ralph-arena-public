import assert from "node:assert/strict";
import test from "node:test";
import {
  ANTIGRAVITY_AUTH_CONTAINER_HOME,
  ANTIGRAVITY_KEYRING_WRAPPER,
  configureAntigravityRuntime,
  isAntigravityRuntime,
} from "./antigravity-runtime.js";

test("isAntigravityRuntime matches only Antigravity agent runs", () => {
  assert.equal(isAntigravityRuntime({ ARENA_AGENT: "antigravity" }), true);
  assert.equal(isAntigravityRuntime({ ARENA_AGENT: "codex" }), false);
  assert.equal(isAntigravityRuntime({}), false);
});

test("configureAntigravityRuntime mounts authd-owned keyring volume", () => {
  const env: Record<string, string> = { ARENA_AGENT: "antigravity" };
  const hostConfig: { Mounts?: Array<Record<string, unknown>> } = {};

  const result = configureAntigravityRuntime({
    env,
    hostConfig: hostConfig as any,
    authVolumeName: "agents-arena_antigravity_auth_home",
  });

  assert.equal(result.configured, true);
  assert.equal(env.ARENA_ANTIGRAVITY_HOME, ANTIGRAVITY_AUTH_CONTAINER_HOME);
  assert.equal(env.ARENA_ANTIGRAVITY_BIN, ANTIGRAVITY_KEYRING_WRAPPER);
  assert.deepEqual(hostConfig.Mounts, [{
    Type: "volume",
    Source: "agents-arena_antigravity_auth_home",
    Target: ANTIGRAVITY_AUTH_CONTAINER_HOME,
    ReadOnly: false,
  }]);
});

test("configureAntigravityRuntime requires an explicit auth volume", () => {
  assert.throws(
    () => configureAntigravityRuntime({
      env: { ARENA_AGENT: "antigravity" },
      hostConfig: {},
      authVolumeName: "",
    }),
    /AUTHD_ANTIGRAVITY_DOCKER_VOLUME/,
  );
});

test("configureAntigravityRuntime leaves non-Antigravity runs unchanged", () => {
  const env: Record<string, string> = { ARENA_AGENT: "codex" };
  const hostConfig: { Mounts?: Array<Record<string, unknown>> } = {};

  const result = configureAntigravityRuntime({
    env,
    hostConfig: hostConfig as any,
    authVolumeName: "agents-arena_antigravity_auth_home",
  });

  assert.equal(result.configured, false);
  assert.deepEqual(env, { ARENA_AGENT: "codex" });
  assert.deepEqual(hostConfig, {});
});

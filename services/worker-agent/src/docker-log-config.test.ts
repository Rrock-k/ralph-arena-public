import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreviewContainerLogConfig,
  dockerLogConfigsMatch,
} from "./docker-log-config.js";

test("buildPreviewContainerLogConfig uses bounded json-file defaults", () => {
  assert.deepEqual(buildPreviewContainerLogConfig({}), {
    Type: "json-file",
    Config: {
      "max-size": "10m",
      "max-file": "5",
    },
  });
});

test("buildPreviewContainerLogConfig accepts explicit log rotation options", () => {
  assert.deepEqual(buildPreviewContainerLogConfig({
    ARENA_DOCKER_LOG_MAX_SIZE: "25m",
    ARENA_DOCKER_LOG_MAX_FILE: "7",
  }), {
    Type: "json-file",
    Config: {
      "max-size": "25m",
      "max-file": "7",
    },
  });
});

test("dockerLogConfigsMatch compares effective json-file rotation", () => {
  const expected = buildPreviewContainerLogConfig({});

  assert.equal(dockerLogConfigsMatch({
    Type: "json-file",
    Config: {
      "max-file": "5",
      "max-size": "10m",
    },
  }, expected), true);
  assert.equal(dockerLogConfigsMatch({
    Type: "json-file",
    Config: {
      "max-file": "1",
      "max-size": "10m",
    },
  }, expected), false);
  assert.equal(dockerLogConfigsMatch(undefined, expected), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { dockerMutationStatus, isDockerNotFoundError } from "./container-http.js";

test("isDockerNotFoundError recognizes 404 docker errors", () => {
  assert.equal(isDockerNotFoundError({ statusCode: 404 }), true);
  assert.equal(isDockerNotFoundError(new Error("No such container: preview-demo")), true);
  assert.equal(isDockerNotFoundError("docker 404 response"), true);
  assert.equal(isDockerNotFoundError(new Error("container is already running")), false);
});

test("dockerMutationStatus maps docker not-found and idempotent errors to the maintenance contract", () => {
  assert.equal(dockerMutationStatus({ statusCode: 404 }), 404);
  assert.equal(dockerMutationStatus({ status: 304 }), 200);
  assert.equal(dockerMutationStatus({ statusCode: 409 }), 409);
  assert.equal(dockerMutationStatus(new Error("container is already stopped")), 200);
  assert.equal(dockerMutationStatus(new Error("container is already running")), 200);
  assert.equal(dockerMutationStatus(new Error("No such container: preview-demo")), 404);
  assert.equal(dockerMutationStatus(new Error("unexpected docker failure")), 500);
});

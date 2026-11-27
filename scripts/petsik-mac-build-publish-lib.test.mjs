#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAllowedPetsikProjectId,
  findSingleMacArtifact,
  parseAllowedPetsikProjectIds,
  parsePetsikMacBuildTag,
} from "./petsik-mac-build-publish-lib.mjs";

test("accepts only project-scoped Petsik Mac build tags", () => {
  assert.deepEqual(parsePetsikMacBuildTag(" mac-build/petsik-v0.1.0 "), {
    tag: "mac-build/petsik-v0.1.0",
    version: "0.1.0",
  });
  assert.deepEqual(parsePetsikMacBuildTag("mac-build/petsik-v1.2.3-beta.1+7"), {
    tag: "mac-build/petsik-v1.2.3-beta.1+7",
    version: "1.2.3-beta.1+7",
  });

  for (const tag of [
    "",
    "petsik-v0.1.0",
    "mac-build/other-v0.1.0",
    "mac-build/petsik-v0.1",
    "mac-build/petsik-v0.1.0/extra",
  ]) {
    assert.throws(() => parsePetsikMacBuildTag(tag), /Tag must match/);
  }
});

test("rejects non-allowlisted Petsik project targets", () => {
  assert.deepEqual(parseAllowedPetsikProjectIds(""), []);
  assert.deepEqual(parseAllowedPetsikProjectIds("project-petsik, project-smoke"), [
    "project-petsik",
    "project-smoke",
  ]);

  assert.doesNotThrow(() => {
    assertAllowedPetsikProjectId("project-petsik", ["project-petsik"]);
  });
  assert.throws(
    () => assertAllowedPetsikProjectId("project-other", ["project-petsik"]),
    /not allowlisted/,
  );
  assert.throws(
    () => assertAllowedPetsikProjectId("project-petsik", []),
    /PETSIK_ALLOWED_ARENA_PROJECT_IDS/,
  );
});

test("requires exactly one zip or dmg artifact", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "petsik-artifact-test-"));
  await mkdir(path.join(tempDir, "nested"));
  await writeFile(path.join(tempDir, "nested", "Petsik.zip"), "zip");

  assert.equal(await findSingleMacArtifact(tempDir), path.join(tempDir, "nested", "Petsik.zip"));

  await writeFile(path.join(tempDir, "Petsik.dmg"), "dmg");
  await assert.rejects(() => findSingleMacArtifact(tempDir), /found 2/);
});

test("does not treat unsupported files as publishable artifacts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "petsik-artifact-test-"));
  await writeFile(path.join(tempDir, "Petsik.txt"), "not a build");

  await assert.rejects(() => findSingleMacArtifact(tempDir), /found 0/);
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectConfigSchema, RalphConfigSchema } from "../config/types.js";
import { LoopExecutor } from "./executor.js";

function buildExecutor(workDir: string, specPath?: string): LoopExecutor {
  const ralphConfig = RalphConfigSchema.parse({
    agent: "claude-code",
    autoCommit: false,
    autoPush: false,
    controller: { enabled: false },
    visionQA: { enabled: false },
  });
  const projectConfig = ProjectConfigSchema.parse({
    name: "demo-project",
    description: "demo",
    techStack: { language: "typescript", framework: "node" },
    repository: { url: "", branch: "main", deployBranch: "main" },
  });

  return new LoopExecutor({
    workDir,
    ralphConfig,
    projectConfig,
    specPath,
  });
}

test("watchForNewSpecs skips resident idle watch in arena runtime and preserves terminal result", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-executor-arena-idle-"));
  const specPath = path.join(workDir, "spec.md");
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = "proj-1";
  process.env.ARENA_GOVERNANCE_URL = "http://governance:3000";

  try {
    mkdirSync(path.join(workDir, ".arena"), { recursive: true });
    writeFileSync(specPath, "# Demo spec\n");
    writeFileSync(
      path.join(workDir, ".arena", "result.json"),
      JSON.stringify({ status: "DEPLOYED", reason: "fresh" }),
    );

    const executor = buildExecutor(workDir, specPath) as any;
    await executor.progress.load();
    executor.setState("completed");

    const resumed = await executor.watchForNewSpecs();

    assert.equal(resumed, false);
    assert.equal(executor.state, "completed");
    assert.equal(existsSync(path.join(workDir, ".arena", "result.json")), true);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(workDir, ".arena", "result.json"), "utf-8")),
      { status: "DEPLOYED", reason: "fresh" },
    );
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

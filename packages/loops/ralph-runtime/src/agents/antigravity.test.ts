import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AntigravityAgent } from "./antigravity.js";

const mockAntigravityCliPath = fileURLToPath(new URL("./fixtures/mock-antigravity-cli.mjs", import.meta.url));

async function withMockAntigravityScenario<T>(
  scenario: string,
  fn: () => Promise<T>,
  argsFile?: string,
  antigravityHome?: string,
): Promise<T> {
  const previousAntigravityBin = process.env.ARENA_ANTIGRAVITY_BIN;
  const previousAntigravityHome = process.env.ARENA_ANTIGRAVITY_HOME;
  const previousScenario = process.env.ARENA_MOCK_ANTIGRAVITY_SCENARIO;
  const previousArgsFile = process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE;

  process.env.ARENA_ANTIGRAVITY_BIN = mockAntigravityCliPath;
  process.env.ARENA_MOCK_ANTIGRAVITY_SCENARIO = scenario;
  if (antigravityHome) {
    process.env.ARENA_ANTIGRAVITY_HOME = antigravityHome;
  } else {
    delete process.env.ARENA_ANTIGRAVITY_HOME;
  }
  if (argsFile) {
    process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE = argsFile;
  } else {
    delete process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE;
  }

  try {
    return await fn();
  } finally {
    if (previousAntigravityBin === undefined) {
      delete process.env.ARENA_ANTIGRAVITY_BIN;
    } else {
      process.env.ARENA_ANTIGRAVITY_BIN = previousAntigravityBin;
    }
    if (previousAntigravityHome === undefined) {
      delete process.env.ARENA_ANTIGRAVITY_HOME;
    } else {
      process.env.ARENA_ANTIGRAVITY_HOME = previousAntigravityHome;
    }
    if (previousScenario === undefined) {
      delete process.env.ARENA_MOCK_ANTIGRAVITY_SCENARIO;
    } else {
      process.env.ARENA_MOCK_ANTIGRAVITY_SCENARIO = previousScenario;
    }
    if (previousArgsFile === undefined) {
      delete process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE;
    } else {
      process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE = previousArgsFile;
    }
  }
}

async function executeScenario(scenario: string, model?: string) {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-antigravity-agent-"));
  return withMockAntigravityScenario(scenario, async () => {
    const agent = new AntigravityAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 1,
      verbose: true,
      model,
    });
  }, undefined, workDir);
}

test("AntigravityAgent invokes agy print mode through the injected binary", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-antigravity-agent-"));
  const argsFile = path.join(workDir, "args.jsonl");

  const result = await withMockAntigravityScenario("success", async () => {
    const agent = new AntigravityAgent();
    return agent.execute({
      workDir,
      prompt: "Build Sushi Kitties",
      timeout: 2,
      verbose: true,
    });
  }, argsFile, workDir);

  const args = JSON.parse(readFileSync(argsFile, "utf8").trim());
  assert.equal(result.success, true);
  assert.match(result.output, /mock agy response: Build Sushi Kitties/);
  assert.equal(args.includes("--dangerously-skip-permissions"), true);
  assert.equal(args[args.indexOf("--print-timeout") + 1], "2m0s");
  assert.equal(args[args.indexOf("--print") + 1], "Build Sushi Kitties");
});

test("AntigravityAgent classifies auth/config/rate-limit/budget/infra failures", async () => {
  const cases = [
    { scenario: "auth", category: "auth", pattern: /authentication timed out/i },
    { scenario: "invalid_grant", category: "auth", pattern: /invalid code verifier/i },
    { scenario: "config", category: "config", pattern: /unsupported model/i },
    { scenario: "rate_limit", category: "rate_limit", pattern: /usage limit/i },
    { scenario: "budget", category: "budget", pattern: /budget exhausted/i },
    { scenario: "infra", category: "infra", pattern: /listen tcp|operation not permitted/i },
  ] as const;

  for (const { scenario, category, pattern } of cases) {
    const result = await executeScenario(scenario);

    assert.equal(result.success, false, `${scenario} should fail`);
    assert.equal(result.error?.category, category, `${scenario} should classify as ${category}`);
    assert.match(result.error?.message ?? "", pattern, `${scenario} should preserve the triggering error`);
    assert.doesNotMatch(result.output, /accounts\.google\.com\/o\/oauth2\/auth\?/);
  }
});

test("AntigravityAgent rejects model selection until a deterministic CLI model contract is proven", async () => {
  const result = await executeScenario("success", "gemini-3.5-flash");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "config");
  assert.match(result.error?.message ?? "", /model selection is not supported/i);
});

test("AntigravityAgent treats auth timeout text as failure even when agy exits zero", async () => {
  const result = await executeScenario("auth_zero");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "auth");
  assert.match(result.error?.message ?? "", /authentication timed out/i);
});

test("AntigravityAgent does not classify planner JSON wording as CLI errors", async () => {
  const result = await executeScenario("successful_json_with_error_words");

  assert.equal(result.success, true);
  assert.equal(result.error, undefined);
  assert.match(result.output, /"phases"/);
  assert.match(result.output, /required UI and failure feedback/);
});

test("AntigravityAgent treats empty zero-exit output as infra failure", async () => {
  const result = await executeScenario("empty_success");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "infra");
  assert.match(result.error?.message ?? "", /empty stdout/i);
  assert.match(result.output, /empty stdout/i);
});

test("AntigravityAgent reads AGY internal log diagnostics when stdout is empty", async () => {
  const result = await executeScenario("empty_success_with_log_rate_limit");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "rate_limit");
  assert.match(result.error?.message ?? "", /RESOURCE_EXHAUSTED|Individual quota reached/i);
  assert.match(result.output, /RESOURCE_EXHAUSTED|Individual quota reached/i);
});

test("AntigravityAgent availability and version checks use the injected agy binary", async () => {
  await withMockAntigravityScenario("success", async () => {
    const agent = new AntigravityAgent();
    assert.equal(await agent.isAvailable(), true);
    assert.equal(await agent.getVersion(), "agy mock 1.0.0");
  });
});

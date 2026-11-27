import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAgent } from "./claude-code.js";

const mockClaudeCliPath = fileURLToPath(new URL("./fixtures/mock-claude-cli.mjs", import.meta.url));

async function withMockClaudeScenario<T>(
  scenario: string,
  fn: () => Promise<T>,
  argsFile?: string,
): Promise<T> {
  const previousClaudeBin = process.env.ARENA_CLAUDE_BIN;
  const previousScenario = process.env.ARENA_MOCK_CLAUDE_SCENARIO;
  const previousArgsFile = process.env.ARENA_MOCK_CLAUDE_ARGS_FILE;

  process.env.ARENA_CLAUDE_BIN = mockClaudeCliPath;
  process.env.ARENA_MOCK_CLAUDE_SCENARIO = scenario;
  if (argsFile) {
    process.env.ARENA_MOCK_CLAUDE_ARGS_FILE = argsFile;
  } else {
    delete process.env.ARENA_MOCK_CLAUDE_ARGS_FILE;
  }

  try {
    return await fn();
  } finally {
    if (previousClaudeBin === undefined) {
      delete process.env.ARENA_CLAUDE_BIN;
    } else {
      process.env.ARENA_CLAUDE_BIN = previousClaudeBin;
    }
    if (previousScenario === undefined) {
      delete process.env.ARENA_MOCK_CLAUDE_SCENARIO;
    } else {
      process.env.ARENA_MOCK_CLAUDE_SCENARIO = previousScenario;
    }
    if (previousArgsFile === undefined) {
      delete process.env.ARENA_MOCK_CLAUDE_ARGS_FILE;
    } else {
      process.env.ARENA_MOCK_CLAUDE_ARGS_FILE = previousArgsFile;
    }
  }
}

async function executeScenario(scenario: string) {
  return withMockClaudeScenario(scenario, async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "ralph-claude-agent-"));
    const agent = new ClaudeCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 1,
      verbose: true,
    });
  });
}

test("ClaudeCodeAgent preserves provider reset timing from structured rate-limit events", async () => {
  const result = await executeScenario("rate_limit");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "rate_limit");
  assert.match(result.error?.message ?? "", /hit your limit/i);
  assert.equal(result.error?.retryAt, "2026-04-22T19:00:00.000Z");
  assert.ok((result.error?.retryAfterSec ?? 0) >= 60);
  assert.equal(result.providerSession?.id, "mock-session");
});

test("ClaudeCodeAgent timeout carries the captured session id for a resumable retry (RA-374)", async () => {
  const result = await withMockClaudeScenario("timeout_hang", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "ralph-claude-agent-"));
    const agent = new ClaudeCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 0.03,
      verbose: true,
    });
  });

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "timeout");
  assert.equal(result.providerSession?.id, "mock-session");
});

test("ClaudeCodeAgent ignores allowed_warning usage telemetry", async () => {
  const result = await executeScenario("allowed_warning");

  assert.equal(result.success, true);
  assert.equal(result.error, undefined);
  assert.equal(result.output, "warning only");
});

test("ClaudeCodeAgent keeps duplicated assistant/result JSON only once", async () => {
  const result = await executeScenario("duplicate_json");

  assert.equal(result.success, true);
  assert.equal(
    result.output,
    '```json\n{"summary":"ok","planChanges":[],"newJudgments":[]}\n```',
  );
});

test("ClaudeCodeAgent passes provider resume id to Claude CLI", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-claude-agent-"));
  const argsFile = path.join(workDir, "args.jsonl");

  const result = await withMockClaudeScenario("success", async () => {
    const agent = new ClaudeCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Resume this task",
      timeout: 1,
      verbose: true,
      providerSessionResumeId: "session-old",
    });
  }, argsFile);

  const args = JSON.parse(readFileSync(argsFile, "utf8").trim());
  assert.equal(result.success, true);
  assert.deepEqual(result.usage, {
    inputTokens: 210,
    outputTokens: 45,
    totalTokens: 255,
  });
  assert.equal(args[args.indexOf("--resume") + 1], "session-old");
  assert.equal(result.providerSession?.id, "mock-session");
  assert.equal(result.providerSession?.resumedFrom, "session-old");
});

test("ClaudeCodeAgent falls back to a normal launch when resume target is gone", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-claude-agent-"));
  const argsFile = path.join(workDir, "args.jsonl");

  const result = await withMockClaudeScenario("resume_missing", async () => {
    const agent = new ClaudeCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Resume this task",
      timeout: 1,
      verbose: true,
      providerSessionResumeId: "missing-session",
    });
  }, argsFile);

  const invocations = readFileSync(argsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(result.success, true);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0][invocations[0].indexOf("--resume") + 1], "missing-session");
  assert.equal(invocations[1].includes("--resume"), false);
  assert.match(result.output, /mock response: Resume this task/);
  assert.equal(result.providerSession?.id, "mock-session");
  assert.equal(result.providerSession?.resumeFallbackReason, "No conversation found for session missing-session");
});

test("ClaudeCodeAgent availability and version checks use the injected claude binary", async () => {
  await withMockClaudeScenario("success", async () => {
    const agent = new ClaudeCodeAgent();
    assert.equal(await agent.isAvailable(), true);
    assert.equal(await agent.getVersion(), "claude mock 0.0.0");
  });
});

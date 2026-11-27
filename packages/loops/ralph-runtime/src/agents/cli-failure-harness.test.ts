import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AgentErrorCategory } from "../config/types.js";
import type { Agent } from "./base.js";
import { ClaudeCodeAgent } from "./claude-code.js";
import { CodexAgent } from "./codex.js";
import { OpenCodeAgent } from "./opencode.js";

const mockCodexCliPath = fileURLToPath(new URL("./fixtures/mock-codex-cli.mjs", import.meta.url));
const mockClaudeCliPath = fileURLToPath(new URL("./fixtures/mock-claude-cli.mjs", import.meta.url));
const mockOpenCodeCliPath = fileURLToPath(new URL("./fixtures/mock-opencode-cli.mjs", import.meta.url));

type ProviderHarness = {
  id: "codex" | "claude-code" | "opencode";
  binaryEnv: string;
  scenarioEnv: string;
  binaryPath: string;
  createAgent: () => Agent;
  model?: string;
  clearEnv?: string[];
};

const providers: ProviderHarness[] = [
  {
    id: "codex",
    binaryEnv: "ARENA_CODEX_BIN",
    scenarioEnv: "ARENA_MOCK_CODEX_SCENARIO",
    binaryPath: mockCodexCliPath,
    createAgent: () => new CodexAgent(),
  },
  {
    id: "claude-code",
    binaryEnv: "ARENA_CLAUDE_BIN",
    scenarioEnv: "ARENA_MOCK_CLAUDE_SCENARIO",
    binaryPath: mockClaudeCliPath,
    createAgent: () => new ClaudeCodeAgent(),
  },
  {
    id: "opencode",
    binaryEnv: "ARENA_OPENCODE_BIN",
    scenarioEnv: "ARENA_MOCK_OPENCODE_SCENARIO",
    binaryPath: mockOpenCodeCliPath,
    createAgent: () => new OpenCodeAgent(),
    model: "opencode/deepseek-v4-flash-free",
    clearEnv: ["OPENCODE_API_KEY", "OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT"],
  },
];

async function withProviderScenario<T>(
  provider: ProviderHarness,
  scenario: string,
  fn: () => Promise<T>,
): Promise<T> {
  const touched = [provider.binaryEnv, provider.scenarioEnv, ...(provider.clearEnv ?? [])];
  const previous = new Map<string, string | undefined>();
  for (const key of touched) previous.set(key, process.env[key]);

  process.env[provider.binaryEnv] = provider.binaryPath;
  process.env[provider.scenarioEnv] = scenario;
  for (const key of provider.clearEnv ?? []) delete process.env[key];

  try {
    return await fn();
  } finally {
    for (const key of touched) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function executeHarnessScenario(provider: ProviderHarness, scenario: string) {
  const workDir = mkdtempSync(path.join(tmpdir(), `ralph-${provider.id}-shared-harness-`));
  return withProviderScenario(provider, scenario, async () => {
    const agent = provider.createAgent();
    return agent.execute({
      workDir,
      prompt: "Replay the incident without using live provider APIs.",
      timeout: 1,
      verbose: true,
      ...(provider.model ? { model: provider.model } : {}),
    });
  });
}

test("RA-264 shared CLI failure harness covers first-party agent failure categories", async () => {
  const cases: Array<{
    scenario: string;
    category: AgentErrorCategory;
    pattern: RegExp;
  }> = [
    { scenario: "rate_limit", category: "rate_limit", pattern: /limit|429|usage/i },
    { scenario: "auth", category: "auth", pattern: /auth|token|OPENCODE_API_KEY/i },
    { scenario: "config", category: "config", pattern: /unknown model|invalid_request|unsupported/i },
    { scenario: "budget", category: "budget", pattern: /budget|402|balance/i },
    { scenario: "infra", category: "infra", pattern: /ECONNREFUSED|service unavailable|network/i },
  ];

  for (const provider of providers) {
    for (const entry of cases) {
      const result = await executeHarnessScenario(provider, entry.scenario);

      assert.equal(result.success, false, `${provider.id}:${entry.scenario} should fail`);
      assert.equal(result.error?.category, entry.category, `${provider.id}:${entry.scenario} category`);
      assert.match(
        [result.error?.message ?? "", result.output].join("\n"),
        entry.pattern,
        `${provider.id}:${entry.scenario} should preserve provider-shaped error text`,
      );

      if (provider.id === "claude-code" && entry.scenario === "rate_limit") {
        assert.equal(result.error?.retryAt, "2026-04-22T19:00:00.000Z");
      }
    }
  }
});

test("RA-264 shared CLI failure harness preserves completion text on non-zero exits", async () => {
  for (const provider of providers) {
    const result = await executeHarnessScenario(provider, "completion_then_rate_limit");

    assert.equal(result.success, false, `${provider.id} should fail`);
    assert.equal(result.error?.category, "rate_limit", `${provider.id} category`);
    assert.match(result.output, /TASK_COMPLETE/, `${provider.id} should preserve completion signal text`);
    assert.equal(result.completionPromiseFound, false, `${provider.id} adapter does not decide completion`);
  }
});

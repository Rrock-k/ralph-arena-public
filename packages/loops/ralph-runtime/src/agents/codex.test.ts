import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAgent } from "./codex.js";

const mockCodexCliPath = fileURLToPath(new URL("./fixtures/mock-codex-cli.mjs", import.meta.url));

async function withMockCodexScenario<T>(
  scenario: string,
  fn: () => Promise<T>,
  argsFile?: string,
): Promise<T> {
  const previousCodexBin = process.env.ARENA_CODEX_BIN;
  const previousScenario = process.env.ARENA_MOCK_CODEX_SCENARIO;
  const previousArgsFile = process.env.ARENA_MOCK_CODEX_ARGS_FILE;

  process.env.ARENA_CODEX_BIN = mockCodexCliPath;
  process.env.ARENA_MOCK_CODEX_SCENARIO = scenario;
  if (argsFile) process.env.ARENA_MOCK_CODEX_ARGS_FILE = argsFile;
  else delete process.env.ARENA_MOCK_CODEX_ARGS_FILE;

  try {
    return await fn();
  } finally {
    if (previousCodexBin === undefined) {
      delete process.env.ARENA_CODEX_BIN;
    } else {
      process.env.ARENA_CODEX_BIN = previousCodexBin;
    }
    if (previousScenario === undefined) {
      delete process.env.ARENA_MOCK_CODEX_SCENARIO;
    } else {
      process.env.ARENA_MOCK_CODEX_SCENARIO = previousScenario;
    }
    if (previousArgsFile === undefined) delete process.env.ARENA_MOCK_CODEX_ARGS_FILE;
    else process.env.ARENA_MOCK_CODEX_ARGS_FILE = previousArgsFile;
  }
}

function readMockInvocations(argsFile: string): string[][] {
  return JSON.parse(readFileSync(argsFile, "utf8"));
}

function readLastMockInvocation(argsFile: string): string[] {
  const invocations = readMockInvocations(argsFile);
  assert.ok(invocations.length > 0);
  return invocations.at(-1)!;
}

function readConfigValues(args: string[]): string[] {
  return args.flatMap((arg, index) => (
    args[index - 1] === "-c" ? [arg] : []
  ));
}

async function executeScenario(scenario: string) {
  return withMockCodexScenario(scenario, async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 1,
      verbose: true,
    });
  });
}

test("CodexAgent routes Platform Credits Codex runs through the Arena OpenAI proxy provider", async () => {
  const previousOpenaiKey = process.env.OPENAI_API_KEY;
  const previousOpenaiBaseUrl = process.env.OPENAI_BASE_URL;
  const previousBillingMode = process.env.ARENA_PROVIDER_BILLING_MODE;
  const previousExpectedBaseUrl = process.env.ARENA_EXPECT_CODEX_PROXY_BASE_URL;
  const proxyBaseUrl = "http://api-proxy:4100/openai/project/project-1";

  process.env.OPENAI_API_KEY = "arena-proxy";
  process.env.OPENAI_BASE_URL = proxyBaseUrl;
  process.env.ARENA_PROVIDER_BILLING_MODE = "platform_credits";
  process.env.ARENA_EXPECT_CODEX_PROXY_BASE_URL = proxyBaseUrl;

  try {
    const result = await executeScenario("assert_proxy_config");

    assert.equal(result.success, true);
    assert.deepEqual(result.usage, {
      inputTokens: 120,
      outputTokens: 34,
      totalTokens: 154,
    });
  } finally {
    if (previousOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenaiKey;
    if (previousOpenaiBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousOpenaiBaseUrl;
    if (previousBillingMode === undefined) delete process.env.ARENA_PROVIDER_BILLING_MODE;
    else process.env.ARENA_PROVIDER_BILLING_MODE = previousBillingMode;
    if (previousExpectedBaseUrl === undefined) delete process.env.ARENA_EXPECT_CODEX_PROXY_BASE_URL;
    else process.env.ARENA_EXPECT_CODEX_PROXY_BASE_URL = previousExpectedBaseUrl;
  }
});

test("CodexAgent classifies usage-limit failures through the injected codex CLI boundary", async () => {
  const result = await executeScenario("rate_limit");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "rate_limit");
  assert.equal(result.providerSession?.id, "mock-codex-session");
  assert.match(result.error?.message ?? "", /usage limit/i);
  assert.ok((result.error?.retryAfterSec ?? 0) >= 60);
  assert.match(result.error?.retryAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.output, /usage limit/i);
});

test("CodexAgent classifies quota-exceeded billing output as rate limit", async () => {
  const result = await executeScenario("quota_exceeded_billing");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "rate_limit");
  assert.match(result.error?.message ?? "", /Quota exceeded/i);
  assert.match(result.output, /Quota exceeded/i);
});

test("CodexAgent resumes provider sessions with codex exec resume", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockCodexScenario("success", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      providerSessionResumeId: "session-old",
    });
  }, argsFile);

  const args = readLastMockInvocation(argsFile);
  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-codex-session");
  assert.equal(result.providerSession?.resumedFrom, "session-old");
  assert.deepEqual(args.slice(0, 3), ["exec", "resume", "--dangerously-bypass-approvals-and-sandbox"]);
  assert.ok(readConfigValues(args).includes('model_reasoning_effort="xhigh"'));
  assert.equal(args.includes("-C"), false);
  assert.equal(args.at(-2), "session-old");
  assert.equal(args.at(-1), "-");
});

test("CodexAgent timeout carries the captured session id for a resumable retry (RA-374)", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));

  const result = await withMockCodexScenario("timeout_hang", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      // 0.03 min ≈ 1.8s: long enough for session.started to stream, short
      // enough for the unit test to finish quickly.
      timeout: 0.03,
      verbose: true,
    });
  });

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "timeout");
  // The whole point of the fix: the session id survives the timeout so the
  // executor can record a resumable checkpoint.
  assert.equal(result.providerSession?.id, "mock-codex-session");
});

test("CodexAgent always requests maximum reasoning effort", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockCodexScenario("success", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 1,
      verbose: true,
      model: "gpt-5.5",
    });
  }, argsFile);

  const args = readLastMockInvocation(argsFile);
  assert.equal(result.success, true);
  assert.equal(args.includes("--model"), true);
  assert.equal(args[args.indexOf("--model") + 1], "gpt-5.5");
  assert.ok(readConfigValues(args).includes('model_reasoning_effort="xhigh"'));
});

test("CodexAgent falls back to a normal launch when resume target is gone", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockCodexScenario("resume_missing", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      providerSessionResumeId: "missing-session",
    });
  }, argsFile);

  const invocations = readMockInvocations(argsFile);
  const args = invocations.at(-1)!;
  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-codex-session");
  assert.equal(result.providerSession?.resumeFallbackReason, "No session found for id missing-session");
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].includes("resume"), true);
  assert.equal(args.includes("resume"), false);
});

test("CodexAgent treats missing rollout thread resume as unavailable session", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockCodexScenario("resume_rollout_missing", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      providerSessionResumeId: "019ef0d3-37bc-7002-a5bb-3d6ddbad00ec",
    });
  }, argsFile);

  const invocations = readMockInvocations(argsFile);
  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-codex-session");
  assert.match(result.providerSession?.resumeFallbackReason ?? "", /no rollout found for thread id/);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].includes("resume"), true);
  assert.equal(invocations.at(-1)?.includes("resume"), false);
});

test("CodexAgent does not hide invalid resume command support behind fallback", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockCodexScenario("resume_invalid_option", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      providerSessionResumeId: "session-old",
    });
  }, argsFile);

  const invocations = readMockInvocations(argsFile);
  const args = invocations.at(-1)!;
  assert.equal(result.success, false);
  assert.equal(invocations.length, 1);
  assert.equal(args.includes("resume"), true);
  assert.match(result.output, /invalid option --resume/);
});

test("CodexAgent ignores unrelated nested session-looking properties", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));

  const result = await withMockCodexScenario("nested_session_noise", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 1,
      verbose: true,
    });
  });

  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-codex-session");
});

test("CodexAgent ignores conversation item ids when extracting provider session", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-codex-agent-"));

  const result = await withMockCodexScenario("conversation_item_noise", async () => {
    const agent = new CodexAgent();
    return agent.execute({
      workDir,
      prompt: "Ship the feature",
      timeout: 1,
      verbose: true,
    });
  });

  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-codex-session");
});

test("CodexAgent classifies auth/config/budget/infra failures through the injected codex CLI boundary", async () => {
  const cases = [
    { scenario: "auth", category: "auth", pattern: /token has expired|authentication/i },
    { scenario: "config", category: "config", pattern: /unknown model|invalid_request_error/i },
    { scenario: "budget", category: "budget", pattern: /budget exhausted|402/i },
    { scenario: "infra", category: "infra", pattern: /econnrefused|connection/i },
    { scenario: "provider_auth_unavailable", category: "infra", pattern: /provider_auth_unavailable|api-proxy/i },
  ] as const;

  for (const { scenario, category, pattern } of cases) {
    const result = await executeScenario(scenario);

    assert.equal(result.success, false, `${scenario} should fail`);
    assert.equal(result.error?.category, category, `${scenario} should classify as ${category}`);
    assert.match(result.error?.message ?? "", pattern, `${scenario} should preserve the triggering error`);
  }
});

test("CodexAgent classifies hard stderr auth failures without JSON error events", async () => {
  const result = await executeScenario("hard_stderr_auth");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "auth");
  assert.match(result.error?.message ?? "", /401|invalid authentication/i);
  assert.match(result.output, /Invalid authentication credentials/i);
});

test("CodexAgent preserves completion text on non-zero exit so executor can apply the real completion-signal guard", async () => {
  const result = await executeScenario("completion_then_rate_limit");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "rate_limit");
  assert.match(result.output, /<promise>TASK_COMPLETE<\/promise>/);
});

test("CodexAgent availability and version checks use the injected codex CLI binary", async () => {
  await withMockCodexScenario("success", async () => {
    const agent = new CodexAgent();
    assert.equal(await agent.isAvailable(), true);
    assert.equal(await agent.getVersion(), "codex mock 0.0.0");
  });
});

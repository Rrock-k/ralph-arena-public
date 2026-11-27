import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OpenCodeAgent } from "./opencode.js";

const mockOpenCodeCliPath = fileURLToPath(new URL("./fixtures/mock-opencode-cli.mjs", import.meta.url));

async function withMockOpenCodeScenario<T>(
  scenario: string,
  fn: () => Promise<T>,
  files?: { argsFile?: string; envFile?: string },
): Promise<T> {
  const previousOpenCodeBin = process.env.ARENA_OPENCODE_BIN;
  const previousScenario = process.env.ARENA_MOCK_OPENCODE_SCENARIO;
  const previousArgsFile = process.env.ARENA_MOCK_OPENCODE_ARGS_FILE;
  const previousEnvFile = process.env.ARENA_MOCK_OPENCODE_ENV_FILE;
  const previousApiKey = process.env.OPENCODE_API_KEY;
  const previousConfig = process.env.OPENCODE_CONFIG;
  const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT;

  process.env.ARENA_OPENCODE_BIN = mockOpenCodeCliPath;
  process.env.ARENA_MOCK_OPENCODE_SCENARIO = scenario;
  if (files?.argsFile) process.env.ARENA_MOCK_OPENCODE_ARGS_FILE = files.argsFile;
  else delete process.env.ARENA_MOCK_OPENCODE_ARGS_FILE;
  if (files?.envFile) process.env.ARENA_MOCK_OPENCODE_ENV_FILE = files.envFile;
  else delete process.env.ARENA_MOCK_OPENCODE_ENV_FILE;

  try {
    return await fn();
  } finally {
    if (previousOpenCodeBin === undefined) delete process.env.ARENA_OPENCODE_BIN;
    else process.env.ARENA_OPENCODE_BIN = previousOpenCodeBin;
    if (previousScenario === undefined) delete process.env.ARENA_MOCK_OPENCODE_SCENARIO;
    else process.env.ARENA_MOCK_OPENCODE_SCENARIO = previousScenario;
    if (previousArgsFile === undefined) delete process.env.ARENA_MOCK_OPENCODE_ARGS_FILE;
    else process.env.ARENA_MOCK_OPENCODE_ARGS_FILE = previousArgsFile;
    if (previousEnvFile === undefined) delete process.env.ARENA_MOCK_OPENCODE_ENV_FILE;
    else process.env.ARENA_MOCK_OPENCODE_ENV_FILE = previousEnvFile;
    if (previousApiKey === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previousApiKey;
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = previousConfig;
    if (previousConfigContent === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
    else process.env.OPENCODE_CONFIG_CONTENT = previousConfigContent;
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

async function executeScenario(scenario: string, model = "opencode/deepseek-v4-flash-free") {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  return withMockOpenCodeScenario(scenario, async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Build Sushi Kitties",
      timeout: 1,
      verbose: true,
      model,
    });
  });
}

async function executeNoToolsScenario(scenario: string, model = "opencode/deepseek-v4-flash-free") {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  return withMockOpenCodeScenario(scenario, async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Return the controller audit JSON only",
      allowedTools: [],
      timeout: 1,
      verbose: true,
      model,
    });
  });
}

test("OpenCodeAgent invokes opencode run through the injected binary", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Build Sushi Kitties",
      timeout: 2,
      verbose: true,
      model: "opencode/deepseek-v4-flash-free",
    });
  }, { argsFile });

  const args = readLastMockInvocation(argsFile);
  assert.equal(result.success, true);
  assert.match(result.output, /mock opencode response: Build Sushi Kitties/);
  assert.equal(result.providerSession?.id, "mock-opencode-session");
  assert.equal(result.usage?.inputTokens, 11);
  assert.equal(result.usage?.outputTokens, 7);
  assert.equal(args[0], "run");
  assert.equal(args.includes("--dangerously-skip-permissions"), true);
  assert.equal(args[args.indexOf("--dir") + 1], workDir);
  assert.equal(args[args.indexOf("--format") + 1], "json");
  assert.equal(args[args.indexOf("--model") + 1], "opencode/deepseek-v4-flash-free");
  assert.equal(args.includes("Build Sushi Kitties"), false);
});

test("OpenCodeAgent timeout carries the captured session id for a resumable retry (RA-374)", async () => {
  const result = await withMockOpenCodeScenario("timeout_hang", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Build Sushi Kitties",
      timeout: 0.03,
      verbose: true,
      model: "opencode/deepseek-v4-flash-free",
    });
  });

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "timeout");
  assert.equal(result.providerSession?.id, "mock-opencode-session");
});

test("OpenCodeAgent resumes provider sessions with --session", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      model: "opencode/deepseek-v4-flash-free",
      providerSessionResumeId: "session-old",
    });
  }, { argsFile });

  const args = readLastMockInvocation(argsFile);
  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-opencode-session");
  assert.equal(result.providerSession?.resumedFrom, "session-old");
  assert.equal(args[args.indexOf("--session") + 1], "session-old");
});

test("OpenCodeAgent falls back to a normal launch when resume target is gone", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockOpenCodeScenario("resume_missing", async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      model: "opencode/deepseek-v4-flash-free",
      providerSessionResumeId: "missing-session",
    });
  }, { argsFile });

  const invocations = readMockInvocations(argsFile);
  const args = invocations.at(-1)!;
  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-opencode-session");
  assert.equal(result.providerSession?.resumeFallbackReason, "No session found for missing-session.");
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].includes("--session"), true);
  assert.equal(args.includes("--session"), false);
});

test("OpenCodeAgent does not hide invalid resume command support behind fallback", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const argsFile = path.join(workDir, "args.json");

  const result = await withMockOpenCodeScenario("resume_invalid_option", async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      model: "opencode/deepseek-v4-flash-free",
      providerSessionResumeId: "session-old",
    });
  }, { argsFile });

  const invocations = readMockInvocations(argsFile);
  const args = invocations.at(-1)!;
  assert.equal(result.success, false);
  assert.equal(invocations.length, 1);
  assert.equal(args.includes("--session"), true);
  assert.match(result.output, /invalid option --session/);
});

test("OpenCodeAgent ignores non-step nested session-looking properties", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));

  const result = await withMockOpenCodeScenario("nested_session_noise", async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Continue WIP",
      timeout: 1,
      verbose: true,
      model: "opencode/deepseek-v4-flash-free",
    });
  });

  assert.equal(result.success, true);
  assert.equal(result.providerSession?.id, "mock-opencode-session");
});

test("OpenCodeAgent maps an explicit no-tools request to the Arena controller agent", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const argsFile = path.join(workDir, "args.json");

  await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    await agent.execute({
      workDir,
      prompt: "Return JSON only",
      allowedTools: [],
      model: "opencode/deepseek-v4-flash-free",
    });
  }, { argsFile });

  const args = readLastMockInvocation(argsFile);
  assert.equal(args[args.indexOf("--agent") + 1], "arena-controller");
  assert.equal(args.includes("Return JSON only"), false);
});

test("OpenCodeAgent injects a denied-permission no-tools controller agent", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const envFile = path.join(workDir, "env.json");
  delete process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_CONFIG_CONTENT;

  await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    await agent.execute({
      workDir,
      prompt: "Return JSON only",
      allowedTools: [],
      model: "opencode/deepseek-v4-flash-free",
    });
  }, { envFile });

  const env = JSON.parse(readFileSync(envFile, "utf8"));
  const config = JSON.parse(env.OPENCODE_CONFIG_FILE_CONTENT);
  const controller = config.agent["arena-controller"];

  assert.match(env.OPENCODE_CONFIG, /opencode\.json$/);
  assert.equal(controller.mode, "primary");
  assert.equal(controller.model, "opencode/deepseek-v4-flash-free");
  assert.match(controller.prompt, /Never call tools/);
  assert.equal(controller.permission.bash, "deny");
  assert.equal(controller.permission.task, "deny");
  assert.equal(controller.permission.websearch, "deny");
  assert.equal(config.provider, undefined);
});

test("OpenCodeAgent injects OpenCode Zen API key through inline config without copying the key", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const envFile = path.join(workDir, "env.json");
  process.env.OPENCODE_API_KEY = "secret-opencode-key";
  delete process.env.OPENCODE_CONFIG_CONTENT;

  await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    await agent.execute({
      workDir,
      prompt: "Use free model",
      model: "opencode/big-pickle",
    });
  }, { envFile });

  const env = JSON.parse(readFileSync(envFile, "utf8"));
  const config = JSON.parse(env.OPENCODE_CONFIG_FILE_CONTENT);
  assert.match(env.OPENCODE_CONFIG, /opencode\.json$/);
  assert.equal(env.OPENCODE_API_KEY, "present");
  assert.equal(config.model, "opencode/big-pickle");
  assert.equal(config.small_model, "opencode/big-pickle");
  assert.equal(config.provider.opencode.options.apiKey, "{env:OPENCODE_API_KEY}");
  assert.doesNotMatch(env.OPENCODE_CONFIG_CONTENT, /secret-opencode-key/);
});

test("OpenCodeAgent does not require OpenCode Zen API key config for free models", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const envFile = path.join(workDir, "env.json");
  delete process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_CONFIG_CONTENT;

  await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    await agent.execute({
      workDir,
      prompt: "Use credentialless free model",
      model: "opencode/deepseek-v4-flash-free",
    });
  }, { envFile });

  const env = JSON.parse(readFileSync(envFile, "utf8"));
  assert.equal(env.OPENCODE_API_KEY, "missing");
  assert.equal(env.OPENCODE_CONFIG, null);
  assert.equal(env.OPENCODE_CONFIG_FILE_CONTENT, null);
  assert.equal(env.OPENCODE_CONFIG_CONTENT, null);
});

test("OpenCodeAgent merges no-tools agent into existing inline config", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const envFile = path.join(workDir, "env.json");
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    theme: "opencode",
    agent: {
      reviewer: {
        mode: "primary",
      },
    },
  });

  await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    await agent.execute({
      workDir,
      prompt: "Return JSON only",
      allowedTools: [],
      model: "opencode/deepseek-v4-flash-free",
    });
  }, { envFile });

  const env = JSON.parse(readFileSync(envFile, "utf8"));
  const config = JSON.parse(env.OPENCODE_CONFIG_FILE_CONTENT);

  assert.equal(config.theme, "opencode");
  assert.equal(config.agent.reviewer.mode, "primary");
  assert.equal(config.agent["arena-controller"].permission.read, "deny");
});

test("OpenCodeAgent merges no-tools agent into an existing OPENCODE_CONFIG file", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  const envFile = path.join(workDir, "env.json");
  const existingConfigPath = path.join(workDir, "existing-opencode.json");
  writeFileSync(existingConfigPath, JSON.stringify({
    theme: "existing",
    agent: {
      reviewer: {
        mode: "subagent",
      },
    },
  }));
  delete process.env.OPENCODE_CONFIG;
  delete process.env.OPENCODE_CONFIG_CONTENT;

  await withMockOpenCodeScenario("success", async () => {
    process.env.OPENCODE_CONFIG = existingConfigPath;
    const agent = new OpenCodeAgent();
    await agent.execute({
      workDir,
      prompt: "Return JSON only",
      allowedTools: [],
      model: "opencode/deepseek-v4-flash-free",
    });
  }, { envFile });

  const env = JSON.parse(readFileSync(envFile, "utf8"));
  const config = JSON.parse(env.OPENCODE_CONFIG_FILE_CONTENT);

  assert.notEqual(env.OPENCODE_CONFIG, existingConfigPath);
  assert.equal(config.theme, "existing");
  assert.equal(config.agent.reviewer.mode, "subagent");
  assert.equal(config.agent["arena-controller"].permission.read, "deny");
});

test("OpenCodeAgent rejects invalid existing config when injecting controller config", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));
  delete process.env.OPENCODE_CONFIG;
  delete process.env.OPENCODE_CONFIG_CONTENT;

  const result = await withMockOpenCodeScenario("success", async () => {
    process.env.OPENCODE_CONFIG_CONTENT = "not json";
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Return JSON only",
      allowedTools: [],
      model: "opencode/deepseek-v4-flash-free",
    });
  });

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "config");
  assert.match(result.error?.message ?? "", /OpenCode config must be valid JSON/i);
});

test("OpenCodeAgent extracts assistant text from OpenCode part.text events", async () => {
  const result = await executeScenario("part_text_success");

  assert.equal(result.success, true);
  assert.equal(result.output, '```json\n{"projectGoal":"OpenCode smoke","phases":[],"judgments":[]}\n```');
  assert.equal(result.usage?.inputTokens, 13);
  assert.equal(result.usage?.outputTokens, 17);
});

test("OpenCodeAgent ignores non-error stderr notices on zero exit", async () => {
  const result = await executeScenario("stderr_notice_success");

  assert.equal(result.success, true);
  assert.match(result.output, /mock opencode response: Build Sushi Kitties/);
});

test("OpenCodeAgent treats no-tools DSML tool-call output as infra failure", async () => {
  const result = await executeNoToolsScenario("no_tools_dsml_tool_calls");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "infra");
  assert.match(result.error?.message ?? "", /tool-call output/i);
  assert.match(result.output, /DSML/);
  assert.match(result.output, /tool_calls/);
});

test("OpenCodeAgent treats no-tools XML tool-call output as infra failure", async () => {
  const result = await executeNoToolsScenario("no_tools_xml_tool_calls");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "infra");
  assert.match(result.error?.message ?? "", /tool-call output/i);
  assert.match(result.output, /read_file/);
});

test("OpenCodeAgent treats no-tools event-only output as infra failure", async () => {
  const result = await executeNoToolsScenario("no_tools_event_only");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "infra");
  assert.match(result.error?.message ?? "", /without assistant text/i);
  assert.match(result.output, /step_start/);
  assert.match(result.output, /step_finish/);
});

test("OpenCodeAgent classifies auth/config/rate-limit/budget/infra failures", async () => {
  const cases = [
    { scenario: "auth", category: "auth", pattern: /OPENCODE_API_KEY is missing/i },
    { scenario: "config", category: "config", pattern: /Unknown model/i },
    { scenario: "rate_limit", category: "rate_limit", pattern: /429|Rate limit/i },
    { scenario: "budget", category: "budget", pattern: /Insufficient balance/i },
    { scenario: "infra", category: "infra", pattern: /service unavailable/i },
    { scenario: "infra_e2big", category: "infra", pattern: /E2BIG/i },
  ] as const;

  for (const { scenario, category, pattern } of cases) {
    const result = await executeScenario(scenario);

    assert.equal(result.success, false, `${scenario} should fail`);
    assert.equal(result.error?.category, category, `${scenario} should classify as ${category}`);
    assert.match(result.error?.message ?? "", pattern, `${scenario} should preserve the triggering error`);
  }
});

test("OpenCodeAgent treats structured error events as failure even on zero exit", async () => {
  const result = await executeScenario("structured_error");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "config");
  assert.match(result.error?.message ?? "", /Unsupported model/i);
});

test("OpenCodeAgent rejects missing explicit model", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "ralph-opencode-agent-"));

  const result = await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    return agent.execute({
      workDir,
      prompt: "Build Sushi Kitties",
      timeout: 1,
    });
  });

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "config");
  assert.match(result.error?.message ?? "", /explicit model/i);
});

test("OpenCodeAgent treats empty zero-exit output as infra failure", async () => {
  const result = await executeScenario("empty_success");

  assert.equal(result.success, false);
  assert.equal(result.error?.category, "infra");
  assert.match(result.error?.message ?? "", /empty stdout/i);
});

test("OpenCodeAgent availability and version checks use the injected binary", async () => {
  await withMockOpenCodeScenario("success", async () => {
    const agent = new OpenCodeAgent();
    assert.equal(await agent.isAvailable(), true);
    assert.equal(await agent.getVersion(), "opencode mock 1.0.0");
  });
});

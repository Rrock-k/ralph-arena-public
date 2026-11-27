#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const scenario = process.env.ARENA_MOCK_CODEX_SCENARIO || "success";
const completionSignal = "<promise>TASK_COMPLETE</promise>";
const json = args.includes("--json");

if (args.includes("--version")) {
  process.stdout.write("codex mock 0.0.0\n");
  process.exit(0);
}

if (process.env.ARENA_MOCK_CODEX_ARGS_FILE) {
  let invocations = [];
  try {
    invocations = JSON.parse(readFileSync(process.env.ARENA_MOCK_CODEX_ARGS_FILE, "utf8"));
  } catch {
    invocations = [];
  }
  invocations.push(args);
  writeFileSync(process.env.ARENA_MOCK_CODEX_ARGS_FILE, JSON.stringify(invocations));
}

function emitJson(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function failWithMessage(message, options = {}) {
  const { emitCompletion = false } = options;

  if (json) {
    if (emitCompletion) {
      emitJson({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `Finished implementation.\n${completionSignal}`,
        },
      });
    }
    emitJson({ type: "error", message });
  } else {
    if (emitCompletion) {
      process.stdout.write(`Finished implementation.\n${completionSignal}\n`);
    }
    process.stderr.write(`${message}\n`);
  }

  process.exit(1);
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

process.stdin.on("end", () => {
  if (scenario === "hard_stderr_auth") {
    process.stderr.write("401 Invalid authentication credentials\n");
    process.exit(1);
  }

  if (json) {
    emitJson({
      type: "session.started",
      id: "mock-codex-session",
    });
  }

  if (scenario === "timeout_hang") {
    // Session id is already emitted above. Hang so the agent's own timeout
    // fires SIGTERM; keep the event loop alive without exiting.
    setInterval(() => {}, 1000);
    return;
  }

  if (scenario === "resume_missing" && args.includes("resume")) {
    failWithMessage("No session found for id missing-session");
  }

  if (scenario === "resume_rollout_missing" && args.includes("resume")) {
    failWithMessage("thread/resume failed: no rollout found for thread id 019ef0d3-37bc-7002-a5bb-3d6ddbad00ec (code -32600)");
  }

  if (scenario === "resume_invalid_option" && args.includes("resume")) {
    failWithMessage("invalid option --resume");
  }

  if (scenario === "assert_proxy_config") {
    const configValues = args.flatMap((arg, index) => (
      args[index - 1] === "-c" ? [arg] : []
    ));
    const expectedBaseUrl = process.env.ARENA_EXPECT_CODEX_PROXY_BASE_URL;
    const providerConfig = configValues.find((value) => (
      value.startsWith("model_providers.arena-openai-proxy=")
    ));

    if (!configValues.includes('model_provider="arena-openai-proxy"')) {
      failWithMessage(`missing proxy model_provider config: ${args.join(" ")}`);
    }
    if (!providerConfig?.includes(`base_url="${expectedBaseUrl}"`)) {
      failWithMessage(`missing proxy base_url config: ${providerConfig ?? args.join(" ")}`);
    }
    if (!providerConfig.includes('bearer_token_env_var="OPENAI_API_KEY"')) {
      failWithMessage(`missing proxy bearer env config: ${providerConfig}`);
    }
  }

  if (scenario === "rate_limit") {
    failWithMessage("You've hit your usage limit. resets_in_seconds: 900. Try again at 12:34 PM.");
  }

  if (scenario === "quota_exceeded_billing") {
    failWithMessage("ERROR: Quota exceeded. Check your plan and billing details.");
  }

  if (scenario === "auth") {
    failWithMessage("OAuth token has expired. Authentication required.");
  }

  if (scenario === "config") {
    failWithMessage("invalid_request_error: unknown model gpt-9999");
  }

  if (scenario === "budget") {
    failWithMessage("Budget exhausted for this workspace (402)");
  }

  if (scenario === "infra") {
    failWithMessage("connect ECONNREFUSED api.openai.com:443");
  }

  if (scenario === "provider_auth_unavailable") {
    failWithMessage('503 {"error":{"type":"provider_auth_unavailable","message":"Platform openai API key is not configured in api-proxy."}}');
  }

  if (scenario === "completion_then_rate_limit") {
    failWithMessage("You've hit your usage limit. Try again at 12:34 PM.", {
      emitCompletion: true,
    });
  }

  if (json) {
    if (scenario === "nested_session_noise") {
      emitJson({
        type: "item.completed",
        properties: {
          sessionID: "wrong-nested-session",
        },
        item: {
          type: "agent_message",
          text: "noise event",
        },
      });
    }
    if (scenario === "conversation_item_noise") {
      emitJson({
        type: "conversation.item.completed",
        id: "wrong-message-id",
        item: {
          type: "agent_message",
          text: "noise event",
        },
      });
    }
    emitJson({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: stdin.trim() ? `mock response: ${stdin.trim()}` : "mock response",
      },
    });
    emitJson({
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        output_tokens: 34,
        total_tokens: 154,
      },
    });
  } else {
    process.stdout.write(stdin.trim() ? `mock response: ${stdin.trim()}\n` : "mock response\n");
  }
  process.exit(0);
});

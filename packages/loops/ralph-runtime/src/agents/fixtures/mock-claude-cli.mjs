#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const scenario = process.env.ARENA_MOCK_CLAUDE_SCENARIO || "success";
const streamJson = args.includes("--output-format") && args.includes("stream-json");
const completionSignal = "<promise>TASK_COMPLETE</promise>";

if (args.includes("--version")) {
  process.stdout.write("claude mock 0.0.0\n");
  process.exit(0);
}

if (process.env.ARENA_MOCK_CLAUDE_ARGS_FILE) {
  appendFileSync(process.env.ARENA_MOCK_CLAUDE_ARGS_FILE, `${JSON.stringify(args)}\n`);
}

function emitJson(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitFailure(message, options = {}) {
  const { emitStructuredRateLimit = false, emitCompletion = false } = options;

  if (streamJson) {
    emitJson({
      type: "system",
      subtype: "init",
      session_id: "mock-session",
    });
    if (emitCompletion) {
      emitJson({
        type: "assistant",
        message: {
          content: [{ type: "text", text: `Finished implementation.\n${completionSignal}` }],
        },
        session_id: "mock-session",
      });
    }
    if (emitStructuredRateLimit) {
      emitJson({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1776884400,
        },
      });
    }
    emitJson({
      type: "result",
      subtype: "success",
      is_error: true,
      result: message,
      session_id: "mock-session",
    });
  } else {
    if (emitCompletion) {
      process.stdout.write(`Finished implementation.\n${completionSignal}\n`);
    }
    process.stderr.write(`${message}\n`);
  }

  process.exit(1);
}

function emitSuccessRateLimitTelemetry(status) {
  if (streamJson) {
    emitJson({
      type: "system",
      subtype: "init",
      session_id: "mock-session",
    });
    emitJson({
      type: "rate_limit_event",
      rate_limit_info: {
        status,
        resetsAt: 1777471200,
        rateLimitType: "seven_day",
        utilization: 0.28,
        isUsingOverage: false,
      },
    });
    emitJson({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "warning only" }],
      },
    });
    emitJson({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "warning only",
      session_id: "mock-session",
    });
    process.exit(0);
  }

  process.stdout.write("warning only\n");
  process.exit(0);
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

process.stdin.on("end", () => {
  if (scenario === "timeout_hang") {
    // Emit the session id, then hang so the agent's own timeout fires SIGTERM.
    if (streamJson) {
      emitJson({ type: "system", subtype: "init", session_id: "mock-session" });
    }
    setInterval(() => {}, 1000);
    return;
  }

  if (scenario === "rate_limit") {
    emitFailure("You've hit your limit · resets 7pm (UTC)", {
      emitStructuredRateLimit: true,
    });
  }

  if (scenario === "auth") {
    emitFailure("OAuth token has expired. Authentication required.");
  }

  if (scenario === "config") {
    emitFailure("invalid_request_error: unknown model claude-not-real");
  }

  if (scenario === "budget") {
    emitFailure("Budget exhausted for this workspace (402)");
  }

  if (scenario === "infra") {
    emitFailure("connect ECONNREFUSED api.anthropic.com:443");
  }

  if (scenario === "completion_then_rate_limit") {
    emitFailure("You've hit your limit · resets 7pm (UTC)", {
      emitStructuredRateLimit: true,
      emitCompletion: true,
    });
  }

  if (scenario === "duplicate_json" && streamJson) {
    const jsonBlock = "```json\n{\"summary\":\"ok\",\"planChanges\":[],\"newJudgments\":[]}\n```";
    emitJson({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1776884400,
      },
    });
    emitJson({
      type: "assistant",
      message: {
        content: [{ type: "text", text: jsonBlock }],
      },
    });
    emitJson({
      type: "result",
      subtype: "success",
      is_error: false,
      result: jsonBlock,
      session_id: "mock-session",
    });
    process.exit(0);
  }

  if (scenario === "allowed_warning") {
    emitSuccessRateLimitTelemetry("allowed_warning");
  }

  if (scenario === "resume_missing" && args.includes("--resume")) {
    const resumeIndex = args.indexOf("--resume");
    const sessionId = resumeIndex >= 0 ? args[resumeIndex + 1] : "";
    emitFailure(`No conversation found for session ${sessionId}`);
  }

  if ((scenario === "success" || scenario === "resume_missing") && streamJson) {
    emitJson({
      type: "assistant",
      message: {
        content: [{ type: "text", text: stdin.trim() ? `mock response: ${stdin.trim()}` : "mock response" }],
      },
    });
    emitJson({
      type: "result",
      subtype: "success",
      is_error: false,
      result: stdin.trim() ? `mock response: ${stdin.trim()}` : "mock response",
      session_id: "mock-session",
      usage: {
        input_tokens: 210,
        output_tokens: 45,
        total_tokens: 255,
      },
    });
  } else {
    process.stdout.write(stdin.trim() ? `mock response: ${stdin.trim()}\n` : "mock response\n");
  }

  process.exit(0);
});

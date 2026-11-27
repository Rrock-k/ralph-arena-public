#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const scenario = process.env.ARENA_MOCK_ANTIGRAVITY_SCENARIO || "success";

if (args.includes("--version")) {
  process.stdout.write("agy mock 1.0.0\n");
  process.exit(0);
}

if (process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE) {
  appendFileSync(process.env.ARENA_MOCK_ANTIGRAVITY_ARGS_FILE, `${JSON.stringify(args)}\n`);
}

function promptFromArgs() {
  const printIndex = args.indexOf("--print");
  if (printIndex === -1) return "";
  return args.slice(printIndex + 1).join(" ").trim();
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

switch (scenario) {
  case "auth":
    process.stdout.write("Authentication required. Please visit the URL to log in:\n");
    process.stdout.write("  https://accounts.google.com/o/oauth2/auth?client_id=secret&state=secret\n");
    fail("Error: authentication timed out.");
    break;
  case "auth_zero":
    process.stdout.write("Authentication required. Please visit the URL to log in:\n");
    process.stdout.write("  https://accounts.google.com/o/oauth2/auth?client_id=secret&state=secret\n");
    process.stderr.write("Error: authentication timed out.\n");
    process.exit(0);
  case "invalid_grant":
    fail('Error: authentication failed: token exchange failed: oauth2: "invalid_grant" "Invalid code verifier."');
    break;
  case "config":
    fail("unsupported model override: Gemini 0 Flash");
    break;
  case "rate_limit":
    fail("You've hit your usage limit. resets_in_seconds: 600.");
    break;
  case "budget":
    fail("Budget exhausted for this workspace (402).");
    break;
  case "infra":
    fail("CLI failed - listen tcp 127.0.0.1:0: bind: operation not permitted");
    break;
  case "successful_json_with_error_words":
    process.stdout.write("```json\n");
    process.stdout.write(JSON.stringify({
      projectGoal: "Handle required game states without confusing failure text for CLI errors.",
      phases: [{
        id: "phase-1",
        name: "Build UI",
        description: "Create the app and include error-state copy for failed sushi orders.",
        order: 1,
        status: "pending",
        planLater: false,
        tasks: [{
          id: "task-001",
          description: "Implement required UI and failure feedback.",
          acceptanceCriteria: [
            "No broken layout elements are present.",
            "Failed sushi orders show playful feedback."
          ],
          status: "pending",
          priority: 5,
          dependencies: [],
          attempts: 0
        }]
      }],
      judgments: []
    }, null, 2));
    process.stdout.write("\n```\n");
    process.exit(0);
  case "empty_success":
    process.exit(0);
  case "empty_success_with_log_rate_limit": {
    const home = process.env.ARENA_ANTIGRAVITY_HOME || process.env.HOME;
    const logDir = path.join(home, ".gemini", "antigravity-cli", "log");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      path.join(logDir, "cli-mock.log"),
      "E0000 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 164h30m39s.\n",
    );
    process.exit(0);
  }
  default: {
    const prompt = promptFromArgs();
    process.stdout.write(prompt ? `mock agy response: ${prompt}\n` : "mock agy response\n");
    process.exit(0);
  }
}

/**
 * Direct loop v1.1.0
 *
 * Extends v1.0.0 with QA support: after each iteration, asks the agent
 * to generate test cases. Writes test_request events to .arena/outgoing-events.json.
 * Reads test_result events from .arena/events.json and feeds failures into the next prompt.
 *
 * Capabilities: specs, progress, community_qa, log_streaming
 *
 * Usage:
 *   node /arena/cycles/direct/v1.1.0.js --agent claude-code --model haiku --spec-dir /workspace/specs --work-dir /workspace
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  buildConfig, log, writeProgress, writeResult,
  hashSpecs, readAllSpecs, setupCodexAuth,
  runAgent, writeRateLimitResultIfDetected,
  gitCommitAndPush, deployApp, checkCompletion,
} from "../shared.js";

const cfg = buildConfig();

const OUTGOING_EVENTS_FILE = join(cfg.workDir, ".arena", "outgoing-events.json");
const INCOMING_EVENTS_FILE = join(cfg.workDir, ".arena", "events.json");

// ── QA helpers ───────────────────────────────────────────

interface TestStep { question: string }
interface OutgoingEvent { type: string; payload: { title: string; steps: TestStep[]; url?: string } }
interface TestResultEvent {
  type: string;
  payload: {
    testRequestEventId: string;
    results: Array<{ stepIndex: number; passed: boolean; comment?: string }>;
  };
}

function readOutgoingEvents(): OutgoingEvent[] {
  try {
    return JSON.parse(readFileSync(OUTGOING_EVENTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeOutgoingEvents(events: OutgoingEvent[]): void {
  mkdirSync(join(cfg.workDir, ".arena"), { recursive: true });
  writeFileSync(OUTGOING_EVENTS_FILE, JSON.stringify(events, null, 2));
}

function readTestResults(): TestResultEvent[] {
  try {
    const all: Array<{ type: string; payload: unknown }> = JSON.parse(readFileSync(INCOMING_EVENTS_FILE, "utf-8"));
    return all.filter((e) => e.type === "test_result") as TestResultEvent[];
  } catch {
    return [];
  }
}

function formatTestFeedback(results: TestResultEvent[]): string {
  if (results.length === 0) return "";
  const lines: string[] = ["--- QA FEEDBACK ---"];
  for (const r of results) {
    const steps = r.payload.results;
    const failed = steps.filter((s) => !s.passed);
    const passed = steps.filter((s) => s.passed);
    lines.push(`Test ${r.payload.testRequestEventId}: ${passed.length} passed, ${failed.length} failed`);
    for (const f of failed) {
      lines.push(`  FAILED step ${f.stepIndex}${f.comment ? `: ${f.comment}` : ""}`);
    }
  }
  lines.push("--- END QA FEEDBACK ---");
  lines.push("Fix the failing tests above before marking completion.");
  return lines.join("\n");
}

async function generateQaTests(iteration: number): Promise<boolean> {
  log("QA: Asking agent to generate test cases...");
  writeProgress(cfg, "qa_generating", iteration);

  const qaPrompt = `You just finished an iteration of building this project. Now generate QA test cases that a human tester should verify.

Output a JSON array of test cases. Each test case has a "title" and "steps" (array of {"question": "..."}).
Questions should be things a human can manually verify by looking at the app in a browser.

Example:
\`\`\`json
[
  {
    "title": "Homepage loads correctly",
    "steps": [
      {"question": "Does the homepage load without errors?"},
      {"question": "Is the navigation bar visible at the top?"}
    ]
  }
]
\`\`\`

Output ONLY the JSON array, no other text. If there are no meaningful tests to generate, output \`[]\`.`;

  const run = await runAgent(cfg, qaPrompt, cfg.agent === "claude-code");
  if (writeRateLimitResultIfDetected(cfg, run, iteration, "qa_generation")) {
    return true;
  }
  const output = run.output;

  const jsonMatch = output.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (!jsonMatch) {
    log("QA: No test cases extracted from agent output");
    return false;
  }

  try {
    const testCases: Array<{ title: string; steps: TestStep[] }> = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(testCases) || testCases.length === 0) {
      log("QA: Empty test case array");
      return false;
    }

    const existing = readOutgoingEvents();
    for (const tc of testCases) {
      if (tc.title && Array.isArray(tc.steps) && tc.steps.length > 0) {
        existing.push({ type: "test_request", payload: { title: tc.title, steps: tc.steps } });
      }
    }
    writeOutgoingEvents(existing);
    log(`QA: Generated ${testCases.length} test case(s), total outgoing: ${existing.length}`);
  } catch (e) {
    log(`QA: Failed to parse test cases: ${e}`);
  }
  return false;
}

// ── Main loop ────────────────────────────────────────────

async function main(): Promise<void> {
  log(`Starting direct cycle v1.1.0 (QA enabled)`);
  log(`Agent: ${cfg.agent} | Model: ${cfg.model} | Max iterations: ${cfg.maxIterations}`);
  log(`Work dir: ${cfg.workDir} | Spec dir: ${cfg.specDir}`);

  setupCodexAuth();

  let completed = false;
  let prevSpecHash = hashSpecs(cfg.specDir);
  log(`Initial spec hash: ${prevSpecHash.slice(0, 12)}...`);

  for (let i = 1; i <= cfg.maxIterations; i++) {
    writeProgress(cfg, "coding", i);
    log(`========== Iteration ${i} / ${cfg.maxIterations} ==========`);

    // Check for spec changes
    let specChanged = false;
    if (i > 1) {
      const currHash = hashSpecs(cfg.specDir);
      if (currHash !== prevSpecHash) {
        log(`Specs changed (${prevSpecHash.slice(0, 8)} → ${currHash.slice(0, 8)})`);
        prevSpecHash = currHash;
        specChanged = true;
      }
    }

    // Build prompt (with QA feedback on continuation iterations)
    let prompt: string;
    const isFirstIteration = i === 1;

    if (isFirstIteration) {
      prompt = cfg.agent === "codex"
        ? `Complete ALL tasks described in the spec files in the specs/ directory.
The app MUST serve on port 3000. Include a /health endpoint returning {"ok": true}.
If you need a missing project secret, call: node /arena/request-secrets.js SECRET_KEY "What this secret is for"
Use --non-blocking only for optional secrets. Available values are written to .env.arena-secrets.
When fully complete, run: write this JSON to .arena/result.json: {"status":"DEPLOYED"}
Do NOT mark completion until everything is implemented and functional`
        : `You are building a project autonomously. Complete ALL tasks described in the specs below.

IMPORTANT RULES:
- The app MUST serve on port 3000 (use process.env.PORT || 3000)
- Include a /health endpoint returning {"ok": true}
- Available project secrets are in .env.arena-secrets
- If you need a missing secret, call: node /arena/request-secrets.js SECRET_KEY "What this secret is for"
- Use --non-blocking only for optional secrets; blocking requests may pause the run until an admin provides them
- When the task is FULLY complete and working, run: write this JSON to .arena/result.json: {"status":"DEPLOYED"}

- Do NOT mark completion until everything is implemented and functional

--- SPECS ---
${readAllSpecs(cfg.specDir)}`;
    } else if (specChanged) {
      prompt = cfg.agent === "codex"
        ? `IMPORTANT: The project specifications in the specs/ directory have been updated with new or changed requirements. Re-read all spec files in specs/ and continue implementing all requirements. If you need a missing secret, call node /arena/request-secrets.js SECRET_KEY "What this secret is for". When everything is fully complete and working, run: write this JSON to .arena/result.json: {"status":"DEPLOYED"}. Do NOT mark completion until everything is implemented and functional`
        : `IMPORTANT: The project specifications have been updated.

Here are the current specs:

--- UPDATED SPECS ---
${readAllSpecs(cfg.specDir)}
--- END UPDATED SPECS ---

Continue implementing the project, incorporating all new and changed requirements.
If you need a missing secret, call: node /arena/request-secrets.js SECRET_KEY "What this secret is for"
When everything is fully complete and working, run: write this JSON to .arena/result.json: {"status":"DEPLOYED"}
Do NOT mark completion until everything is implemented and functional`;
    } else {
      const qaFeedback = formatTestFeedback(readTestResults());
      prompt = `Review the current state of the project. Check what has been built and what remains from the specs in the specs/ directory. Continue working on any incomplete parts. If you need a missing secret, call node /arena/request-secrets.js SECRET_KEY "What this secret is for". When everything is fully complete and working, run: write this JSON to .arena/result.json: {"status":"DEPLOYED"}${qaFeedback ? `\n\n${qaFeedback}` : ""}`;
    }

    const run = await runAgent(cfg, prompt, !isFirstIteration && cfg.agent === "claude-code");
    if (writeRateLimitResultIfDetected(cfg, run, i, "coding")) {
      return;
    }

    if (checkCompletion(cfg)) {
      log(`Completion detected (.arena/result.json) at iteration ${i}`);
      completed = true;
      break;
    }

    // Generate QA tests after iteration (not at max — no point)
    if (i < cfg.maxIterations) {
      if (await generateQaTests(i)) {
        return;
      }
    }

    log("No completion signal yet, continuing...");
  }

  // Post-run: commit, push, deploy
  writeProgress(cfg, "committing", cfg.maxIterations);
  gitCommitAndPush(cfg, `feat: direct agent run (${completed ? "completed" : "max iterations"})`);

  writeProgress(cfg, "deploying", cfg.maxIterations);
  deployApp(cfg);

  gitCommitAndPush(cfg, "chore: final state after deploy");

  if (completed) {
    writeProgress(cfg, "completed", cfg.maxIterations);
    log("SUCCESS");
    process.exit(0);
  } else {
    writeResult(cfg, "FAILED", `Max iterations (${cfg.maxIterations}) reached without completion`);
    writeProgress(cfg, "max_iterations", cfg.maxIterations);
    log(`FAILED: max iterations (${cfg.maxIterations}) reached without completion signal`);
    process.exit(1);
  }
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  writeResult(cfg, "FAILED", `Fatal error: ${err}`);
  process.exit(1);
});

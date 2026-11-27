/**
 * Direct loop v1.0.0
 *
 * Basic agent iteration cycle: runs claude/codex CLI in a loop,
 * detects completion via .arena/result.json, handles spec changes, git commit/push, deploy.
 *
 * Capabilities: specs, progress, log_streaming
 *
 * Usage:
 *   node /arena/cycles/direct/v1.0.0.js --agent claude-code --model haiku --spec-dir /workspace/specs --work-dir /workspace
 */

import {
  buildConfig, log, writeProgress, writeResult,
  hashSpecs, readAllSpecs, setupCodexAuth,
  runAgent, writeRateLimitResultIfDetected,
  gitCommitAndPush, deployApp, checkCompletion,
} from "../shared.js";

const cfg = buildConfig();

async function main(): Promise<void> {
  log(`Starting direct cycle v1.0.0`);
  log(`Agent: ${cfg.agent} | Model: ${cfg.model} | Max iterations: ${cfg.maxIterations}`);
  log(`Work dir: ${cfg.workDir} | Spec dir: ${cfg.specDir}`);

  setupCodexAuth();

  let completed = false;
  let prevSpecHash = hashSpecs(cfg.specDir);
  log(`Initial spec hash: ${prevSpecHash.slice(0, 12)}...`);

  for (let i = 1; i <= cfg.maxIterations; i++) {
    writeProgress(cfg, "coding", i);
    log(`========== Iteration ${i} / ${cfg.maxIterations} ==========`);

    // Check for spec changes (between iterations)
    let specChanged = false;
    if (i > 1) {
      const currHash = hashSpecs(cfg.specDir);
      if (currHash !== prevSpecHash) {
        log(`Specs changed (${prevSpecHash.slice(0, 8)} → ${currHash.slice(0, 8)})`);
        prevSpecHash = currHash;
        specChanged = true;
      }
    }

    // Build prompt — RA-247: completion = write .arena/result.json
    const completionInstruction = `When the task is FULLY complete and working, write this JSON to .arena/result.json: {"status":"DEPLOYED"}`;
    let prompt: string;
    const isFirstIteration = i === 1;

    if (isFirstIteration) {
      prompt = cfg.agent === "codex"
        ? `Complete ALL tasks described in the spec files in the specs/ directory.
The app MUST serve on port 3000. Include a /health endpoint returning {"ok": true}.
The app MUST have arena-start.sh in the workspace root that installs dependencies and starts the server.
If you need a missing project secret, call: node /arena/request-secrets.js SECRET_KEY "What this secret is for"
Use --non-blocking only for optional secrets. Available values are written to .env.arena-secrets.
${completionInstruction}
Do NOT mark completion until everything is implemented and functional`
        : `You are building a project autonomously. Complete ALL tasks described in the specs below.

IMPORTANT RULES:
- The app MUST serve on port 3000 (use process.env.PORT || 3000)
- Include a /health endpoint returning {"ok": true}
- The app MUST have arena-start.sh in the workspace root that installs dependencies and starts the server
- Available project secrets are in .env.arena-secrets
- If you need a missing secret, call: node /arena/request-secrets.js SECRET_KEY "What this secret is for"
- Use --non-blocking only for optional secrets; blocking requests may pause the run until an admin provides them
- ${completionInstruction}
- Do NOT mark completion until everything is implemented and functional

--- SPECS ---
${readAllSpecs(cfg.specDir)}`;
    } else if (specChanged) {
      prompt = cfg.agent === "codex"
        ? `IMPORTANT: The project specifications in the specs/ directory have been updated with new or changed requirements. Re-read all spec files in specs/ and continue implementing all requirements. If you need a missing secret, call node /arena/request-secrets.js SECRET_KEY "What this secret is for". ${completionInstruction}. Do NOT mark completion until everything is implemented and functional`
        : `IMPORTANT: The project specifications have been updated.

Here are the current specs:

--- UPDATED SPECS ---
${readAllSpecs(cfg.specDir)}
--- END UPDATED SPECS ---

Continue implementing the project, incorporating all new and changed requirements.
If you need a missing secret, call: node /arena/request-secrets.js SECRET_KEY "What this secret is for"
${completionInstruction}
Do NOT mark completion until everything is implemented and functional`;
    } else {
      prompt = `Review the current state of the project. Check what has been built and what remains from the specs in the specs/ directory. Continue working on any incomplete parts. If you need a missing secret, call node /arena/request-secrets.js SECRET_KEY "What this secret is for". ${completionInstruction}`;
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
    // Write result for runner to pick up
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

/**
 * Loop Compliance Test Harness (RA-196)
 *
 * Runs a loop command in a sandbox workspace with a mock agent,
 * then verifies the artifacts match the runner ↔ loop contract.
 *
 * Usage:
 *   import { runComplianceTest } from "./test-harness.js";
 *   const result = await runComplianceTest("node loop.js --work-dir {workdir}");
 */

import { spawn, execSync } from "child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface ComplianceCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning";
}

export interface ComplianceResult {
  passed: boolean;
  checks: ComplianceCheck[];
  detectedCapabilities: string[];
}

export interface ComplianceOpts {
  /** Timeout for loop execution in ms (default: 60_000) */
  timeout?: number;
  /** Port for preview server (default: 3099) */
  port?: number;
  /** Remove sandbox after test (default: true) */
  cleanup?: boolean;
}

/**
 * Interpolation placeholders in loop command:
 *   {agent}   → "mock"
 *   {specfile} → path to first spec file
 *   {specdir}  → path to specs directory
 *   {workdir}  → sandbox workspace path
 */
export async function runComplianceTest(
  loopCommand: string,
  opts: ComplianceOpts = {},
): Promise<ComplianceResult> {
  const timeout = opts.timeout ?? 60_000;
  const port = opts.port ?? 3099;
  const cleanup = opts.cleanup ?? true;

  // ── 1. Setup sandbox ──────────────────────────────────────────────
  const workspace = mkdtempSync(join(tmpdir(), "arena-compliance-"));
  const specsDir = join(workspace, "specs");
  const arenaDir = join(workspace, ".arena");

  try {
    mkdirSync(specsDir, { recursive: true });
    mkdirSync(arenaDir, { recursive: true });

    // Git init with a throwaway identity
    execSync("git init", { cwd: workspace, stdio: "pipe" });
    execSync('git config user.email "compliance@test"', {
      cwd: workspace,
      stdio: "pipe",
    });
    execSync('git config user.name "Compliance Test"', {
      cwd: workspace,
      stdio: "pipe",
    });
    writeFileSync(join(workspace, ".gitkeep"), "");
    execSync("git add -A && git commit -m 'init'", {
      cwd: workspace,
      stdio: "pipe",
      shell: "/bin/bash",
    });

    // Test spec
    writeFileSync(
      join(specsDir, "001-test-spec.md"),
      "# Test Spec\n\nCreate a hello-world HTTP server that responds on /health with 200.\n",
    );

    // .arena/ contract files (runner-provided)
    writeFileSync(join(arenaDir, "events.json"), "[]");
    writeFileSync(
      join(arenaDir, "platform.md"),
      "# Platform\n\nCompliance test environment.\n",
    );
    writeFileSync(join(workspace, ".env.arena-secrets"), "");

    execSync("git add -A && git commit -m 'add specs and arena'", {
      cwd: workspace,
      stdio: "pipe",
      shell: "/bin/bash",
    });

    // ── 2. Interpolate placeholders ─────────────────────────────────
    const specFile = join(specsDir, "001-test-spec.md");
    const interpolated = loopCommand
      .replace(/\{agent\}/g, "mock")
      .replace(/\{specfile\}/g, specFile)
      .replace(/\{specdir\}/g, specsDir)
      .replace(/\{workdir\}/g, workspace);

    // ── 3. Run loop ─────────────────────────────────────────────────
    let timedOut = false;

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn("sh", ["-c", interpolated], {
        cwd: workspace,
        stdio: "pipe",
        env: {
          ...process.env,
          ARENA_AGENT: "mock",
          ARENA_MODEL: "mock",
          ARENA_CAPABILITIES: "specs,progress",
          ARENA_WORK_DIR: workspace,
          ARENA_SPEC_DIR: specsDir,
          ARENA_PROJECT_ID: "compliance-test",
          ARENA_PUSH_BRANCH: "arena/project-compliance-test",
          PORT: String(port),
          CI: "true",
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
    });

    // ── 4. Verify artifacts ─────────────────────────────────────────
    const checks: ComplianceCheck[] = [];

    // result.json
    const resultPath = join(workspace, ".arena", "result.json");
    if (!existsSync(resultPath)) {
      checks.push({
        name: "result-json-exists",
        passed: false,
        message: ".arena/result.json missing",
        severity: "error",
      });
    } else {
      checks.push({
        name: "result-json-exists",
        passed: true,
        message: ".arena/result.json found",
        severity: "error",
      });
      try {
        const result = JSON.parse(readFileSync(resultPath, "utf-8"));
        const hasStatus = typeof result.status === "string";
        checks.push({
          name: "result-json-valid",
          passed: hasStatus,
          message: hasStatus
            ? "Valid JSON with status field"
            : "Missing status field",
          severity: "error",
        });

        if (hasStatus) {
          const validStatuses = [
            "DEPLOYED",
            "FAILED",
            "CANCELED",
          ];
          const validStatus = validStatuses.includes(result.status);
          checks.push({
            name: "result-json-status",
            passed: validStatus,
            message: `status="${result.status}"`,
            severity: "error",
          });
        }
      } catch {
        checks.push({
          name: "result-json-valid",
          passed: false,
          message: "Invalid JSON",
          severity: "error",
        });
      }
    }

    // arena-start.sh
    const startSh = join(workspace, "arena-start.sh");
    if (!existsSync(startSh)) {
      checks.push({
        name: "bootstrap-script-exists",
        passed: false,
        message: "arena-start.sh missing",
        severity: "error",
      });
    } else {
      checks.push({
        name: "bootstrap-script-exists",
        passed: true,
        message: "arena-start.sh found",
        severity: "error",
      });
      const stat = statSync(startSh);
      const isExec = (stat.mode & 0o111) !== 0;
      checks.push({
        name: "bootstrap-script-executable",
        passed: isExec,
        message: isExec ? "Has execute permission" : "Not executable",
        severity: "warning",
      });
    }

    // progress.json (optional but recommended)
    const progressPath = join(workspace, ".arena", "progress.json");
    if (existsSync(progressPath)) {
      try {
        const progress = JSON.parse(readFileSync(progressPath, "utf-8"));
        const hasState = typeof progress.state === "string";
        checks.push({
          name: "progress-json-format",
          passed: hasState,
          message: hasState
            ? `Valid progress format (state="${progress.state}")`
            : "Missing state field",
          severity: "warning",
        });

        if (hasState) {
          const validStates = [
            "planning", "coding", "testing", "deploying",
            "verification", "completed", "idle",
            "paused_budget", "paused_rate_limit", "paused_infra", "paused_manual",
            "error",
          ];
          const knownState = validStates.includes(progress.state);
          checks.push({
            name: "progress-json-state",
            passed: knownState,
            message: knownState
              ? `state="${progress.state}"`
              : `Unknown state="${progress.state}" (expected one of: ${validStates.join(", ")})`,
            severity: "warning",
          });
        }
      } catch {
        checks.push({
          name: "progress-json-format",
          passed: false,
          message: "Invalid JSON",
          severity: "warning",
        });
      }
    }

    // .arena/ cleanliness — no loop-internal files
    const arenaFiles = readdirSync(join(workspace, ".arena"));
    const contractFiles = new Set([
      "result.json",
      "start.sh",
      "progress.json",
      "stop-request.json",
      "outgoing-events.json",
      "events.json",
      "platform.md",
      "ralph.config.json",
      "auth.json",
      "auth-refresh.json",
      "assets-manifest.json",
      "spec-input.json",
    ]);
    const foreignFiles = arenaFiles.filter((f) => !contractFiles.has(f));
    checks.push({
      name: "arena-clean",
      passed: foreignFiles.length === 0,
      message: foreignFiles.length
        ? `Foreign files: ${foreignFiles.join(", ")}`
        : "Clean",
      severity: "warning",
    });

    // events.json not modified (read-only for loops)
    const eventsPath = join(workspace, ".arena", "events.json");
    if (existsSync(eventsPath)) {
      const content = readFileSync(eventsPath, "utf-8");
      checks.push({
        name: "events-json-readonly",
        passed: content === "[]",
        message: content === "[]" ? "Not modified" : "Modified by loop",
        severity: "warning",
      });
    }

    // git commits (sandbox has 2 setup commits; loop should add ≥1)
    try {
      const log = execSync("git log --oneline", {
        cwd: workspace,
        encoding: "utf-8",
      });
      const commitCount = log.trim().split("\n").length;
      checks.push({
        name: "git-has-commits",
        passed: commitCount > 2,
        message: `${commitCount} total commits (${commitCount - 2} from loop)`,
        severity: "warning",
      });
    } catch {
      checks.push({
        name: "git-has-commits",
        passed: false,
        message: "git log failed",
        severity: "warning",
      });
    }

    // loop-internal state directory (should be .{loop-name}/, not in .arena/)
    const hiddenDirs = readdirSync(workspace)
      .filter((f) =>
        f.startsWith(".") &&
        f !== ".arena" &&
        f !== ".git" &&
        f !== ".gitkeep" &&
        f !== ".gitignore" &&
        f !== ".env.arena-secrets",
      )
      .filter((f) => statSync(join(workspace, f)).isDirectory());
    if (hiddenDirs.length > 0) {
      checks.push({
        name: "loop-state-dir",
        passed: true,
        message: `Loop state dir(s): ${hiddenDirs.join(", ")}`,
        severity: "warning",
      });
    }

    // exit code (timeout + graceful SIGTERM shutdown = acceptable for long-running loops)
    checks.push({
      name: "exit-code-zero",
      passed: exitCode === 0 || timedOut,
      message: timedOut
        ? `Timed out (${timeout}ms), SIGTERM sent, exit ${exitCode}`
        : `exit ${exitCode}`,
      severity: "error",
    });

    // ── 5. Detect capabilities ──────────────────────────────────────
    const capabilities: string[] = [];
    if (existsSync(progressPath)) capabilities.push("progress");
    if (existsSync(join(workspace, ".arena", "outgoing-events.json")))
      capabilities.push("community_qa");
    if (existsSync(startSh)) capabilities.push("preview");

    return {
      passed: checks
        .filter((c) => c.severity === "error")
        .every((c) => c.passed),
      checks,
      detectedCapabilities: capabilities,
    };
  } finally {
    // ── 6. Cleanup ──────────────────────────────────────────────────
    if (cleanup) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

import { describe, test, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runComplianceTest } from "./test-harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runnerRoot = join(__dirname, "..", "..");
const repoRoot = join(runnerRoot, "..", "..");

// ── Mock agent test — works everywhere ──────────────────────────────
const mockAgentPath = join(__dirname, "mock-agent.sh");

describe("compliance harness", () => {
  test(
    "mock agent passes compliance",
    async () => {
      const result = await runComplianceTest(
        `bash ${mockAgentPath} {workdir}`,
        { timeout: 30_000 },
      );

      // All error-severity checks must pass
      for (const check of result.checks.filter(
        (c) => c.severity === "error",
      )) {
        expect(check.passed, `${check.name}: ${check.message}`).toBe(true);
      }

      expect(result.passed).toBe(true);
      expect(result.detectedCapabilities).toContain("preview");
    },
    60_000,
  );

  // ── Dummy cycle test — requires compiled dist + Linux (setsid) ────
  const dummyPath = join(runnerRoot, "dist", "cycles", "dummy.js");
  const hasDummy = existsSync(dummyPath);
  const hasSetsid = (() => {
    try {
      execSync("which setsid", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!hasDummy || !hasSetsid)(
    "dummy cycle passes compliance",
    async () => {
      const result = await runComplianceTest(
        `node ${dummyPath} --work-dir {workdir}`,
        { timeout: 60_000 },
      );

      expect(result.passed).toBe(true);
      expect(result.detectedCapabilities).toContain("preview");
    },
    120_000,
  );

  // ── Ralph loop test — requires compiled ralph + mock-claude in PATH ──
  const ralphDist = join(repoRoot, "packages", "loops", "ralph-runtime", "dist", "index.js");
  const mockClaudePath = join(__dirname, "mock-claude.sh");
  const hasRalph = existsSync(ralphDist);
  const hasMockClaude = existsSync(mockClaudePath);

  test.skipIf(!hasRalph || !hasMockClaude)(
    "ralph loop passes compliance (mock claude)",
    async () => {
      // Create temp symlink: /tmp/claude -> mock-claude.sh
      const symlinkPath = "/tmp/compliance-claude";
      try {
        execSync(`rm -f ${symlinkPath} /tmp/claude`, { stdio: "pipe" });
      } catch { /* ignore */ }
      execSync(`ln -sf ${mockClaudePath} ${symlinkPath}`, { stdio: "pipe" });
      execSync(`ln -sf ${symlinkPath} /tmp/claude`, { stdio: "pipe" });

      // Write ralph config limiting iterations (mock agent can't complete tasks)
      const configPath = "/tmp/ralph-compliance-config.json";
      writeFileSync(
        configPath,
        JSON.stringify({
          maxIterations: 1,
          controller: { enabled: false },
          autoCommit: true,
          autoPush: false,
          verbose: true,
        }),
      );

      try {
        const result = await runComplianceTest(
          `PATH=/tmp:$PATH node ${ralphDist} run --work-dir {workdir} --spec {specfile} --agent claude-code --config ${configPath}`,
          { timeout: 120_000 },
        );

        // Log all check results for diagnostics
        for (const c of result.checks) {
          console.log(
            `${c.passed ? "\u2705" : "\u274C"} ${c.name}: ${c.message}`,
          );
        }
        console.log(`Capabilities: ${result.detectedCapabilities.join(", ")}`);

        expect(result.passed).toBe(true);
        expect(result.detectedCapabilities).toContain("preview");
      } finally {
        try {
          execSync("rm -f /tmp/claude /tmp/compliance-claude", {
            stdio: "pipe",
          });
        } catch { /* ignore */ }
      }
    },
    180_000,
  );
});

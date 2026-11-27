/**
 * CLI entry point for loop compliance testing (RA-196)
 *
 * Usage:
 *   node dist/compliance/run.js --loop-command "node /path/to/loop/dist/index.js run --agent {agent} --spec {specfile} --work-dir {workdir}"
 *
 * Placeholders {agent}, {specfile}, {specdir}, {workdir} are interpolated
 * by the harness with sandbox paths.
 */

import { runComplianceTest } from "./test-harness.js";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function printUsage() {
  console.error(
    "Usage: npm run compliance -- --loop-command <command> [--json]\n",
  );
  console.error("Placeholders: {agent}, {specfile}, {specdir}, {workdir}");
  console.error(
    "Example: --loop-command 'node dist/cycles/dummy.js --work-dir {workdir}'",
  );
}

async function main() {
  const loopCommand = getArg("loop-command");
  const jsonOutput = hasFlag("json");

  if (!loopCommand) {
    if (jsonOutput) {
      process.stdout.write(
        JSON.stringify({
          passed: false,
          checks: [],
          detectedCapabilities: [],
          error: "Missing --loop-command",
        }),
      );
      process.exitCode = 1;
      return;
    }
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runComplianceTest(loopCommand);

    if (jsonOutput) {
      process.stdout.write(JSON.stringify(result));
    } else {
      console.log("Loop Compliance Test");
      console.log("====================\n");

      for (const check of result.checks) {
        const icon = check.passed ? "\u2705" : "\u274C";
        console.log(`${icon} ${check.name.padEnd(24)} ${check.message}`);
      }

      const errorCount = result.checks.filter(
        (c) => c.severity === "error" && !c.passed,
      ).length;
      const warnCount = result.checks.filter(
        (c) => c.severity === "warning" && !c.passed,
      ).length;
      const total = result.checks.length;
      const passedCount = result.checks.filter((c) => c.passed).length;

      console.log("");
      console.log(
        `Result: ${passedCount}/${total} passed` +
          (errorCount
            ? ` (${errorCount} error${errorCount > 1 ? "s" : ""})`
            : "") +
          (warnCount
            ? ` (${warnCount} warning${warnCount > 1 ? "s" : ""})`
            : ""),
      );

      if (result.detectedCapabilities.length) {
        console.log(
          `Detected capabilities: ${result.detectedCapabilities.join(", ")}`,
        );
      }
    }

    process.exitCode = result.passed ? 0 : 1;
  } catch (error: any) {
    const message = error?.message ?? String(error);
    if (jsonOutput) {
      process.stdout.write(
        JSON.stringify({
          passed: false,
          checks: [],
          detectedCapabilities: [],
          error: message,
        }),
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

await main();

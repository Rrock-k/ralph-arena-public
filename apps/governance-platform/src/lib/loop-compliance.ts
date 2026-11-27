import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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

export interface ComplianceRunnerMeta {
  command: string;
  runnerRoot: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  parseError: string | null;
}

export interface ComplianceRecord extends ComplianceResult {
  runner: ComplianceRunnerMeta;
}

export interface RunLoopComplianceOptions {
  timeoutMs?: number;
}

function resolveRunnerRoot(): string {
  if (process.env.ARENA_RUNNER_ROOT) {
    return path.resolve(process.env.ARENA_RUNNER_ROOT);
  }

  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, "services", "arena-runner", "package.json");
    if (existsSync(candidate)) {
      return path.join(dir, "services", "arena-runner");
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(process.cwd(), "..", "..", "services", "arena-runner");
}

function makeFailureRecord(
  command: string,
  runnerRoot: string,
  meta: Partial<ComplianceRunnerMeta> & Pick<ComplianceRunnerMeta, "exitCode" | "signal" | "timedOut" | "stdout" | "stderr">,
  message: string,
): ComplianceRecord {
  return {
    passed: false,
    checks: [
      {
        name: "runner-execution",
        passed: false,
        message,
        severity: "error",
      },
    ],
    detectedCapabilities: [],
    runner: {
      command,
      runnerRoot,
      exitCode: meta.exitCode,
      signal: meta.signal,
      timedOut: meta.timedOut,
      stdout: meta.stdout,
      stderr: meta.stderr,
      parseError: meta.parseError ?? null,
    },
  };
}

export async function runLoopCompliance(
  loopCommand: string,
  options: RunLoopComplianceOptions = {},
): Promise<ComplianceRecord> {
  const runnerRoot = resolveRunnerRoot();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const args = [
    "--silent",
    "--prefix",
    runnerRoot,
    "run",
    "compliance",
    "--",
    "--json",
    "--loop-command",
    loopCommand,
  ];

  const child = spawn("npm", args, {
    env: {
      ...process.env,
      CI: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  }).catch((error: any) => {
    return { code: null, signal: null, error };
  });

  if ("error" in exit) {
    return makeFailureRecord(
      loopCommand,
      runnerRoot,
      {
        exitCode: null,
        signal: null,
        timedOut,
        stdout,
        stderr,
        parseError: null,
      },
      exit.error?.message ?? String(exit.error),
    );
  }

  const rawOutput = stdout.trim();
  let parsed: ComplianceResult | null = null;
  let parseError: string | null = null;

  if (rawOutput) {
    try {
      parsed = JSON.parse(rawOutput) as ComplianceResult;
    } catch (error: any) {
      parseError = error?.message ?? String(error);
    }
  } else {
    parseError = "Runner did not produce JSON output";
  }

  if (!parsed) {
    return makeFailureRecord(
      loopCommand,
      runnerRoot,
      {
        exitCode: exit.code,
        signal: exit.signal,
        timedOut,
        stdout,
        stderr,
        parseError,
      },
      parseError ?? "Unable to parse compliance output",
    );
  }

  return {
    ...parsed,
    runner: {
      command: loopCommand,
      runnerRoot,
      exitCode: exit.code,
      signal: exit.signal,
      timedOut,
      stdout,
      stderr,
      parseError,
    },
  };
}

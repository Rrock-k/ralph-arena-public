import type { WorkerResourcePressure } from "@arena/contracts";

export type DockerResourceSample = {
  memoryUsageBytes?: number | null;
  memoryLimitBytes?: number | null;
  pidsCurrent?: number | null;
};

export type WorkerResourcePressureConfig = {
  memoryThresholdRatio: number;
  pidPressureThreshold: number | null;
  capturedAt?: string;
};

export type UnavailableWorkerResourcePressure = WorkerResourcePressure & {
  error: string;
};

const DEFAULT_MEMORY_THRESHOLD_RATIO = 0.9;

export function readWorkerResourcePressureConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerResourcePressureConfig {
  return {
    memoryThresholdRatio: readBoundedRatio(
      env.WORKER_MEMORY_PRESSURE_THRESHOLD_RATIO,
      DEFAULT_MEMORY_THRESHOLD_RATIO,
    ),
    pidPressureThreshold: readPositiveInteger(env.WORKER_PID_PRESSURE_MAX),
  };
}

export function summarizeWorkerResourcePressure(
  samples: DockerResourceSample[],
  config: WorkerResourcePressureConfig,
  options: { runningContainerCount?: number } = {},
): WorkerResourcePressure {
  const memoryUsageBytes = sumFinite(samples.map((sample) => sample.memoryUsageBytes));
  const memoryLimitBytes = maxFinite(samples.map((sample) => sample.memoryLimitBytes));
  const pidsCurrent = sumFinite(samples.map((sample) => sample.pidsCurrent));
  const memoryUsageRatio = memoryUsageBytes != null && memoryLimitBytes != null && memoryLimitBytes > 0
    ? memoryUsageBytes / memoryLimitBytes
    : null;

  const reasons: string[] = [];
  if (
    memoryUsageRatio != null &&
    memoryUsageRatio >= config.memoryThresholdRatio
  ) {
    reasons.push("memory_pressure");
  }
  if (
    config.pidPressureThreshold != null &&
    pidsCurrent != null &&
    pidsCurrent >= config.pidPressureThreshold
  ) {
    reasons.push("pid_pressure");
  }

  return {
    capturedAt: config.capturedAt ?? new Date().toISOString(),
    constrained: reasons.length > 0,
    reasons,
    memory: {
      usageBytes: memoryUsageBytes,
      limitBytes: memoryLimitBytes,
      usageRatio: memoryUsageRatio,
      thresholdRatio: config.memoryThresholdRatio,
    },
    pids: {
      current: pidsCurrent,
      threshold: config.pidPressureThreshold,
    },
    containers: {
      sampled: samples.length,
      running: options.runningContainerCount ?? samples.length,
    },
  };
}

export function buildUnavailableWorkerResourcePressure(
  error: string,
  options: { runningContainerCount?: number; capturedAt?: string } = {},
): UnavailableWorkerResourcePressure {
  return {
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    constrained: true,
    reasons: ["resource_pressure_unavailable"],
    memory: {
      usageBytes: null,
      limitBytes: null,
      usageRatio: null,
    },
    pids: {
      current: null,
    },
    containers: {
      sampled: 0,
      running: options.runningContainerCount ?? 0,
    },
    error,
  };
}

export function calculateResourceAwareClaimCapacity(input: {
  activeContainerCount: number;
  maxConcurrentRuns: number;
  resourcePressure?: Pick<WorkerResourcePressure, "constrained"> | null;
}): number {
  if (
    input.resourcePressure?.constrained
    && !isUnavailableResourcePressure(input.resourcePressure)
  ) {
    return 0;
  }
  return Math.max(input.maxConcurrentRuns - input.activeContainerCount, 0);
}

function isUnavailableResourcePressure(
  resourcePressure: Pick<WorkerResourcePressure, "constrained">,
): boolean {
  const reasons = "reasons" in resourcePressure ? resourcePressure.reasons : undefined;
  return Array.isArray(reasons) && reasons.includes("resource_pressure_unavailable");
}

function readBoundedRatio(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback;
  return parsed;
}

function readPositiveInteger(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function sumFinite(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let found = false;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    total += value;
    found = true;
  }
  return found ? total : null;
}

function maxFinite(values: Array<number | null | undefined>): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    max = max == null ? value : Math.max(max, value);
  }
  return max;
}

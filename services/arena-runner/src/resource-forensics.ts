import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PauseReason, TerminalForensics, TerminalStatus, WorkerResourcePressure } from "@arena/contracts";

export type ChildExitSnapshot = {
  exitCode: number;
  signal?: string | null;
  lastProgressState?: string | null;
};

export type ResourceKilledTerminalReport = {
  terminalState: TerminalStatus;
  pauseReason: PauseReason;
  reasonCode: string;
  reasonMessage: string;
  forensics: TerminalForensics;
};

export function isResourceKilledExit(exit: Pick<ChildExitSnapshot, "exitCode" | "signal">): boolean {
  return exit.exitCode === 137 || exit.signal === "SIGKILL";
}

export function buildResourceKilledTerminalReport(
  exit: ChildExitSnapshot,
  options: { cgroupRoot?: string; capturedAt?: string; workspaceStatusPreview?: string | null } = {},
): ResourceKilledTerminalReport | null {
  if (!isResourceKilledExit(exit)) return null;

  return {
    terminalState: "CANCELED",
    pauseReason: "INFRA",
    reasonCode: "resource_killed",
    reasonMessage: buildResourceKilledReasonMessage(options.workspaceStatusPreview),
    forensics: buildTerminalForensics(exit, options),
  };
}

function buildResourceKilledReasonMessage(workspaceStatusPreview?: string | null): string {
  const base = "Agent loop process was killed by SIGKILL/exit 137 before writing result.json.";
  if (!workspaceStatusPreview?.trim()) return base;
  return `${base} Workspace has interrupted WIP: ${workspaceStatusPreview.trim()}.`;
}

export function buildTerminalForensics(
  exit: ChildExitSnapshot,
  options: { cgroupRoot?: string; capturedAt?: string } = {},
): TerminalForensics {
  const cgroupRoot = options.cgroupRoot ?? "/sys/fs/cgroup";
  const cgroupMemoryEvents = readCgroupMemoryEvents(cgroupRoot);
  const resourcePressure = buildCgroupResourcePressure(cgroupRoot, cgroupMemoryEvents, options.capturedAt);

  return {
    exitCode: exit.exitCode,
    signal: exit.signal ?? null,
    lastProgressState: exit.lastProgressState ?? null,
    ...(Object.keys(cgroupMemoryEvents).length > 0 ? { cgroupMemoryEvents } : {}),
    resourcePressure,
  };
}

export function readCgroupMemoryEvents(cgroupRoot = "/sys/fs/cgroup"): Record<string, number> {
  const raw = readFirstExistingText([
    join(cgroupRoot, "memory.events"),
    join(cgroupRoot, "memory", "memory.events"),
  ]);
  if (!raw) return {};

  const events: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const [key, value] = line.trim().split(/\s+/);
    if (!key || value == null) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      events[key] = parsed;
    }
  }
  return events;
}

function buildCgroupResourcePressure(
  cgroupRoot: string,
  memoryEvents: Record<string, number>,
  capturedAt?: string,
): WorkerResourcePressure {
  const memoryUsageBytes = readFirstExistingCgroupNumber([
    join(cgroupRoot, "memory.current"),
    join(cgroupRoot, "memory", "memory.usage_in_bytes"),
  ]);
  const memoryLimitBytes = readFirstExistingCgroupNumber([
    join(cgroupRoot, "memory.max"),
    join(cgroupRoot, "memory", "memory.limit_in_bytes"),
  ]);
  const pidsCurrent = readFirstExistingCgroupNumber([
    join(cgroupRoot, "pids.current"),
    join(cgroupRoot, "pids", "pids.current"),
  ]);
  const pidsLimit = readFirstExistingCgroupNumber([
    join(cgroupRoot, "pids.max"),
    join(cgroupRoot, "pids", "pids.max"),
  ]);

  const reasons = resourcePressureReasons(memoryEvents, pidsCurrent, pidsLimit);
  const memoryRatio = memoryUsageBytes != null && memoryLimitBytes != null && memoryLimitBytes > 0
    ? memoryUsageBytes / memoryLimitBytes
    : null;

  return {
    capturedAt: capturedAt ?? new Date().toISOString(),
    constrained: reasons.length > 0,
    reasons,
    memory: {
      usageBytes: memoryUsageBytes,
      limitBytes: memoryLimitBytes,
      usageRatio: memoryRatio,
    },
    pids: {
      current: pidsCurrent,
      limit: pidsLimit,
    },
  };
}

function resourcePressureReasons(
  memoryEvents: Record<string, number>,
  pidsCurrent: number | null,
  pidsLimit: number | null,
): string[] {
  const reasons: string[] = [];
  if ((memoryEvents.oom_kill ?? 0) > 0) {
    reasons.push("cgroup_oom_kill");
  } else if ((memoryEvents.oom ?? 0) > 0) {
    reasons.push("cgroup_oom");
  } else if ((memoryEvents.max ?? 0) > 0) {
    reasons.push("cgroup_memory_max");
  }

  if (
    pidsCurrent != null &&
    pidsLimit != null &&
    pidsLimit > 0 &&
    pidsCurrent / pidsLimit >= 0.9
  ) {
    reasons.push("cgroup_pid_pressure");
  }

  return reasons;
}

function readFirstExistingCgroupNumber(paths: string[]): number | null {
  const raw = readFirstExistingText(paths);
  if (raw == null) return null;
  const value = raw.trim();
  if (!value || value === "max") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readFirstExistingText(paths: string[]): string | null {
  for (const filePath of paths) {
    try {
      if (existsSync(filePath)) {
        return readFileSync(filePath, "utf8");
      }
    } catch {
      // Missing or unreadable cgroup files are diagnostic gaps, not runner failures.
    }
  }
  return null;
}

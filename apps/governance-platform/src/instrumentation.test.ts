import { describe, expect, it, vi } from "vitest";

import {
  buildInstrumentedMaintenanceSchedules,
  INSTRUMENTED_CRON_SCHEDULES,
  recordScheduledRunTick,
  resolveCronBaseUrl,
  resolveInstrumentedScheduler,
} from "./instrumentation";

describe("resolveCronBaseUrl", () => {
  it("prefers PORT over APP_PORT for the current Next.js server", () => {
    expect(resolveCronBaseUrl({
      PORT: "3010",
      APP_PORT: "3000",
    } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3010");
  });

  it("falls back to APP_PORT when PORT is missing", () => {
    expect(resolveCronBaseUrl({
      APP_PORT: "3000",
    } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });

  it("defaults to port 3000 when no port env is set", () => {
    expect(resolveCronBaseUrl({} as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });

  it("keeps local schedules mapped to MaintenanceItem cron keys", () => {
    expect(INSTRUMENTED_CRON_SCHEDULES.map((cron) => cron.key)).toEqual([
      "cron:seasons",
      "cron:provisioner",
      "cron:reaper",
      "cron:budget",
      "cron:auto-retry",
      "cron:cleanup",
    ]);
  });

  it("records scheduled ticks through the maintenance ledger boundary", async () => {
    const recorder = vi.fn(async () => ({ success: true }));

    await recordScheduledRunTick({
      key: "cron:provisioner",
      label: "provisioner",
      intervalMs: 10_000,
    }, recorder);

    expect(recorder).toHaveBeenCalledWith({
      key: "cron:provisioner",
      label: "provisioner",
      intervalMs: 10_000,
    });
  });

  it("warns when the maintenance ledger rejects a scheduled tick", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const recorder = vi.fn(async () => ({
      success: false,
      error: "Maintenance item is disabled: cron:auto-retry",
    }));

    try {
      await recordScheduledRunTick({
        key: "cron:auto-retry",
        label: "auto-retry",
        intervalMs: 30_000,
      }, recorder);
      expect(warnSpy).toHaveBeenCalledWith(
        "[cron] Failed to record scheduled run for auto-retry:",
        "Maintenance item is disabled: cron:auto-retry",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn when the ledger explicitly skips an already-running scheduled tick", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const recorder = vi.fn(async () => ({
      success: true,
      skipped: true,
      reason: "already_running",
    }));

    try {
      await recordScheduledRunTick({
        key: "cron:provisioner",
        label: "provisioner",
        intervalMs: 10_000,
      }, recorder);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("schedules automated DB backups every 6 hours by default", () => {
    expect(buildInstrumentedMaintenanceSchedules({} as NodeJS.ProcessEnv)).toEqual([
      {
        key: "maintenance:db-backup",
        label: "db-backup",
        intervalMs: 21_600_000,
        initialDelayMs: 300_000,
      },
    ]);
  });

  it("runs in-process scheduled jobs only for the active governance scheduler role", () => {
    expect(resolveInstrumentedScheduler({ GOVERNANCE_SCHEDULER_ROLE: "active" }).enabled).toBe(true);
    expect(resolveInstrumentedScheduler({ GOVERNANCE_SCHEDULER_ROLE: "standby" }).enabled).toBe(false);
    expect(resolveInstrumentedScheduler({ GOVERNANCE_SCHEDULER_ROLE: "external" }).enabled).toBe(false);
    expect(resolveInstrumentedScheduler({}).enabled).toBe(false);
  });
});

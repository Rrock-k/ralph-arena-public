import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJob: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    maintenanceItem: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    maintenanceRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  buildMaintenanceItemDefinitions,
  executeDbBackupMaintenanceJob,
  executeRunLogHeartbeatCompactionMaintenanceJob,
  recordScheduledMaintenanceRun,
  runMaintenanceItemNow,
} from "./maintenance-jobs";

describe("maintenance jobs registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma));
    vi.mocked((prisma as any).$queryRawUnsafe).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceRun.findMany).mockResolvedValue([]);
  });

  it("keeps code-owned instrumentation schedules separate from legacy CronJob.intervalMin", () => {
    const definitions = buildMaintenanceItemDefinitions([
      {
        id: "legacy-provisioner",
        name: "provisioner",
        description: "legacy row should not own the hardcoded schedule",
        endpoint: "/api/cron/provisioner",
        intervalMin: 999,
        enabled: true,
        lastRunAt: null,
        lastResult: null,
      },
      {
        id: "cron-qa-feedback",
        name: "qa-feedback",
        description: "QA feedback",
        endpoint: "/api/cron/qa-feedback",
        intervalMin: 360,
        enabled: false,
        lastRunAt: null,
        lastResult: null,
      },
    ]);

    expect(definitions.find((item) => item.key === "cron:provisioner")).toEqual(
      expect.objectContaining({
        scheduleOwner: "code",
        schedule: "every 10s via apps/governance-platform/src/instrumentation.ts",
      }),
    );
    expect(definitions.find((item) => item.key === "cron:qa-feedback")).toEqual(
      expect.objectContaining({
        scheduleOwner: "disabled",
        schedule: "every 360m via CronJob.intervalMin",
      }),
    );
  });

  it("marks DB backup as unwired when runtime dependencies are missing", () => {
    const definitions = buildMaintenanceItemDefinitions([], {
      ...process.env,
      ARENA_DB_BACKUP_ROOT: "",
      ARENA_DB_BACKUP_PG_DUMP_BIN: "missing-ra304-pg-dump",
      ARENA_DB_BACKUP_PG_RESTORE_BIN: "missing-ra304-pg-restore",
    });

    const backup = definitions.find((item) => item.key === "maintenance:db-backup");
    expect(backup).toEqual(expect.objectContaining({
      allowRunNow: false,
      scheduleOwner: "manual",
    }));
    expect(backup?.metadata).toEqual(expect.objectContaining({
      availability: expect.objectContaining({
        available: false,
        unavailableReasons: expect.arrayContaining([
          "ARENA_DB_BACKUP_ROOT_missing",
          "pg_dump_missing",
          "pg_restore_missing",
        ]),
      }),
    }));
  });

  it("exposes RunLog heartbeat compaction as a manual maintenance item", () => {
    const definitions = buildMaintenanceItemDefinitions([], {
      ...process.env,
      ARENA_RUNLOG_HEARTBEAT_RETENTION_DAYS: "9",
      ARENA_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE: "1234",
      ARENA_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN: "17",
    });

    expect(definitions.find((item) => item.key === "maintenance:runlog-heartbeat-compaction")).toEqual(
      expect.objectContaining({
        scheduleOwner: "manual",
        allowRunNow: true,
        executorType: "fixed_runlog_heartbeat_compaction",
        executorConfig: expect.objectContaining({
          retentionDays: 9,
          batchSize: 1234,
          maxBatchesPerRun: 17,
          maxRowsPerRun: 20978,
          events: ["HEARTBEAT", "PROGRESS_HEARTBEAT"],
        }),
        metadata: expect.objectContaining({
          retentionPolicy: expect.objectContaining({
            keepRecentForDays: 9,
            maxBatchesPerRun: 17,
            maxRowsPerRun: 20978,
            liveHeartbeatTruth: "ProjectComponent.lastHeartbeat",
          }),
        }),
      }),
    );
  });

  it("records malformed cron JSON as a failed append-only run", async () => {
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.upsert).mockResolvedValue({});
    vi.mocked((prisma as any).maintenanceRun.findFirst).mockResolvedValue(null);
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:budget",
      name: "budget",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/budget" },
    });
    vi.mocked((prisma as any).maintenanceRun.create).mockResolvedValue({ id: "run-1" });
    vi.mocked((prisma as any).maintenanceRun.update).mockResolvedValue({
      id: "run-1",
      status: "FAILED",
    });
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "not-json",
    })));

    const result = await runMaintenanceItemNow("cron:budget", {
      actorType: "user",
      actorId: "user-1",
      actorCapability: "platform.runtime.manage",
    });

    expect(result.success).toBe(false);
    expect((prisma as any).maintenanceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "item-1",
        status: "STARTED",
        actorCapability: "platform.runtime.manage",
      }),
    });
    expect((prisma as any).maintenanceRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "budget returned malformed JSON",
      }),
    });
  });

  it("does not fall back from CRON_SECRET to RUNNER_WEBHOOK_SECRET for run-now", async () => {
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.upsert).mockResolvedValue({});
    vi.mocked((prisma as any).maintenanceRun.findFirst).mockResolvedValue(null);
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:cleanup",
      name: "cleanup",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/cleanup" },
    });
    vi.mocked((prisma as any).maintenanceRun.create).mockResolvedValue({ id: "run-1" });
    vi.mocked((prisma as any).maintenanceRun.update).mockResolvedValue({
      id: "run-1",
      status: "SUCCEEDED",
    });
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("RUNNER_WEBHOOK_SECRET", "runner-secret");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await runMaintenanceItemNow("cron:cleanup");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/cron/cleanup");
    expect(init?.headers).toEqual({});
  });

  it("uses the internal governance URL for cron execution instead of public NEXTAUTH_URL", async () => {
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.upsert).mockResolvedValue({});
    vi.mocked((prisma as any).maintenanceRun.findFirst).mockResolvedValue(null);
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:budget",
      name: "budget",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/budget" },
    });
    vi.mocked((prisma as any).maintenanceRun.create).mockResolvedValue({ id: "run-1" });
    vi.mocked((prisma as any).maintenanceRun.update).mockResolvedValue({
      id: "run-1",
      status: "SUCCEEDED",
    });
    vi.stubEnv("GOVERNANCE_INTERNAL_URL", "http://governance-platform:3000");
    vi.stubEnv("NEXTAUTH_URL", "https://app.arena.example.test");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await runMaintenanceItemNow("cron:budget");

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://governance-platform:3000/api/cron/budget");
  });

  it("records scheduled cron calls into MaintenanceRun without resyncing existing registry rows", async () => {
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:provisioner",
      name: "provisioner",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/provisioner" },
    });
    vi.mocked((prisma as any).maintenanceRun.findFirst).mockResolvedValue(null);
    vi.mocked((prisma as any).maintenanceRun.create).mockResolvedValue({ id: "run-1" });
    vi.mocked((prisma as any).maintenanceRun.update).mockResolvedValue({
      id: "run-1",
      status: "SUCCEEDED",
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    })));

    const result = await recordScheduledMaintenanceRun("cron:provisioner");

    expect(result.success).toBe(true);
    expect((prisma as any).cronJob.findMany).not.toHaveBeenCalled();
    expect((prisma as any).$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      [
        "WITH maintenance_lock AS (",
        "  SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)",
        ")",
        "SELECT 1::integer AS locked FROM maintenance_lock",
      ].join("\n"),
      344,
      "item-1",
    );
    expect((prisma as any).$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      'SELECT id FROM "MaintenanceItem" WHERE id = $1 FOR UPDATE',
      "item-1",
    );
    expect((prisma as any).maintenanceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "item-1",
        trigger: "schedule",
        actorType: "cron",
        actorId: "cron:provisioner",
        status: "STARTED",
      }),
    });
  });

  it("skips scheduled ticks while a fresh STARTED run owns the item lease", async () => {
    const startedAt = new Date();
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:provisioner",
      name: "provisioner",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/provisioner" },
    });
    vi.mocked((prisma as any).maintenanceRun.findMany).mockResolvedValue([
      {
        id: "run-active",
        startedAt,
        trigger: "schedule",
        actorType: "cron",
        actorId: "cron:provisioner",
      },
    ]);

    const result = await recordScheduledMaintenanceRun("cron:provisioner");

    expect(result).toEqual(expect.objectContaining({
      success: true,
      skipped: true,
      reason: "already_running",
    }));
    expect(result.run).toEqual(expect.objectContaining({
      id: "run-active",
      status: "STARTED",
    }));
    expect((prisma as any).maintenanceRun.create).not.toHaveBeenCalled();
  });

  it("skips scheduled jobs that already ran inside the minimum interval", async () => {
    const startedAt = new Date();
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "maintenance:db-backup",
      name: "DB backup",
      enabled: true,
      allowRunNow: true,
      executorType: "fixed_db_backup",
      executorConfig: {},
    });
    vi.mocked((prisma as any).maintenanceRun.findFirst).mockResolvedValue({
      id: "run-recent",
      status: "SUCCEEDED",
      startedAt,
      finishedAt: startedAt,
      summary: "recent backup",
    });

    const result = await recordScheduledMaintenanceRun("maintenance:db-backup", {
      minIntervalMs: 6 * 60 * 60_000,
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      skipped: true,
      reason: "not_due",
    }));
    expect((prisma as any).maintenanceRun.create).not.toHaveBeenCalled();
  });

  it("blocks a new run when the same item already has a STARTED run", async () => {
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.upsert).mockResolvedValue({});
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "maintenance:db-backup",
      name: "DB backup",
      enabled: true,
      allowRunNow: true,
      executorType: "fixed_db_backup",
      executorConfig: {},
    });
    vi.mocked((prisma as any).maintenanceRun.findMany).mockResolvedValue([
      {
        id: "run-active",
        startedAt: new Date(),
        trigger: "manual",
        actorType: "user",
        actorId: "user-1",
      },
    ]);

    const result = await runMaintenanceItemNow("maintenance:db-backup");

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: "Maintenance item already has a STARTED run: maintenance:db-backup",
    }));
    expect((prisma as any).maintenanceRun.create).not.toHaveBeenCalled();
  });

  it("fails abandoned STARTED runs before recording the next run", async () => {
    vi.mocked((prisma as any).cronJob.findMany).mockResolvedValue([]);
    vi.mocked((prisma as any).maintenanceItem.upsert).mockResolvedValue({});
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:auto-retry",
      name: "auto-retry",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/auto-retry" },
    });
    vi.mocked((prisma as any).maintenanceRun.findMany).mockResolvedValue([
      {
        id: "run-stale-newer",
        startedAt: new Date("2026-05-17T18:01:00.000Z"),
        trigger: "schedule",
        actorType: "cron",
        actorId: "cron:auto-retry",
      },
      {
        id: "run-stale-older",
        startedAt: new Date("2026-05-17T18:00:00.000Z"),
        trigger: "schedule",
        actorType: "cron",
        actorId: "cron:auto-retry",
      },
    ]);
    vi.mocked((prisma as any).maintenanceRun.create).mockResolvedValue({ id: "run-new" });
    vi.mocked((prisma as any).maintenanceRun.update)
      .mockResolvedValueOnce({ id: "run-stale-older", status: "FAILED" })
      .mockResolvedValueOnce({ id: "run-stale-newer", status: "FAILED" })
      .mockResolvedValueOnce({ id: "run-new", status: "SUCCEEDED" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ retried: 1 }),
    })));

    const result = await recordScheduledMaintenanceRun("cron:auto-retry");

    expect(result.success).toBe(true);
    expect((prisma as any).maintenanceRun.update).toHaveBeenNthCalledWith(1, {
      where: { id: "run-stale-older" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Maintenance run superseded by a newer STARTED ledger lease",
        result: expect.objectContaining({
          recoveredBy: "duplicate_started_run_guard",
          itemKey: "cron:auto-retry",
          keptRunId: "run-stale-newer",
        }),
      }),
    });
    expect((prisma as any).maintenanceRun.update).toHaveBeenNthCalledWith(2, {
      where: { id: "run-stale-newer" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Maintenance run abandoned before completion",
        result: expect.objectContaining({
          recoveredBy: "stale_started_run_guard",
          itemKey: "cron:auto-retry",
        }),
      }),
    });
    expect((prisma as any).maintenanceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "item-1",
        trigger: "schedule",
        status: "STARTED",
      }),
    });
  });

  it("collapses duplicate fresh STARTED rows to one scheduled lease without starting another run", async () => {
    const now = Date.now();
    vi.mocked((prisma as any).maintenanceItem.findUnique).mockResolvedValue({
      id: "item-1",
      key: "cron:provisioner",
      name: "provisioner",
      enabled: true,
      allowRunNow: true,
      executorType: "http_cron",
      executorConfig: { endpoint: "/api/cron/provisioner" },
    });
    vi.mocked((prisma as any).maintenanceRun.findMany).mockResolvedValue([
      {
        id: "run-newer",
        startedAt: new Date(now),
        trigger: "schedule",
        actorType: "cron",
        actorId: "cron:provisioner",
      },
      {
        id: "run-older",
        startedAt: new Date(now - 1_000),
        trigger: "schedule",
        actorType: "cron",
        actorId: "cron:provisioner",
      },
    ]);
    vi.mocked((prisma as any).maintenanceRun.update).mockResolvedValue({
      id: "run-older",
      status: "FAILED",
    });

    const result = await recordScheduledMaintenanceRun("cron:provisioner");

    expect(result).toEqual(expect.objectContaining({
      success: true,
      skipped: true,
      reason: "already_running",
    }));
    expect((prisma as any).maintenanceRun.update).toHaveBeenCalledWith({
      where: { id: "run-older" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Maintenance run superseded by a newer STARTED ledger lease",
        result: expect.objectContaining({
          recoveredBy: "duplicate_started_run_guard",
          itemKey: "cron:provisioner",
          keptRunId: "run-newer",
        }),
      }),
    });
    expect((prisma as any).maintenanceRun.create).not.toHaveBeenCalled();
  });
});

describe("DB backup maintenance executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires an explicit ARENA_DB_BACKUP_ROOT", async () => {
    await expect(executeDbBackupMaintenanceJob({
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ralph:secret@postgres:5432/ralph_arena",
        ARENA_DB_BACKUP_ROOT: "",
      },
    })).rejects.toThrow("ARENA_DB_BACKUP_ROOT must be set");
  });

  it("creates a custom dump through a fixed pg_dump/pg_restore boundary with redacted args", async () => {
    const backupRoot = mkdtempSync(path.join(os.tmpdir(), "ra304-db-backup-"));
    const dumpCalls: any[] = [];
    const result = await executeDbBackupMaintenanceJob({
      now: new Date("2026-05-17T18:45:30.000Z"),
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ralph:super-secret@postgres:5432/ralph_arena",
        ARENA_DB_BACKUP_ROOT: backupRoot,
      },
      dumpDatabase: async (ctx) => {
        dumpCalls.push(ctx);
        writeFileSync(ctx.outputPath, "custom dump bytes");
      },
      verifyDump: async () => ({ entries: 12 }),
    });

    expect(dumpCalls[0]).toEqual(expect.objectContaining({
      command: "pg_dump",
      args: expect.arrayContaining([
        "--format=custom",
        "--file",
        path.join(backupRoot, "ralph_arena_20260517T184530Z.dump.tmp"),
        "--host",
        "postgres",
        "--username",
        "ralph",
        "--dbname",
        "ralph_arena",
      ]),
    }));
    expect(result.summary).toBe("DB custom dump created and verified with pg_restore --list");
    expect(result.result).toEqual(expect.objectContaining({
      path: path.join(backupRoot, "ralph_arena_20260517T184530Z.dump"),
      verification: expect.objectContaining({
        restoreCheck: expect.objectContaining({
          status: "passed",
          kind: "pg_restore_list",
          entries: 12,
        }),
      }),
    }));
    expect(JSON.stringify(result.result)).not.toContain("super-secret");
  });

  it("keeps short-lived, daily, weekly and monthly backup tiers while pruning older duplicates", async () => {
    const backupRoot = mkdtempSync(path.join(os.tmpdir(), "ra304-db-backup-retention-"));
    for (const stamp of [
      "20260517T120000Z",
      "20260516T120000Z",
      "20260510T120000Z",
      "20260510T060000Z",
      "20260420T120000Z",
      "20260421T120000Z",
      "20260201T120000Z",
      "20260201T060000Z",
      "20251001T120000Z",
    ]) {
      writeFileSync(path.join(backupRoot, `ralph_arena_${stamp}.dump`), "old dump bytes");
    }

    const result = await executeDbBackupMaintenanceJob({
      now: new Date("2026-05-18T12:00:00.000Z"),
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ralph:super-secret@postgres:5432/ralph_arena",
        ARENA_DB_BACKUP_ROOT: backupRoot,
      },
      dumpDatabase: async (ctx) => {
        writeFileSync(ctx.outputPath, "custom dump bytes");
      },
      verifyDump: async () => ({ entries: 12 }),
    });

    const files = readdirSync(backupRoot).sort();
    expect(files).toContain("ralph_arena_20260518T120000Z.dump");
    expect(files).toContain("ralph_arena_20260510T120000Z.dump");
    expect(files).not.toContain("ralph_arena_20260510T060000Z.dump");
    expect(files).not.toContain("ralph_arena_20260420T120000Z.dump");
    expect(files).toContain("ralph_arena_20260421T120000Z.dump");
    expect(files).toContain("ralph_arena_20260201T120000Z.dump");
    expect(files).not.toContain("ralph_arena_20260201T060000Z.dump");
    expect(files).not.toContain("ralph_arena_20251001T120000Z.dump");
    expect(result.result).toEqual(expect.objectContaining({
      retention: expect.objectContaining({
        policy: expect.objectContaining({
          keepAllForHours: 48,
          keepDailyForDays: 14,
          keepWeeklyForWeeks: 8,
          keepMonthlyForMonths: 6,
        }),
        deleted: expect.arrayContaining([
          "ralph_arena_20260510T060000Z.dump",
          "ralph_arena_20260420T120000Z.dump",
          "ralph_arena_20260201T060000Z.dump",
          "ralph_arena_20251001T120000Z.dump",
        ]),
      }),
    }));
  });
});

describe("RunLog heartbeat compaction maintenance executor", () => {
  it("deletes only stale heartbeat rows in bounded batches", async () => {
    const rows = new Map([
      ["old-heartbeat", {
        id: "old-heartbeat",
        event: "HEARTBEAT",
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
      }],
      ["old-progress-heartbeat", {
        id: "old-progress-heartbeat",
        event: "PROGRESS_HEARTBEAT",
        createdAt: new Date("2026-05-10T00:01:00.000Z"),
      }],
      ["new-heartbeat", {
        id: "new-heartbeat",
        event: "HEARTBEAT",
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
      }],
      ["old-transition", {
        id: "old-transition",
        event: "RUNTIME_OBSERVED",
        createdAt: new Date("2026-05-10T00:02:00.000Z"),
      }],
    ]);
    const db = {
      runLog: {
        findMany: vi.fn(async (args: {
          where: { event: { in: string[] }; createdAt: { lt: Date } };
          orderBy: Array<{ event: "asc" } | { createdAt: "asc" }>;
          take: number;
        }) => (
          [...rows.values()]
            .filter((row) => (
              args.where.event.in.includes(row.event) &&
              row.createdAt.getTime() < args.where.createdAt.lt.getTime()
            ))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, args.take)
            .map((row) => ({ id: row.id }))
        )),
        deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
          let count = 0;
          for (const id of args.where.id.in) {
            if (rows.delete(id)) count += 1;
          }
          return { count };
        }),
      },
    };

    const result = await executeRunLogHeartbeatCompactionMaintenanceJob({
      db: db as never,
      now: new Date("2026-05-23T00:00:00.000Z"),
      retentionDays: 7,
      batchSize: 1,
    });

    expect(result.summary).toBe("RunLog heartbeat compaction deleted 2 stale heartbeat row(s)");
    expect(result.result).toEqual(expect.objectContaining({
      deletedRows: 2,
      batches: 2,
      cutoff: "2026-05-16T00:00:00.000Z",
      events: ["HEARTBEAT", "PROGRESS_HEARTBEAT"],
      liveHeartbeatTruth: "ProjectComponent.lastHeartbeat",
    }));
    expect([...rows.keys()].sort()).toEqual(["new-heartbeat", "old-transition"]);
    expect(db.runLog.findMany).toHaveBeenCalledTimes(3);
    expect(db.runLog.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [{ event: "asc" }, { createdAt: "asc" }],
    }));
    expect(db.runLog.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("stops a run when maxBatchesPerRun is reached", async () => {
    const rows = new Map([
      ["old-heartbeat-1", {
        id: "old-heartbeat-1",
        event: "HEARTBEAT",
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
      }],
      ["old-heartbeat-2", {
        id: "old-heartbeat-2",
        event: "HEARTBEAT",
        createdAt: new Date("2026-05-10T00:01:00.000Z"),
      }],
      ["old-heartbeat-3", {
        id: "old-heartbeat-3",
        event: "HEARTBEAT",
        createdAt: new Date("2026-05-10T00:02:00.000Z"),
      }],
    ]);
    const db = {
      runLog: {
        findMany: vi.fn(async (args: {
          where: { event: { in: string[] }; createdAt: { lt: Date } };
          orderBy: Array<{ event: "asc" } | { createdAt: "asc" }>;
          take: number;
        }) => (
          [...rows.values()]
            .filter((row) => (
              args.where.event.in.includes(row.event) &&
              row.createdAt.getTime() < args.where.createdAt.lt.getTime()
            ))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, args.take)
            .map((row) => ({ id: row.id }))
        )),
        deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
          let count = 0;
          for (const id of args.where.id.in) {
            if (rows.delete(id)) count += 1;
          }
          return { count };
        }),
      },
    };

    const result = await executeRunLogHeartbeatCompactionMaintenanceJob({
      db: db as never,
      now: new Date("2026-05-23T00:00:00.000Z"),
      retentionDays: 7,
      batchSize: 1,
      maxBatchesPerRun: 2,
    });

    expect(result.summary).toBe(
      "RunLog heartbeat compaction deleted 2 stale heartbeat row(s); stopped after maxBatchesPerRun=2",
    );
    expect(result.result).toEqual(expect.objectContaining({
      deletedRows: 2,
      batches: 2,
      maxBatchesPerRun: 2,
      maxRowsPerRun: 2,
      maxBatchesPerRunReached: true,
      continuation: "rerun_manual_compaction_to_continue_if_stale_rows_remain",
    }));
    expect([...rows.keys()]).toEqual(["old-heartbeat-3"]);
    expect(db.runLog.findMany).toHaveBeenCalledTimes(2);
    expect(db.runLog.deleteMany).toHaveBeenCalledTimes(2);
  });
});

import "server-only";

import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type {
  AdminJobItem,
  AdminJobRun,
  AdminJobRunStatus,
  AdminJobsData,
  AdminJobStatus,
} from "@/lib/admin-jobs-types";

export type MaintenanceItemKind = "cron" | "maintenance" | "codex_automation";
export type MaintenanceOwner = "arena_code" | "arena_db" | "external_codex" | "manual";
export type MaintenanceScheduleOwner = "code" | "db" | "external" | "disabled" | "manual";
export type MaintenanceExecutorType =
  | "http_cron"
  | "fixed_db_backup"
  | "fixed_runlog_heartbeat_compaction"
  | "codex_automation";
export type MaintenanceRunTrigger = "manual" | "schedule" | "system";
export type MaintenanceRunStatus = "STARTED" | "SUCCEEDED" | "FAILED";

type JsonObject = Record<string, unknown>;

type LegacyCronJob = {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  intervalMin: number;
  enabled: boolean;
  lastRunAt: Date | null;
  lastResult: string | null;
};

type MaintenanceItemDefinition = {
  key: string;
  kind: MaintenanceItemKind;
  name: string;
  description?: string | null;
  owner: MaintenanceOwner;
  scheduleOwner: MaintenanceScheduleOwner;
  schedule?: string | null;
  enabled: boolean;
  allowRunNow: boolean;
  executorType: MaintenanceExecutorType;
  executorKey: string;
  executorConfig: JsonObject;
  metadata?: JsonObject | null;
};

type RunActor = {
  actorType?: "user" | "system" | "cron";
  actorId?: string | null;
  actorCapability?: string | null;
};

type MaintenanceRunResult = {
  summary: string;
  result: JsonObject;
};

type MaintenanceRunStartResult =
  | {
      started: true;
      run: { id: string };
      startedAt: Date;
    }
  | {
      started: false;
      success: true;
      skipped: true;
      reason: "already_running";
      activeRun: MaintenanceRunLease;
      run: MaintenanceRunLease & { status: "STARTED" };
    }
  | {
      started: false;
      success: false;
      error: string;
      activeRun?: MaintenanceRunLease;
    };

type MaintenanceRunLease = {
  id: string;
  startedAt: Date | string | null;
  trigger?: string | null;
  actorType?: string | null;
  actorId?: string | null;
};

type DumpDatabaseContext = {
  command: string;
  args: string[];
  outputPath: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
};

type DbBackupOptions = {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  backupRoot?: string;
  dumpDatabase?: (ctx: DumpDatabaseContext) => Promise<void>;
  verifyDump?: (ctx: { command: string; args: string[]; timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<{ entries: number }>;
};

type ScheduledRunOptions = {
  minIntervalMs?: number;
};

type RunLogHeartbeatCompactionDb = {
  runLog: {
    findMany: (args: {
      where: {
        event: { in: string[] };
        createdAt: { lt: Date };
      };
      select: { id: true };
      orderBy: Array<{ event: "asc" } | { createdAt: "asc" }>;
      take: number;
    }) => Promise<Array<{ id: string }>>;
    deleteMany: (args: {
      where: { id: { in: string[] } };
    }) => Promise<{ count: number }>;
  };
};

type RunLogHeartbeatCompactionOptions = {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  db?: RunLogHeartbeatCompactionDb;
  retentionDays?: number;
  batchSize?: number;
  maxBatchesPerRun?: number;
};

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_BACKUP_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_DB_BACKUP_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_STALE_STARTED_RUN_MS = 5 * 60_000;
const DEFAULT_DB_BACKUP_RETENTION = {
  keepAllForHours: 48,
  keepDailyForDays: 14,
  keepWeeklyForWeeks: 8,
  keepMonthlyForMonths: 6,
};
const DEFAULT_RUNLOG_HEARTBEAT_RETENTION_DAYS = 7;
const DEFAULT_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE = 10_000;
const DEFAULT_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN = 25;
const MAINTENANCE_RUN_ADVISORY_LOCK_NAMESPACE = 344;
const RUNLOG_HEARTBEAT_COMPACTION_EVENTS = ["HEARTBEAT", "PROGRESS_HEARTBEAT"] as const;

const REGISTERED_CRON_ENDPOINTS: Array<{
  name: string;
  description: string;
  endpoint: string;
  scheduleOwner: MaintenanceScheduleOwner;
  schedule: string | null;
  enabled: boolean;
  legacyCronJobName?: string;
}> = [
  {
    name: "seasons",
    description: "Season phase transitions.",
    endpoint: "/api/cron/seasons",
    scheduleOwner: "code",
    schedule: "every 60s via apps/governance-platform/src/instrumentation.ts",
    enabled: true,
  },
  {
    name: "provisioner",
    description: "Provision queued runtime infrastructure.",
    endpoint: "/api/cron/provisioner",
    scheduleOwner: "code",
    schedule: "every 10s via apps/governance-platform/src/instrumentation.ts",
    enabled: true,
  },
  {
    name: "reaper",
    description: "Detect stale runtime work and converge runtime rows.",
    endpoint: "/api/cron/reaper",
    scheduleOwner: "code",
    schedule: "every 60s via apps/governance-platform/src/instrumentation.ts",
    enabled: true,
  },
  {
    name: "budget",
    description: "Pause and resume projects from budget truth.",
    endpoint: "/api/cron/budget",
    scheduleOwner: "code",
    schedule: "every 30s via apps/governance-platform/src/instrumentation.ts",
    enabled: true,
  },
  {
    name: "auto-retry",
    description: "Resume retryable blocker rows after retryAt.",
    endpoint: "/api/cron/auto-retry",
    scheduleOwner: "code",
    schedule: "every 30s via apps/governance-platform/src/instrumentation.ts",
    enabled: true,
  },
  {
    name: "cleanup",
    description: "Cleanup orphaned infrastructure side effects.",
    endpoint: "/api/cron/cleanup",
    scheduleOwner: "code",
    schedule: "every 5m via apps/governance-platform/src/instrumentation.ts",
    enabled: true,
  },
  {
    name: "qa-feedback",
    description: "Batch accumulated QA test results for loop pickup.",
    endpoint: "/api/cron/qa-feedback",
    scheduleOwner: "db",
    schedule: null,
    enabled: false,
    legacyCronJobName: "qa-feedback",
  },
  {
    name: "blocked-maintenance",
    description: "Resident runtime blocked-window maintenance lane.",
    endpoint: "/api/cron/blocked-maintenance",
    scheduleOwner: "manual",
    schedule: "manual/operator invocation only in this slice",
    enabled: true,
  },
];

class MaintenanceExecutorError extends Error {
  summary: string;
  result?: JsonObject;

  constructor(summary: string, message: string, result?: JsonObject) {
    super(message);
    this.name = "MaintenanceExecutorError";
    this.summary = summary;
    this.result = result;
  }
}

export function buildMaintenanceItemDefinitions(
  legacyCronJobs: LegacyCronJob[] = [],
  env: NodeJS.ProcessEnv = process.env,
): MaintenanceItemDefinition[] {
  const legacyByName = new Map(legacyCronJobs.map((job) => [job.name, job]));
  const seenLegacyNames = new Set<string>();

  const cronDefinitions = REGISTERED_CRON_ENDPOINTS.map((endpoint) => {
    const legacy = endpoint.legacyCronJobName
      ? legacyByName.get(endpoint.legacyCronJobName)
      : legacyByName.get(endpoint.name);
    if (legacy) seenLegacyNames.add(legacy.name);

    const usesLegacySchedule = endpoint.scheduleOwner === "db";
    const enabled = usesLegacySchedule
      ? legacy?.enabled ?? endpoint.enabled
      : endpoint.enabled;
    const schedule = usesLegacySchedule
      ? formatLegacyCronSchedule(legacy)
      : endpoint.schedule;
    const scheduleOwner = usesLegacySchedule && !enabled
      ? "disabled"
      : endpoint.scheduleOwner;

    return cronEndpointDefinition(endpoint, {
      enabled,
      schedule,
      scheduleOwner,
      legacy,
    });
  });

  const legacyOnlyDefinitions = legacyCronJobs
    .filter((job) => !seenLegacyNames.has(job.name))
    .map(legacyCronJobDefinition);

  return [
    ...cronDefinitions,
    ...legacyOnlyDefinitions,
    buildDbBackupItemDefinition(env),
    buildRunLogHeartbeatCompactionItemDefinition(env),
  ];
}

export async function syncMaintenanceRegistry() {
  const legacyCronJobs = await (prisma as any).cronJob.findMany({
    orderBy: { name: "asc" },
  });
  const definitions = buildMaintenanceItemDefinitions(legacyCronJobs, process.env);

  await Promise.all(definitions.map((definition) => (
    (prisma as any).maintenanceItem.upsert({
      where: { key: definition.key },
      create: definition,
      update: {
        kind: definition.kind,
        name: definition.name,
        description: definition.description ?? null,
        owner: definition.owner,
        scheduleOwner: definition.scheduleOwner,
        schedule: definition.schedule ?? null,
        enabled: definition.enabled,
        allowRunNow: definition.allowRunNow,
        executorType: definition.executorType,
        executorKey: definition.executorKey,
        executorConfig: definition.executorConfig,
        metadata: definition.metadata ?? null,
      },
    })
  )));

  return definitions;
}

export async function listMaintenanceJobs() {
  await syncMaintenanceRegistry();

  const items = await (prisma as any).maintenanceItem.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        take: 20,
      },
    },
  });

  return items.map((item: any) => ({
    ...item,
    lastRun: item.runs?.[0] ?? null,
  }));
}

export async function getAdminJobsData(): Promise<AdminJobsData> {
  await syncMaintenanceRegistry();

  const items = await (prisma as any).maintenanceItem.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        take: 20,
      },
    },
  });

  return {
    cron: items
      .filter((item: any) => item.kind === "cron")
      .map(adminJobItemFromMaintenanceItem),
    maintenance: items
      .filter((item: any) => item.kind !== "cron")
      .map(adminJobItemFromMaintenanceItem),
  };
}

export async function runMaintenanceItemNow(
  key: string,
  actor: RunActor = {},
) {
  await syncMaintenanceRegistry();

  const item = await (prisma as any).maintenanceItem.findUnique({
    where: { key },
  });
  if (!item) {
    return { success: false, error: `Maintenance item not found: ${key}` };
  }
  if (!item.enabled) {
    return { success: false, error: `Maintenance item is disabled: ${key}` };
  }
  if (!item.allowRunNow) {
    return { success: false, error: `Run now is not allowed for: ${key}` };
  }

  return recordMaintenanceRun(item, {
    trigger: "manual",
    actorType: actor.actorType ?? "user",
    actorId: actor.actorId ?? null,
    actorCapability: actor.actorCapability ?? null,
  });
}

export async function recordScheduledMaintenanceRun(
  key: string,
  options: ScheduledRunOptions = {},
) {
  let item = await (prisma as any).maintenanceItem.findUnique({
    where: { key },
  });
  if (!item) {
    await syncMaintenanceRegistry();
    item = await (prisma as any).maintenanceItem.findUnique({
      where: { key },
    });
  }
  if (!item) {
    return { success: false, error: `Maintenance item not found: ${key}` };
  }
  if (!item.enabled) {
    return { success: false, error: `Maintenance item is disabled: ${key}` };
  }
  if (options.minIntervalMs && options.minIntervalMs > 0) {
    const recentRun = await findRecentRun(item.id, options.minIntervalMs);
    if (recentRun) {
      return {
        success: true,
        skipped: true,
        reason: "not_due",
        run: recentRun,
      };
    }
  }

  return recordMaintenanceRun(item, {
    trigger: "schedule",
    actorType: "cron",
    actorId: key,
    actorCapability: null,
  });
}

export async function executeDbBackupMaintenanceJob(
  options: DbBackupOptions = {},
): Promise<MaintenanceRunResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const configuredBackupRoot = options.backupRoot ?? env.ARENA_DB_BACKUP_ROOT;
  if (!configuredBackupRoot?.trim()) {
    throw new MaintenanceExecutorError(
      "DB backup root is not configured",
      "ARENA_DB_BACKUP_ROOT must be set to an explicit mounted backup directory",
    );
  }

  const database = parseDatabaseUrl(env.DATABASE_URL);
  const backupRoot = path.resolve(configuredBackupRoot);
  const stamp = formatBackupTimestamp(now);
  const fileName = `ralph_arena_${stamp}.dump`;
  const outputPath = path.join(backupRoot, fileName);
  const tmpPath = `${outputPath}.tmp`;
  const dumpCommand = env.ARENA_DB_BACKUP_PG_DUMP_BIN || "pg_dump";
  const restoreCommand = env.ARENA_DB_BACKUP_PG_RESTORE_BIN || "pg_restore";
  const dumpArgs = buildPgDumpArgs(database, tmpPath);
  const verifyArgs = ["--list", outputPath];
  const timeoutMs = readPositiveInt(env.ARENA_DB_BACKUP_TIMEOUT_MS, DEFAULT_BACKUP_TIMEOUT_MS);
  const processEnv = buildPostgresProcessEnv(env, database);

  mkdirSync(backupRoot, { recursive: true });
  rmSync(tmpPath, { force: true });

  try {
    await (options.dumpDatabase ?? dumpDatabaseWithFixedPgDump)({
      command: dumpCommand,
      args: dumpArgs,
      outputPath: tmpPath,
      timeoutMs,
      env: processEnv,
    });

    renameSync(tmpPath, outputPath);
    const stats = statSync(outputPath);
    const restoreVerification = await (options.verifyDump ?? verifyDumpWithPgRestore)({
      command: restoreCommand,
      args: verifyArgs,
      timeoutMs,
      env: processEnv,
    });
    const retention = applyDbBackupRetention({
      backupRoot,
      now,
      currentOutputPath: outputPath,
      env,
    });
    const checks = [
      { name: "file_exists", status: "passed" },
      { name: "size_gt_zero", status: stats.size > 0 ? "passed" : "failed" },
      { name: "pg_restore_list", status: restoreVerification.entries > 0 ? "passed" : "failed" },
    ];
    const verificationStatus = checks.every((check) => check.status === "passed")
      ? "restore_metadata_verified"
      : "failed";

    if (verificationStatus === "failed") {
      throw new MaintenanceExecutorError(
        "DB dump failed verification",
        "DB dump file did not pass local dump-file checks",
        {
          path: outputPath,
          sizeBytes: stats.size,
          verification: {
            status: verificationStatus,
            checks,
            restoreCheck: {
              status: "failed",
              kind: "pg_restore_list",
              entries: restoreVerification.entries,
            },
          },
        },
      );
    }

    return {
      summary: "DB custom dump created and verified with pg_restore --list",
      result: {
        path: outputPath,
        sizeBytes: stats.size,
        fileName,
        backupRoot,
        backupRootSource: options.backupRoot ? "option" : "ARENA_DB_BACKUP_ROOT",
        database: {
          host: database.host,
          port: database.port,
          name: database.database,
          user: database.user,
        },
        fixedExecutor: {
          command: dumpCommand,
          args: redactProcessArgs(dumpArgs),
          verifyCommand: restoreCommand,
          verifyArgs,
          timeoutMs,
        },
        verification: {
          status: verificationStatus,
          checks,
          restoreCheck: {
            status: "passed",
            kind: "pg_restore_list",
            entries: restoreVerification.entries,
          },
        },
        retention,
      },
    };
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

export async function executeRunLogHeartbeatCompactionMaintenanceJob(
  options: RunLogHeartbeatCompactionOptions = {},
): Promise<MaintenanceRunResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays
    ?? readPositiveInt(env.ARENA_RUNLOG_HEARTBEAT_RETENTION_DAYS, DEFAULT_RUNLOG_HEARTBEAT_RETENTION_DAYS);
  const batchSize = options.batchSize
    ?? readPositiveInt(env.ARENA_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE, DEFAULT_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE);
  const maxBatchesPerRun = options.maxBatchesPerRun
    ?? readPositiveInt(
      env.ARENA_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN,
      DEFAULT_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN,
    );
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60_000);
  const db = options.db ?? (prisma as unknown as RunLogHeartbeatCompactionDb);
  let deletedRows = 0;
  let batches = 0;
  let maxBatchesPerRunReached = false;

  for (;;) {
    if (batches >= maxBatchesPerRun) {
      maxBatchesPerRunReached = true;
      break;
    }

    const staleRows = await db.runLog.findMany({
      where: {
        event: { in: [...RUNLOG_HEARTBEAT_COMPACTION_EVENTS] },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: [{ event: "asc" }, { createdAt: "asc" }],
      take: batchSize,
    });

    if (staleRows.length === 0) break;

    const deleted = await db.runLog.deleteMany({
      where: { id: { in: staleRows.map((row) => row.id) } },
    });

    deletedRows += deleted.count;
    batches += 1;

    if (deleted.count === 0) {
      throw new MaintenanceExecutorError(
        "RunLog heartbeat compaction made no progress",
        "RunLog heartbeat compaction selected stale rows but deleted none",
        {
          cutoff: cutoff.toISOString(),
          retentionDays,
          batchSize,
          selectedRows: staleRows.length,
        },
      );
    }
    if (staleRows.length < batchSize) break;
  }

  const limitSummary = maxBatchesPerRunReached
    ? `; stopped after maxBatchesPerRun=${maxBatchesPerRun}`
    : "";

  return {
    summary: `RunLog heartbeat compaction deleted ${deletedRows} stale heartbeat row(s)${limitSummary}`,
    result: {
      deletedRows,
      batches,
      cutoff: cutoff.toISOString(),
      retentionDays,
      batchSize,
      maxBatchesPerRun,
      maxRowsPerRun: batchSize * maxBatchesPerRun,
      maxBatchesPerRunReached,
      continuation: maxBatchesPerRunReached
        ? "rerun_manual_compaction_to_continue_if_stale_rows_remain"
        : "none",
      events: [...RUNLOG_HEARTBEAT_COMPACTION_EVENTS],
      liveHeartbeatTruth: "ProjectComponent.lastHeartbeat",
    },
  };
}

async function findRecentRun(itemId: string, minIntervalMs: number) {
  const threshold = new Date(Date.now() - minIntervalMs);
  return (prisma as any).maintenanceRun.findFirst({
    where: {
      itemId,
      startedAt: { gte: threshold },
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      summary: true,
    },
  });
}

async function recordMaintenanceRun(
  item: any,
  data: {
    trigger: MaintenanceRunTrigger;
    actorType: string;
    actorId: string | null;
    actorCapability: string | null;
  },
) {
  const start = await startMaintenanceRun(item, data);
  if (!start.started) return start;

  const { run, startedAt } = start;

  try {
    const result = await executeMaintenanceItem(item);
    const finishedAt = new Date();
    const updatedRun = await (prisma as any).maintenanceRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        summary: result.summary,
        result: result.result,
        error: null,
      },
    });

    return { success: true, run: updatedRun };
  } catch (error) {
    const finishedAt = new Date();
    const serialized = serializeRunError(error);
    const updatedRun = await (prisma as any).maintenanceRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        summary: serialized.summary,
        result: serialized.result ?? null,
        error: serialized.error,
      },
    });

    return { success: false, error: serialized.error.message, run: updatedRun };
  }
}

async function startMaintenanceRun(
  item: any,
  data: {
    trigger: MaintenanceRunTrigger;
    actorType: string;
    actorId: string | null;
    actorCapability: string | null;
  },
): Promise<MaintenanceRunStartResult> {
  return (prisma as any).$transaction(async (tx: any) => {
    await lockMaintenanceItemForRunStart(tx, item.id);

    const staleStartedRunMs = readPositiveInt(
      process.env.ARENA_MAINTENANCE_STALE_STARTED_MS,
      DEFAULT_STALE_STARTED_RUN_MS,
    );
    const now = new Date();
    const startedRuns: MaintenanceRunLease[] = await tx.maintenanceRun.findMany({
      where: {
        itemId: item.id,
        status: "STARTED",
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        trigger: true,
        actorType: true,
        actorId: true,
      },
    });

    const activeRun = startedRuns[0] ?? null;
    const duplicateRuns = startedRuns.slice(1);
    for (const duplicateRun of duplicateRuns) {
      await failDuplicateStartedRun(tx, item, duplicateRun, now, activeRun?.id ?? null);
    }

    if (activeRun) {
      if (isStaleStartedRun(activeRun, now, staleStartedRunMs)) {
        await failStaleStartedRun(tx, item, activeRun, now, staleStartedRunMs);
      } else {
        return activeRunResult(item, data.trigger, activeRun);
      }
    }

    const startedAt = new Date();
    const run = await tx.maintenanceRun.create({
      data: {
        itemId: item.id,
        trigger: data.trigger,
        actorType: data.actorType,
        actorId: data.actorId,
        actorCapability: data.actorCapability,
        status: "STARTED",
        startedAt,
      },
    });

    return { started: true, run, startedAt };
  });
}

async function lockMaintenanceItemForRunStart(tx: any, itemId: string) {
  // Cross-slot lease: serialize STARTED run creation per maintenance item.
  await tx.$queryRawUnsafe(
    [
      "WITH maintenance_lock AS (",
      "  SELECT pg_advisory_xact_lock($1::integer, hashtext($2)::integer)",
      ")",
      "SELECT 1::integer AS locked FROM maintenance_lock",
    ].join("\n"),
    MAINTENANCE_RUN_ADVISORY_LOCK_NAMESPACE,
    itemId,
  );
  // Keep the item row locked while the existing run ledger is reconciled.
  await tx.$queryRawUnsafe(
    'SELECT id FROM "MaintenanceItem" WHERE id = $1 FOR UPDATE',
    itemId,
  );
}

function activeRunResult(
  item: { key: string },
  trigger: MaintenanceRunTrigger,
  activeRun: MaintenanceRunLease,
): MaintenanceRunStartResult {
  const error = `Maintenance item already has a STARTED run: ${item.key}`;
  if (trigger === "schedule") {
    return {
      started: false,
      success: true,
      skipped: true,
      reason: "already_running",
      activeRun,
      run: { ...activeRun, status: "STARTED" },
    };
  }
  return {
    started: false,
    success: false,
    error,
    activeRun,
  };
}

function isStaleStartedRun(
  run: { startedAt: Date | string | null },
  now: Date,
  staleAfterMs: number,
): boolean {
  if (!run.startedAt) return false;
  const startedAt = run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt);
  const startedAtMs = startedAt.getTime();
  if (!Number.isFinite(startedAtMs)) return false;
  return now.getTime() - startedAtMs >= staleAfterMs;
}

async function failStaleStartedRun(
  db: any,
  item: { id: string; key: string },
  run: MaintenanceRunLease,
  finishedAt: Date,
  staleAfterMs: number,
) {
  const startedAt = run.startedAt instanceof Date
    ? run.startedAt
    : run.startedAt
    ? new Date(run.startedAt)
    : null;
  const durationMs = startedAt && Number.isFinite(startedAt.getTime())
    ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
    : null;

  await db.maintenanceRun.update({
    where: { id: run.id },
    data: {
      status: "FAILED",
      finishedAt,
      durationMs,
      summary: "Maintenance run abandoned before completion",
      result: {
        recoveredBy: "stale_started_run_guard",
        itemKey: item.key,
        staleAfterMs,
        staleRun: {
          id: run.id,
          startedAt: startedAt?.toISOString() ?? null,
          trigger: run.trigger ?? null,
          actorType: run.actorType ?? null,
          actorId: run.actorId ?? null,
        },
      },
      error: {
        message: `Maintenance STARTED run exceeded stale threshold for ${item.key}`,
      },
    },
  });
}

async function failDuplicateStartedRun(
  db: any,
  item: { key: string },
  run: MaintenanceRunLease,
  finishedAt: Date,
  keptRunId: string | null,
) {
  const startedAt = run.startedAt instanceof Date
    ? run.startedAt
    : run.startedAt
    ? new Date(run.startedAt)
    : null;
  const durationMs = startedAt && Number.isFinite(startedAt.getTime())
    ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
    : null;

  await db.maintenanceRun.update({
    where: { id: run.id },
    data: {
      status: "FAILED",
      finishedAt,
      durationMs,
      summary: "Maintenance run superseded by a newer STARTED ledger lease",
      result: {
        recoveredBy: "duplicate_started_run_guard",
        itemKey: item.key,
        keptRunId,
        duplicateRun: {
          id: run.id,
          startedAt: startedAt?.toISOString() ?? null,
          trigger: run.trigger ?? null,
          actorType: run.actorType ?? null,
          actorId: run.actorId ?? null,
        },
      },
      error: {
        message: `Maintenance duplicate STARTED run superseded for ${item.key}`,
      },
    },
  });
}

async function executeMaintenanceItem(item: any): Promise<MaintenanceRunResult> {
  switch (item.executorType as MaintenanceExecutorType) {
    case "http_cron":
      return executeHttpCron(item);
    case "fixed_db_backup":
      return executeDbBackupMaintenanceJob();
    case "fixed_runlog_heartbeat_compaction":
      return executeRunLogHeartbeatCompactionMaintenanceJob();
    case "codex_automation":
      throw new MaintenanceExecutorError(
        "Codex automation has no Arena run reporter",
        "Codex automation run-now is not implemented in Arena yet",
      );
    default:
      throw new MaintenanceExecutorError(
        "Unsupported maintenance executor",
        `Unsupported maintenance executor: ${String(item.executorType)}`,
      );
  }
}

async function executeHttpCron(item: any): Promise<MaintenanceRunResult> {
  const config = normalizeObject(item.executorConfig);
  const endpoint = readRequiredString(config, "endpoint");
  assertCronEndpoint(endpoint);

  const baseUrl = resolveCronBaseUrl();
  const url = new URL(endpoint, baseUrl);
  const headers: Record<string, string> = {};
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret) headers["x-cron-secret"] = cronSecret;

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(readPositiveInt(process.env.ARENA_MAINTENANCE_HTTP_TIMEOUT_MS, DEFAULT_HTTP_TIMEOUT_MS)),
  });
  const text = await res.text();
  const parsedBody = parseRequiredJsonBody(text, item.name, endpoint);
  const result = {
    endpoint,
    httpStatus: res.status,
    ok: res.ok,
    body: parsedBody,
  };

  if (!res.ok) {
    throw new MaintenanceExecutorError(
      `${item.name} returned HTTP ${res.status}`,
      `HTTP cron executor failed with status ${res.status}`,
      result,
    );
  }

  return {
    summary: `${item.name} completed with HTTP ${res.status}`,
    result,
  };
}

function cronEndpointDefinition(
  endpoint: (typeof REGISTERED_CRON_ENDPOINTS)[number],
  options: {
    enabled: boolean;
    schedule: string | null;
    scheduleOwner: MaintenanceScheduleOwner;
    legacy?: LegacyCronJob;
  },
): MaintenanceItemDefinition {
  return {
    key: `cron:${endpoint.name}`,
    kind: "cron",
    name: endpoint.name,
    description: endpoint.legacyCronJobName && options.legacy?.description
      ? options.legacy.description
      : endpoint.description,
    owner: endpoint.scheduleOwner === "db" ? "arena_db" : "arena_code",
    scheduleOwner: options.scheduleOwner,
    schedule: options.schedule,
    enabled: options.enabled,
    allowRunNow: true,
    executorType: "http_cron",
    executorKey: endpoint.endpoint,
    executorConfig: {
      method: "POST",
      endpoint: endpoint.endpoint,
    },
    metadata: {
      source: "static_cron_endpoint_registry",
      runHistoryCoverage: endpoint.scheduleOwner === "code"
        ? "scheduled_and_manual_runs_recorded"
        : "manual_run_now_only",
      legacyCronJob: options.legacy ? legacyCronMetadata(options.legacy) : null,
    },
  };
}

function legacyCronJobDefinition(job: LegacyCronJob): MaintenanceItemDefinition {
  return {
    key: `cron:${job.name}`,
    kind: "cron",
    name: job.name,
    description: job.description,
    owner: "arena_db",
    scheduleOwner: job.enabled ? "db" : "disabled",
    schedule: formatLegacyCronSchedule(job),
    enabled: job.enabled,
    allowRunNow: true,
    executorType: "http_cron",
    executorKey: job.endpoint,
    executorConfig: {
      method: "POST",
      endpoint: job.endpoint,
      legacyCronJobId: job.id,
    },
    metadata: {
      source: "legacy_cron_job",
      runHistoryCoverage: "manual_run_now_only",
      legacyCronJob: legacyCronMetadata(job),
    },
  };
}

function buildDbBackupItemDefinition(env: NodeJS.ProcessEnv): MaintenanceItemDefinition {
  const availability = resolveDbBackupExecutorAvailability(env);
  const intervalMs = readPositiveInt(env.ARENA_DB_BACKUP_INTERVAL_MS, DEFAULT_DB_BACKUP_INTERVAL_MS);
  const retention = readDbBackupRetention(env);

  return {
    key: "maintenance:db-backup",
    kind: "maintenance",
    name: "DB backup",
    description: "Create a local PostgreSQL custom-format dump through a fixed DB backup executor.",
    owner: "arena_code",
    scheduleOwner: availability.available ? "code" : "manual",
    schedule: availability.available
      ? `${formatIntervalLabel(intervalMs)} via apps/governance-platform/src/instrumentation.ts`
      : "manual only until runtime dependencies are wired",
    enabled: true,
    allowRunNow: availability.available,
    executorType: "fixed_db_backup",
    executorKey: "pg_dump:database-url:custom-format",
    executorConfig: {
      command: availability.commands.pgDump.command,
      verifyCommand: availability.commands.pgRestore.command,
      fixedArgs: ["--format=custom", "--no-owner", "--no-acl", "--file", "<output>", "<database>"],
      verifyArgs: ["--list", "<output>"],
      backupRootEnv: "ARENA_DB_BACKUP_ROOT",
      databaseUrlEnv: "DATABASE_URL",
      timeoutMsEnv: "ARENA_DB_BACKUP_TIMEOUT_MS",
      restoreVerification: "pg_restore_list",
      intervalMs,
      retention,
    },
    metadata: {
      requiresExplicitBackupRoot: true,
      availability,
      runHistoryCoverage: availability.available
        ? "scheduled_and_manual_runs_recorded"
        : "not_wired_runtime_dependency_missing",
      reliability: "custom_dump_verified_by_pg_restore_list",
      retentionPolicy: retention,
    },
  };
}

function buildRunLogHeartbeatCompactionItemDefinition(env: NodeJS.ProcessEnv): MaintenanceItemDefinition {
  const retentionDays = readPositiveInt(
    env.ARENA_RUNLOG_HEARTBEAT_RETENTION_DAYS,
    DEFAULT_RUNLOG_HEARTBEAT_RETENTION_DAYS,
  );
  const batchSize = readPositiveInt(
    env.ARENA_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE,
    DEFAULT_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE,
  );
  const maxBatchesPerRun = readPositiveInt(
    env.ARENA_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN,
    DEFAULT_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN,
  );
  const retentionPolicy = {
    keepRecentForDays: retentionDays,
    compactEvents: [...RUNLOG_HEARTBEAT_COMPACTION_EVENTS],
    compactionAction: "delete_stale_heartbeat_rows",
    maxBatchesPerRun,
    maxRowsPerRun: batchSize * maxBatchesPerRun,
    liveHeartbeatTruth: "ProjectComponent.lastHeartbeat",
  };

  return {
    key: "maintenance:runlog-heartbeat-compaction",
    kind: "maintenance",
    name: "RunLog heartbeat compaction",
    description: "Delete stale heartbeat/progress heartbeat RunLog telemetry rows after the short debug window.",
    owner: "arena_code",
    scheduleOwner: "manual",
    schedule: "manual/operator invocation only",
    enabled: true,
    allowRunNow: true,
    executorType: "fixed_runlog_heartbeat_compaction",
    executorKey: "runlog:heartbeat-compaction",
    executorConfig: {
      retentionDaysEnv: "ARENA_RUNLOG_HEARTBEAT_RETENTION_DAYS",
      batchSizeEnv: "ARENA_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE",
      maxBatchesPerRunEnv: "ARENA_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN",
      retentionDays,
      batchSize,
      maxBatchesPerRun,
      maxRowsPerRun: batchSize * maxBatchesPerRun,
      events: [...RUNLOG_HEARTBEAT_COMPACTION_EVENTS],
    },
    metadata: {
      runHistoryCoverage: "manual_runs_recorded",
      retentionPolicy,
    },
  };
}

function legacyCronMetadata(job: LegacyCronJob) {
  return {
    id: job.id,
    intervalMin: job.intervalMin,
    enabled: job.enabled,
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    lastResult: job.lastResult,
  };
}

function formatLegacyCronSchedule(job?: LegacyCronJob) {
  if (!job) return "legacy CronJob row missing";
  return `every ${job.intervalMin}m via CronJob.intervalMin`;
}

function resolveCronBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARENA_INTERNAL_BASE_URL) return env.ARENA_INTERNAL_BASE_URL;
  if (env.GOVERNANCE_INTERNAL_URL) return env.GOVERNANCE_INTERNAL_URL;
  const port = env.PORT || env.APP_PORT || "3000";
  return `http://localhost:${port}`;
}

function adminJobItemFromMaintenanceItem(item: any): AdminJobItem {
  const runs = (item.runs ?? []).map(adminRunFromMaintenanceRun);
  const lane = item.kind === "cron" ? "cron" : "maintenance";

  return {
    id: item.key,
    lane,
    status: adminStatusFromMaintenanceItem(item),
    name: item.name,
    description: item.description,
    type: adminJobType(item.executorType),
    owner: item.owner,
    schedule: item.schedule ?? scheduleLabel(item.scheduleOwner),
    scheduleOwner: item.scheduleOwner,
    lastRun: runs[0] ?? null,
    runs,
    executor: {
      type: item.executorType,
      target: item.executorKey,
      legacyCronJobId: readLegacyCronJobId(item.metadata),
      canRunNow: item.enabled && item.allowRunNow,
    },
    rawConfig: {
      executorConfig: item.executorConfig,
      metadata: item.metadata,
    },
  };
}

function adminRunFromMaintenanceRun(run: any): AdminJobRun {
  return {
    id: run.id,
    startedAt: run.startedAt instanceof Date ? run.startedAt.toISOString() : String(run.startedAt),
    finishedAt: run.finishedAt instanceof Date ? run.finishedAt.toISOString() : run.finishedAt ?? null,
    trigger: run.trigger,
    actor: run.actorId ? `${run.actorType}:${run.actorId}` : run.actorType,
    status: adminRunStatus(run.status),
    durationMs: run.durationMs ?? null,
    summary: run.summary ?? "",
    details: {
      result: run.result ?? null,
      error: run.error ?? null,
      actorCapability: run.actorCapability ?? null,
    },
  };
}

function adminStatusFromMaintenanceItem(item: any): AdminJobStatus {
  if (!item.enabled || item.scheduleOwner === "disabled") return "disabled";
  if (!item.allowRunNow) return "unwired";
  if (item.scheduleOwner === "code" || item.scheduleOwner === "db" || item.scheduleOwner === "external") {
    return "scheduled";
  }
  if (item.scheduleOwner === "manual") {
    return item.allowRunNow ? "manual" : "unwired";
  }
  return "unknown";
}

function adminRunStatus(status: string): AdminJobRunStatus {
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED") return "failed";
  if (status === "STARTED") return "running";
  return "unknown";
}

function adminJobType(executorType: string) {
  if (executorType === "http_cron") return "HTTP cron";
  if (executorType === "fixed_db_backup") return "DB backup";
  if (executorType === "fixed_runlog_heartbeat_compaction") return "RunLog compaction";
  if (executorType === "codex_automation") return "Codex automation";
  return executorType;
}

function scheduleLabel(scheduleOwner: string) {
  if (scheduleOwner === "manual") return "manual";
  if (scheduleOwner === "disabled") return "disabled";
  return "not configured";
}

function readLegacyCronJobId(metadata: unknown) {
  const value = normalizeObject(metadata);
  const legacy = normalizeObject(value.legacyCronJob);
  return typeof legacy.id === "string" ? legacy.id : null;
}

function applyDbBackupRetention(input: {
  backupRoot: string;
  now: Date;
  currentOutputPath: string;
  env: NodeJS.ProcessEnv;
}) {
  const retention = readDbBackupRetention(input.env);
  const candidates = listStandardDbBackups(input.backupRoot)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = new Set<string>([input.currentOutputPath]);
  const nowMs = input.now.getTime();
  const keepAllCutoff = nowMs - retention.keepAllForHours * 60 * 60_000;
  const dailyCutoff = nowMs - retention.keepDailyForDays * 24 * 60 * 60_000;
  const weeklyCutoff = nowMs - retention.keepWeeklyForWeeks * 7 * 24 * 60 * 60_000;
  const monthlyCutoff = addUtcMonths(input.now, -retention.keepMonthlyForMonths).getTime();
  const dailyBuckets = new Set<string>();
  const weeklyBuckets = new Set<string>();
  const monthlyBuckets = new Set<string>();
  const deleted: string[] = [];

  for (const backup of candidates) {
    const createdAt = backup.createdAt.getTime();
    if (createdAt >= keepAllCutoff) {
      keep.add(backup.path);
      continue;
    }
    if (createdAt >= dailyCutoff) {
      const bucket = utcDayBucket(backup.createdAt);
      if (!dailyBuckets.has(bucket)) {
        dailyBuckets.add(bucket);
        keep.add(backup.path);
      }
      continue;
    }
    if (createdAt >= weeklyCutoff) {
      const bucket = utcWeekBucket(backup.createdAt);
      if (!weeklyBuckets.has(bucket)) {
        weeklyBuckets.add(bucket);
        keep.add(backup.path);
      }
      continue;
    }
    if (createdAt >= monthlyCutoff) {
      const bucket = utcMonthBucket(backup.createdAt);
      if (!monthlyBuckets.has(bucket)) {
        monthlyBuckets.add(bucket);
        keep.add(backup.path);
      }
      continue;
    }
  }

  for (const backup of candidates) {
    if (keep.has(backup.path)) continue;
    unlinkSync(backup.path);
    deleted.push(backup.fileName);
  }

  return {
    policy: retention,
    scanned: candidates.length,
    kept: keep.size,
    deleted,
  };
}

function listStandardDbBackups(backupRoot: string) {
  return readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const createdAt = parseStandardBackupTimestamp(entry.name);
      if (!createdAt) return null;
      return {
        fileName: entry.name,
        path: path.join(backupRoot, entry.name),
        createdAt,
      };
    })
    .filter((entry): entry is { fileName: string; path: string; createdAt: Date } => !!entry);
}

function parseStandardBackupTimestamp(fileName: string): Date | null {
  const match = /^ralph_arena_(\d{8}T\d{6}Z)\.dump$/.exec(fileName);
  if (!match) return null;
  const stamp = match[1];
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readDbBackupRetention(env: NodeJS.ProcessEnv) {
  return {
    keepAllForHours: readPositiveInt(env.ARENA_DB_BACKUP_KEEP_ALL_HOURS, DEFAULT_DB_BACKUP_RETENTION.keepAllForHours),
    keepDailyForDays: readPositiveInt(env.ARENA_DB_BACKUP_KEEP_DAILY_DAYS, DEFAULT_DB_BACKUP_RETENTION.keepDailyForDays),
    keepWeeklyForWeeks: readPositiveInt(env.ARENA_DB_BACKUP_KEEP_WEEKLY_WEEKS, DEFAULT_DB_BACKUP_RETENTION.keepWeeklyForWeeks),
    keepMonthlyForMonths: readPositiveInt(env.ARENA_DB_BACKUP_KEEP_MONTHLY_MONTHS, DEFAULT_DB_BACKUP_RETENTION.keepMonthlyForMonths),
  };
}

function formatIntervalLabel(intervalMs: number) {
  const hours = intervalMs / (60 * 60_000);
  if (Number.isInteger(hours) && hours >= 1) return `every ${hours}h`;
  const minutes = intervalMs / 60_000;
  if (Number.isInteger(minutes) && minutes >= 1) return `every ${minutes}m`;
  return `every ${intervalMs}ms`;
}

function utcDayBucket(date: Date) {
  return date.toISOString().slice(0, 10);
}

function utcWeekBucket(date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - weekday + 1);
  return day.toISOString().slice(0, 10);
}

function utcMonthBucket(date: Date) {
  return date.toISOString().slice(0, 7);
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function resolveDbBackupExecutorAvailability(env: NodeJS.ProcessEnv) {
  const backupRootConfigured = !!env.ARENA_DB_BACKUP_ROOT?.trim();
  const pgDump = commandAvailability(env.ARENA_DB_BACKUP_PG_DUMP_BIN || "pg_dump");
  const pgRestore = commandAvailability(env.ARENA_DB_BACKUP_PG_RESTORE_BIN || "pg_restore");
  const unavailableReasons = [
    backupRootConfigured ? null : "ARENA_DB_BACKUP_ROOT_missing",
    pgDump.available ? null : "pg_dump_missing",
    pgRestore.available ? null : "pg_restore_missing",
  ].filter((reason): reason is string => !!reason);

  return {
    available: unavailableReasons.length === 0,
    unavailableReasons,
    backupRootConfigured,
    commands: {
      pgDump,
      pgRestore,
    },
  };
}

function commandAvailability(command: string) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });

  return {
    command,
    available: result.status === 0,
    version: result.status === 0 ? (result.stdout || result.stderr).trim().split("\n")[0] ?? null : null,
  };
}

type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
};

function parseDatabaseUrl(value: string | undefined): DatabaseTarget {
  if (!value?.trim()) {
    throw new MaintenanceExecutorError(
      "Database URL is not configured",
      "DATABASE_URL must be set for the fixed DB backup executor",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MaintenanceExecutorError(
      "Database URL is invalid",
      "DATABASE_URL is not a valid PostgreSQL URL",
    );
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new MaintenanceExecutorError(
      "Database URL is invalid",
      "DATABASE_URL must use the postgresql:// scheme",
    );
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database || !url.username) {
    throw new MaintenanceExecutorError(
      "Database URL is incomplete",
      "DATABASE_URL must include host, database and username",
    );
  }

  return {
    host: url.hostname,
    port: url.port || "5432",
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function buildPgDumpArgs(database: DatabaseTarget, outputPath: string) {
  return [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    outputPath,
    "--host",
    database.host,
    "--port",
    database.port,
    "--username",
    database.user,
    "--dbname",
    database.database,
  ];
}

function buildPostgresProcessEnv(env: NodeJS.ProcessEnv, database: DatabaseTarget) {
  return {
    ...env,
    PGPASSWORD: database.password,
  };
}

async function dumpDatabaseWithFixedPgDump(ctx: DumpDatabaseContext) {
  await runFixedCommand({
    command: ctx.command,
    args: ctx.args,
    timeoutMs: ctx.timeoutMs,
    env: ctx.env,
    failureSummary: "DB dump command failed",
    timeoutSummary: "DB dump timed out",
  });
}

async function verifyDumpWithPgRestore(ctx: {
  command: string;
  args: string[];
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}) {
  const result = await runFixedCommand({
    command: ctx.command,
    args: ctx.args,
    timeoutMs: ctx.timeoutMs,
    env: ctx.env,
    failureSummary: "DB dump restore verification failed",
    timeoutSummary: "DB dump restore verification timed out",
  });
  const entries = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";")).length;
  return { entries };
}

async function runFixedCommand(ctx: {
  command: string;
  args: string[];
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  failureSummary: string;
  timeoutSummary: string;
}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(ctx.command, ctx.args, {
      env: ctx.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      fail(new MaintenanceExecutorError(
        ctx.timeoutSummary,
        `${ctx.command} did not finish within ${ctx.timeoutMs}ms`,
        {
          command: ctx.command,
          args: redactProcessArgs(ctx.args),
        },
      ));
    }, ctx.timeoutMs);

    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    child.on("error", (error) => {
      fail(new MaintenanceExecutorError(
        ctx.failureSummary,
        error.message,
        {
          command: ctx.command,
          args: redactProcessArgs(ctx.args),
        },
      ));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-20_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-20_000);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve({
          stdout,
          stderr: redactProcessOutput(stderr, ctx.env),
        });
        return;
      }
      reject(new MaintenanceExecutorError(
        ctx.failureSummary,
        `${ctx.command} exited with ${exitCode ?? signal ?? "unknown"}`,
        {
          exitCode,
          signal,
          stderr: redactProcessOutput(stderr, ctx.env),
          command: ctx.command,
          args: redactProcessArgs(ctx.args),
        },
      ));
    });
  });
}

function redactProcessArgs(args: string[]) {
  return args.map((arg) => (
    arg.startsWith("postgresql://") || arg.startsWith("postgres://")
      ? "<redacted-database-url>"
      : arg
  ));
}

function redactProcessOutput(output: string, env: NodeJS.ProcessEnv) {
  const secrets = [
    env.DATABASE_URL,
    env.PGPASSWORD,
  ].filter((value): value is string => !!value);

  return secrets.reduce((redacted, secret) => (
    secret ? redacted.split(secret).join("<redacted>") : redacted
  ), output);
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBackupTimestamp(date: Date) {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function parseRequiredJsonBody(text: string, itemName: string, endpoint: string) {
  if (!text) {
    throw new MaintenanceExecutorError(
      `${itemName} returned malformed JSON`,
      `HTTP cron executor returned an empty body for ${endpoint}`,
      { endpoint, bodyPreview: "" },
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MaintenanceExecutorError(
      `${itemName} returned malformed JSON`,
      `HTTP cron executor returned non-JSON for ${endpoint}`,
      { endpoint, bodyPreview: text.slice(0, 500) },
    );
  }
}

function normalizeObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function readRequiredString(value: JsonObject, key: string) {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) {
    throw new MaintenanceExecutorError(
      "Invalid maintenance executor config",
      `Missing executorConfig.${key}`,
    );
  }
  return result;
}

function assertCronEndpoint(endpoint: string) {
  if (!endpoint.startsWith("/api/cron/")) {
    throw new MaintenanceExecutorError(
      "Invalid cron endpoint",
      `Cron executor endpoint must stay under /api/cron: ${endpoint}`,
    );
  }
}

function serializeRunError(error: unknown) {
  if (error instanceof MaintenanceExecutorError) {
    return {
      summary: error.summary,
      result: error.result,
      error: {
        name: error.name,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      summary: error.message,
      error: {
        name: error.name,
        message: error.message,
      },
    };
  }

  return {
    summary: String(error),
    error: {
      name: "UnknownError",
      message: String(error),
    },
  };
}

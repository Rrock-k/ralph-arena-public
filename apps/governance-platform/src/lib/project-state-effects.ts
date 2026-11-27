/**
 * RA-237: Simplified state effect layer.
 *
 * Ownership split:
 *   Governance writes: powerIntent, blockers, archivedAt
 *   Runner/worker writes: runtimeState, agentState, lastOutcome
 *
 * All state mutations go through applyStateChange().
 * RunLog entries are written with structured detail JSON.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { getRetryableBlocker } from "@/lib/retry-backoff";

export type Db = PrismaClient | Prisma.TransactionClient;

// --- Types ---

export type PowerIntent = "ON" | "OFF";
export type RuntimeState = "ABSENT" | "RUNNING" | "STOPPED";
export type AgentState = "IDLE" | "RUNNING";
// Legacy rows may still read back FAILED during cutover, but new writes should not produce it.
export type PersistedAgentState = AgentState | "FAILED";
export type Outcome = "COMPLETED" | "FAILED";

export type PrimaryComponentRow = {
  projectId: string;
  componentId: string;
  powerIntent: PowerIntent;
  agentIntent: string;
  runtimeState: RuntimeState;
  agentState: PersistedAgentState | null;
  blockers: string[];
  lastOutcome: Outcome | null;
  lastOutcomeAt: Date | null;
  retryAt: Date | null;
  previewHealth: string;
  previewCheckedAt: Date | null;
  provisionedAt: Date | null;
  containerName: string | null;
  previewUrl: string | null;
  workerHost: string | null;
  vpsHostId: string | null;
  lastHeartbeat: Date | null;
  retryCount: number;
  archivedAt: Date | null;
  tgSpecLastImportedVersion: number | null;
  sourceConfig: unknown;
};

export type AgentIntent = "ON" | "OFF";

export type StateChange =
  | { type: "power"; intent: PowerIntent; force?: boolean }
  | { type: "agentIntent"; intent: AgentIntent }
  | { type: "runtimeObserved"; state: RuntimeState }
  | { type: "agentTransition"; state: AgentState; outcome?: Outcome }
  | { type: "addBlocker"; blocker: string }
  | { type: "removeBlocker"; blocker: string }
  | { type: "resetOutcome" } // Explicit system/admin operation: clear lastOutcome for relaunch. Not a metadata write.
  | { type: "metadata"; fields: ComponentMetadataUpdate };

export type ComponentMetadataUpdate = {
  provisionedAt?: Date | null;
  containerName?: string | null;
  previewUrl?: string | null;
  previewHealth?: string;
  previewCheckedAt?: Date | null;
  workerHost?: string | null;
  vpsHostId?: string | null;
  lastHeartbeat?: Date | null;
  retryCount?: number;
  retryAt?: Date | null;
  // lastOutcome/lastOutcomeAt NOT here — use { type: "resetOutcome" } or agentTransition with outcome
};

export type ChangeContext = {
  source: "admin" | "runner" | "worker" | "cron" | "system";
  trigger: string;
  reason?: string;
  diagnostics?: Record<string, unknown>;
};

type FreshStartContext = ChangeContext & { source: "system" | "admin" | "cron" };

// --- Read ---

const COMPONENT_SELECT = {
  id: true,
  powerIntent: true,
  agentIntent: true,
  runtimeState: true,
  agentState: true,
  blockers: true,
  lastOutcome: true,
  lastOutcomeAt: true,
  retryAt: true,
  previewHealth: true,
  previewCheckedAt: true,
  provisionedAt: true,
  containerName: true,
  previewUrl: true,
  workerHost: true,
  vpsHostId: true,
  lastHeartbeat: true,
  retryCount: true,
  sourceConfig: true,
} as const;

function toRow(project: {
  id: string;
  archivedAt: Date | null;
  tgSpecLastImportedVersion: number | null;
}, c: Record<string, unknown>): PrimaryComponentRow {
  return {
    projectId: project.id,
    componentId: c.id as string,
    powerIntent: c.powerIntent as PowerIntent,
    agentIntent: (c.agentIntent as string) ?? "ON",
    runtimeState: c.runtimeState as RuntimeState,
    agentState: c.agentState as PersistedAgentState | null,
    blockers: c.blockers as string[],
    lastOutcome: c.lastOutcome as Outcome | null,
    lastOutcomeAt: c.lastOutcomeAt as Date | null,
    retryAt: c.retryAt as Date | null,
    previewHealth: c.previewHealth as string,
    previewCheckedAt: c.previewCheckedAt as Date | null,
    provisionedAt: c.provisionedAt as Date | null,
    containerName: c.containerName as string | null,
    previewUrl: c.previewUrl as string | null,
    workerHost: c.workerHost as string | null,
    vpsHostId: c.vpsHostId as string | null,
    lastHeartbeat: c.lastHeartbeat as Date | null,
    retryCount: c.retryCount as number,
    archivedAt: project.archivedAt,
    tgSpecLastImportedVersion: project.tgSpecLastImportedVersion,
    sourceConfig: c.sourceConfig,
  };
}

export async function getPrimaryComponentRow(db: Db, projectId: string): Promise<PrimaryComponentRow | null> {
  const [project, component] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        archivedAt: true,
        tgSpecLastImportedVersion: true,
      },
    }),
    db.projectComponent.findFirst({
      where: {
        projectId,
        kind: "app",
      },
      orderBy: { createdAt: "asc" },
      select: COMPONENT_SELECT,
    }),
  ]);

  if (!project || !component) return null;
  return toRow(project, component as Record<string, unknown>);
}

export async function requirePrimaryComponentRow(db: Db, projectId: string): Promise<PrimaryComponentRow> {
  const row = await getPrimaryComponentRow(db, projectId);
  if (!row) throw new Error(`Primary app component not found for project ${projectId}`);
  return row;
}

// --- Validate ---

const GOVERNANCE_SOURCES = new Set(["admin", "cron", "system"]);
const RUNNER_SOURCES = new Set(["runner", "worker", "system"]); // "system" = boundary adapter, can write both sides
const RUNNER_HEARTBEAT_TRIGGERS = new Set(["heartbeat", "progress_heartbeat"]);

function updateValue<T extends object, K extends keyof T, F>(
  data: T,
  key: K,
  fallback: F,
): T[K] | F {
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
}

function validateOwnership(change: StateChange, ctx: ChangeContext): void {
  switch (change.type) {
    case "power":
    case "agentIntent":
    case "addBlocker":
    case "removeBlocker":
      if (!GOVERNANCE_SOURCES.has(ctx.source)) {
        throw new Error(`Ownership violation: ${change.type} can only be written by governance (got ${ctx.source})`);
      }
      break;
    case "runtimeObserved":
    case "agentTransition":
      if (!RUNNER_SOURCES.has(ctx.source)) {
        throw new Error(`Ownership violation: ${change.type} can only be written by runner/worker (got ${ctx.source})`);
      }
      break;
    case "resetOutcome":
      // Only admin or system can reset outcome (for relaunch)
      if (ctx.source !== "admin" && ctx.source !== "system") {
        throw new Error(`Ownership violation: resetOutcome can only be done by admin/system (got ${ctx.source})`);
      }
      break;
    case "metadata":
      // Metadata can be written by anyone
      break;
  }
}

function validateChange(row: PrimaryComponentRow, change: StateChange): void {
  switch (change.type) {
    case "power":
      if (
        change.intent === "OFF" &&
        !change.force &&
        row.agentState === "RUNNING" &&
        row.agentIntent !== "OFF"
      ) {
        throw new Error(`Cannot turn off project ${row.projectId}: agent is RUNNING. Use force=true for archive.`);
      }
      break;
    case "agentTransition":
      if (change.state === "RUNNING" && row.runtimeState !== "RUNNING") {
        throw new Error(`Cannot start agent for project ${row.projectId}: runtime is ${row.runtimeState}`);
      }
      if (change.state === "RUNNING" && row.powerIntent !== "ON") {
        throw new Error(`Cannot start agent for project ${row.projectId}: powerIntent is OFF`);
      }
      break;
    case "addBlocker":
      // Adding a blocker is always valid
      break;
    case "removeBlocker":
      // Removing a blocker is always valid (idempotent)
      break;
    case "runtimeObserved":
      // Runner reports are always accepted
      break;
    case "metadata":
      // Metadata updates are always valid
      break;
  }
}

// --- Apply ---

export async function applyStateChange(
  db: Db,
  projectId: string,
  change: StateChange,
  ctx: ChangeContext,
): Promise<PrimaryComponentRow> {
  const row = await requirePrimaryComponentRow(db, projectId);
  validateOwnership(change, ctx);
  validateChange(row, change);

  const data: Prisma.ProjectComponentUpdateInput = {};
  const before = { powerIntent: row.powerIntent, agentIntent: row.agentIntent, runtimeState: row.runtimeState, agentState: row.agentState, blockers: row.blockers, lastOutcome: row.lastOutcome };

  switch (change.type) {
    case "power":
      data.powerIntent = change.intent;
      break;

    case "agentIntent":
      data.agentIntent = change.intent;
      break;

    case "runtimeObserved":
      data.runtimeState = change.state;
      if (
        change.state === "ABSENT" &&
        row.powerIntent === "OFF" &&
        row.agentIntent === "OFF"
      ) {
        if (row.agentState !== "IDLE") {
          data.agentState = "IDLE";
        }
      }
      if (
        change.state === "ABSENT" &&
        row.powerIntent === "OFF" &&
        row.agentIntent === "OFF" &&
        row.blockers.length === 0
      ) {
        data.retryAt = null;
        data.provisionedAt = null;
      }
      break;

    case "agentTransition": {
      data.agentState = change.state;
      if (change.outcome) {
        data.lastOutcome = change.outcome;
        data.lastOutcomeAt = new Date();
      }
      break;
    }

    case "addBlocker": {
      // RA-237 ownership: governance writes ONLY blockers.
      // Blockers do not create a separate PAUSED agent state anymore.
      // The row remains IDLE/RUNNING; runner status derives stop semantics from blockers.
      const newBlockers = row.blockers.includes(change.blocker)
        ? row.blockers
        : [...row.blockers, change.blocker];
      data.blockers = newBlockers;
      break;
    }

    case "removeBlocker": {
      // RA-237 ownership: governance writes ONLY blockers.
      // Clearing blockers re-opens work through the normal idle/claim/supervisor paths.
      const newBlockers = row.blockers.filter((b) => b !== change.blocker);
      data.blockers = newBlockers;
      break;
    }

    case "resetOutcome": {
      // Explicit admin/system operation for relaunch.
      // Clears lastOutcome so claim can pick up the project for a new run.
      data.lastOutcome = null;
      data.lastOutcomeAt = null;
      break;
    }

    case "metadata":
      Object.assign(data, change.fields);
      break;
  }

  const after = {
    powerIntent: updateValue(data, "powerIntent", row.powerIntent),
    agentIntent: updateValue(data, "agentIntent", row.agentIntent),
    runtimeState: updateValue(data, "runtimeState", row.runtimeState),
    agentState: updateValue(data, "agentState", row.agentState),
    blockers: updateValue(data, "blockers", row.blockers),
    lastOutcome: updateValue(data, "lastOutcome", row.lastOutcome),
  };

  // Persist
  if (Object.keys(data).length > 0) {
    await db.projectComponent.update({
      where: { id: row.componentId },
      data,
    });
  }

  if (shouldWriteRunLog(row, change, ctx)) {
    await db.runLog.create({
      data: {
        projectId,
        event: ctx.trigger.toUpperCase(),
        detail: JSON.stringify({
          source: ctx.source,
          trigger: ctx.trigger,
          reason: ctx.reason ?? null,
          ...(ctx.diagnostics ? { diagnostics: ctx.diagnostics } : {}),
          before,
          after,
          blockers: after.blockers,
          error: null,
        }),
      },
    });
  }

  // Re-read to return accurate state (metadata fields may have changed)
  return requirePrimaryComponentRow(db, projectId);
}

function shouldWriteRunLog(
  row: PrimaryComponentRow,
  change: StateChange,
  ctx: ChangeContext,
): boolean {
  if (isNoOpRunnerHeartbeatMetadataChange(row, change, ctx)) {
    return false;
  }

  return true;
}

function isNoOpRunnerHeartbeatMetadataChange(
  row: PrimaryComponentRow,
  change: StateChange,
  ctx: ChangeContext,
): boolean {
  if (ctx.source !== "runner") return false;
  if (!RUNNER_HEARTBEAT_TRIGGERS.has(ctx.trigger)) return false;
  if (change.type !== "metadata") return false;

  return Object.entries(change.fields).every(([key, nextValue]) => (
    key === "lastHeartbeat" ||
    !metadataFieldChanged(row, key as keyof ComponentMetadataUpdate, nextValue)
  ));
}

function metadataFieldChanged(
  row: PrimaryComponentRow,
  key: keyof ComponentMetadataUpdate,
  nextValue: unknown,
): boolean {
  if (nextValue === undefined) return false;
  const currentValue = row[key as keyof PrimaryComponentRow];

  if (currentValue instanceof Date || nextValue instanceof Date) {
    const currentMs = currentValue instanceof Date ? currentValue.getTime() : null;
    const nextMs = nextValue instanceof Date ? nextValue.getTime() : null;
    return currentMs !== nextMs;
  }

  return currentValue !== nextValue;
}

// --- Convenience helpers (used by actions/crons) ---

export async function updateComponentMetadata(
  db: Db,
  projectId: string,
  fields: ComponentMetadataUpdate,
  ctx: ChangeContext,
): Promise<PrimaryComponentRow> {
  return applyStateChange(db, projectId, { type: "metadata", fields }, ctx);
}

function getFreshStartMetadata(row: PrimaryComponentRow): ComponentMetadataUpdate {
  const retryableBlocker = getRetryableBlocker(row.blockers);

  return {
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    containerName: null,
    previewUrl: null,
    workerHost: null,
    lastHeartbeat: null,
    retryCount: retryableBlocker ? row.retryCount : 0,
    retryAt: retryableBlocker ? row.retryAt : null,
  };
}

export async function resetComponentForFreshStart(
  db: Db,
  projectId: string,
  ctx: FreshStartContext,
  options: {
    metadataOverrides?: ComponentMetadataUpdate;
    preserveOutcome?: boolean;
  } = {},
): Promise<PrimaryComponentRow> {
  let row = await requirePrimaryComponentRow(db, projectId);

  if (row.runtimeState !== "ABSENT") {
    row = await applyStateChange(db, projectId, { type: "runtimeObserved", state: "ABSENT" }, ctx);
  }

  if (row.agentState !== "IDLE") {
    row = await applyStateChange(db, projectId, { type: "agentTransition", state: "IDLE" }, ctx);
  }

  if (!options.preserveOutcome && row.lastOutcome !== null) {
    row = await applyStateChange(db, projectId, { type: "resetOutcome" }, ctx);
  }

  return updateComponentMetadata(
    db,
    projectId,
    {
      ...getFreshStartMetadata(row),
      ...(options.metadataOverrides ?? {}),
    },
    ctx,
  );
}

export async function prepareRuntimeForFreshClaim(
  db: Db,
  projectId: string,
  ctx: FreshStartContext,
  options: {
    provisionedAt?: Date | null;
    clearInfraBlocker?: boolean;
    preserveOutcome?: boolean;
  } = {},
): Promise<{
  row: PrimaryComponentRow;
  clearedStartIntentHistory: boolean;
  clearedInfraBlocker: boolean;
}> {
  const current = await requirePrimaryComponentRow(db, projectId);

  let clearedStartIntentHistory = false;
  const runtimeIntentClient = (db as Db & {
    runtimeIntent?: {
      deleteMany: (args: {
        where: {
          componentId: string;
          action: "ensure_running";
          state: { in: ("FAILED" | "ABANDONED")[] };
        };
      }) => Promise<{ count: number }>;
    };
  }).runtimeIntent;

  if (runtimeIntentClient) {
    const deleted = await runtimeIntentClient.deleteMany({
      where: {
        componentId: current.componentId,
        action: "ensure_running",
        state: { in: ["FAILED", "ABANDONED"] },
      },
    });
    clearedStartIntentHistory = deleted.count > 0;
  }

  let clearedInfraBlocker = false;
  if (options.clearInfraBlocker !== false && current.blockers.includes("INFRA")) {
    await applyStateChange(db, projectId, { type: "removeBlocker", blocker: "INFRA" }, ctx);
    clearedInfraBlocker = true;
  }

  const row = await resetComponentForFreshStart(
    db,
    projectId,
    ctx,
    {
      metadataOverrides: { provisionedAt: options.provisionedAt },
      preserveOutcome: options.preserveOutcome,
    },
  );

  return {
    row,
    clearedStartIntentHistory,
    clearedInfraBlocker,
  };
}

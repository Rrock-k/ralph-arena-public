import {
  type GovernanceSchedulerRole,
  resolveGovernanceScheduler,
} from "./governance-scheduler-role";

export const GOVERNANCE_READINESS_SCHEMA_VERSION = "ra-344.governance-readiness.v1" as const;

export type { GovernanceSchedulerRole };
export type GovernanceMigrationStatus = "compatible" | "not_required" | "blocked" | "not_reported";
export type GovernanceReadinessStatus = "ready" | "not_ready";

export type GovernanceReadinessReport = {
  schemaVersion: typeof GOVERNANCE_READINESS_SCHEMA_VERSION;
  status: GovernanceReadinessStatus;
  generatedAt: string;
  build: {
    id: string | null;
    sha: string | null;
    source: string | null;
  };
  slot: {
    id: string | null;
  };
  scheduler: {
    role: GovernanceSchedulerRole | null;
    enabled: boolean;
  };
  database: {
    status: "reachable" | "unreachable";
    error?: string;
  };
  migration: {
    status: GovernanceMigrationStatus;
  };
  blockers: string[];
};

type BuildGovernanceReadinessOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  dbProbe?: () => Promise<void>;
};

const readyMigrationStatuses = new Set<GovernanceMigrationStatus>(["compatible", "not_required"]);

export async function buildGovernanceReadinessReport(
  options: BuildGovernanceReadinessOptions = {},
): Promise<GovernanceReadinessReport> {
  const env = options.env ?? process.env;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const blockers: string[] = [];
  const build = readBuildIdentity(env);
  const slotId = readNonEmpty(env.GOVERNANCE_SLOT_ID);
  const scheduler = resolveGovernanceScheduler(env);
  const migrationStatus = readMigrationStatus(env.GOVERNANCE_MIGRATION_STATUS);
  const database = await readDatabaseStatus(options.dbProbe);

  if (!build.id) blockers.push("missing_build_id");
  if (!slotId) blockers.push("missing_slot_id");
  if (!scheduler.role) blockers.push("missing_or_invalid_scheduler_role");
  if (database.status !== "reachable") blockers.push("database_unreachable");
  if (!readyMigrationStatuses.has(migrationStatus)) blockers.push(`migration_${migrationStatus}`);

  return {
    schemaVersion: GOVERNANCE_READINESS_SCHEMA_VERSION,
    status: blockers.length === 0 ? "ready" : "not_ready",
    generatedAt,
    build,
    slot: {
      id: slotId,
    },
    scheduler: {
      role: scheduler.role,
      enabled: scheduler.enabled,
    },
    database,
    migration: {
      status: migrationStatus,
    },
    blockers,
  };
}

export async function probePrismaDatabase(prisma: { $queryRawUnsafe: (query: string) => Promise<unknown> }) {
  await prisma.$queryRawUnsafe("SELECT 1");
}

function readBuildIdentity(env: NodeJS.ProcessEnv) {
  const explicitBuildId = readNonEmpty(env.GOVERNANCE_BUILD_ID);
  const releaseSha = readNonEmpty(env.GOVERNANCE_RELEASE_SHA);
  const vercelSha = readNonEmpty(env.VERCEL_GIT_COMMIT_SHA);
  const gitSha = releaseSha ?? vercelSha;

  if (explicitBuildId) {
    return {
      id: explicitBuildId,
      sha: gitSha,
      source: "GOVERNANCE_BUILD_ID",
    };
  }

  if (releaseSha) {
    return {
      id: releaseSha,
      sha: releaseSha,
      source: "GOVERNANCE_RELEASE_SHA",
    };
  }

  if (vercelSha) {
    return {
      id: vercelSha,
      sha: vercelSha,
      source: "VERCEL_GIT_COMMIT_SHA",
    };
  }

  return {
    id: null,
    sha: null,
    source: null,
  };
}

async function readDatabaseStatus(dbProbe: (() => Promise<void>) | undefined) {
  if (!dbProbe) {
    return { status: "unreachable" as const, error: "db_probe_missing" };
  }

  try {
    await dbProbe();
    return { status: "reachable" as const };
  } catch (error) {
    return {
      status: "unreachable" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readMigrationStatus(value: string | undefined): GovernanceMigrationStatus {
  const normalized = readNonEmpty(value);
  if (
    normalized === "compatible"
    || normalized === "not_required"
    || normalized === "blocked"
    || normalized === "not_reported"
  ) {
    return normalized;
  }
  return "not_reported";
}

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

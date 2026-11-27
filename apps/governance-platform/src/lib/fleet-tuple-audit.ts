import { prisma } from "@/lib/prisma";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";

type DefaultClassCode =
  | "ghost_baggage_parked"
  | "failed_launch_absent"
  | "preview_live_stale_baggage"
  | "completed_preview_drift";

type AuditSeverity = "high" | "medium" | "low";

type AuditExample = {
  projectId: string;
  name: string;
  archived: boolean;
  previewUrl: string | null;
  updatedAt: string;
  workerHost: string | null;
};

type AuditBucket<TCode extends string> = {
  code: TCode;
  tuple: string;
  count: number;
  severity: AuditSeverity;
  meaning: string;
  recommendedAction: string;
  recommendedTool: string | null;
  examples: AuditExample[];
};

type ProjectRow = Awaited<ReturnType<typeof loadFleetTupleAuditRows>>[number];
type ComponentRow = ProjectRow["components"][number];

const DEFAULT_CLASS_META: ReadonlyArray<Omit<AuditBucket<DefaultClassCode>, "count" | "examples">> = [
  {
    code: "ghost_baggage_parked",
    tuple: "OFF / * / ABSENT / IDLE / baggage / *",
    severity: "high",
    meaning: "parked row polluted by stale lifecycle baggage",
    recommendedAction: "power_off",
    recommendedTool: null,
  },
  {
    code: "failed_launch_absent",
    tuple: "ON / ON / ABSENT / IDLE / - / FAILED",
    severity: "high",
    meaning: "honest failed launch/runtime with no preview",
    recommendedAction: "recreate_runtime",
    recommendedTool: "project_recovery_attempt",
  },
  {
    code: "preview_live_stale_baggage",
    tuple: "ON / OFF / RUNNING / IDLE / INFRA / -",
    severity: "medium",
    meaning: "preview is already live but stale recovery baggage remains on the row",
    recommendedAction: "safe_cleanup_preview_baggage",
    recommendedTool: null,
  },
  {
    code: "completed_preview_drift",
    tuple: "ON / OFF / RUNNING / RUNNING / - / COMPLETED",
    severity: "medium",
    meaning: "completed preview-only row still reports a running agent state",
    recommendedAction: "recreate_runtime",
    recommendedTool: "project_recovery_attempt",
  },
];

export type FleetTupleAuditResult = {
  generatedAt: string;
  totals: {
    scannedProjects: number;
    flaggedProjects: number;
    distinctClasses: number;
  };
  classes: AuditBucket<DefaultClassCode>[];
};

export async function getFleetTupleAudit(options?: {
  includeArchived?: boolean;
  limitExamples?: number;
}): Promise<FleetTupleAuditResult> {
  const includeArchived = options?.includeArchived === true;
  const limitExamples = clampExampleLimit(options?.limitExamples);
  const rows = await loadFleetTupleAuditRows(includeArchived);

  const defaultBuckets = new Map<DefaultClassCode, AuditBucket<DefaultClassCode>>();
  for (const meta of DEFAULT_CLASS_META) {
    defaultBuckets.set(meta.code, { ...meta, count: 0, examples: [] });
  }

  for (const row of rows) {
    const component = getPrimaryLifecycleComponent(row);
    if (!component) continue;

    const defaultCode = classifyDefaultTuple(component);
    if (defaultCode) {
      appendExample(defaultBuckets.get(defaultCode), buildAuditExample(row, component), limitExamples);
    }
  }

  const classes = Array.from(defaultBuckets.values()).filter((bucket) => bucket.count > 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      scannedProjects: rows.length,
      flaggedProjects: sumCounts(classes),
      distinctClasses: classes.length,
    },
    classes,
  };
}

async function loadFleetTupleAuditRows(includeArchived: boolean) {
  return prisma.project.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      archivedAt: true,
      updatedAt: true,
      components: {
        where: { kind: "app" },
        take: 1,
        select: {
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
          lastOutcome: true,
          previewHealth: true,
          previewUrl: true,
          retryAt: true,
          retryCount: true,
          workerHost: true,
          containerName: true,
          lastHeartbeat: true,
        },
      },
    },
  });
}

function classifyDefaultTuple(component: ComponentRow): DefaultClassCode | null {
  if (
    component.powerIntent === "OFF"
    && component.runtimeState === "ABSENT"
    && component.agentState === "IDLE"
    && (
      component.agentIntent !== "OFF"
      || component.blockers.length > 0
      || component.retryAt != null
      || (component.retryCount ?? 0) > 0
      || (component.previewHealth != null && component.previewHealth !== "UNKNOWN")
      || component.previewUrl != null
      || component.workerHost != null
      || component.containerName != null
      || component.lastHeartbeat != null
    )
  ) {
    return "ghost_baggage_parked";
  }

  if (
    component.powerIntent === "ON"
    && component.agentIntent === "ON"
    && component.runtimeState === "ABSENT"
    && component.agentState === "IDLE"
    && component.lastOutcome === "FAILED"
  ) {
    return "failed_launch_absent";
  }

  if (
    component.powerIntent === "ON"
    && component.agentIntent === "OFF"
    && component.runtimeState === "RUNNING"
    && component.agentState === "IDLE"
    && component.blockers.includes("INFRA")
  ) {
    return "preview_live_stale_baggage";
  }

  if (
    component.powerIntent === "ON"
    && component.agentIntent === "OFF"
    && component.runtimeState === "RUNNING"
    && component.agentState === "RUNNING"
    && component.lastOutcome === "COMPLETED"
  ) {
    return "completed_preview_drift";
  }

  return null;
}

function buildAuditExample(row: ProjectRow, component: ComponentRow): AuditExample {
  return {
    projectId: row.id,
    name: row.name,
    archived: row.archivedAt != null,
    previewUrl: component.previewUrl ?? null,
    updatedAt: row.updatedAt.toISOString(),
    workerHost: component.workerHost ?? null,
  };
}

function appendExample<TCode extends string>(
  bucket: AuditBucket<TCode> | undefined,
  example: AuditExample,
  limitExamples: number,
) {
  if (!bucket) return;
  bucket.count += 1;
  if (bucket.examples.length < limitExamples) {
    bucket.examples.push(example);
  }
}

function clampExampleLimit(limitExamples: number | undefined) {
  if (!Number.isFinite(limitExamples)) return 3;
  return Math.min(Math.max(Math.trunc(limitExamples as number), 1), 10);
}

function sumCounts(buckets: Array<{ count: number }>) {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}

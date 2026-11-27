import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { relaunchProjectInternal, relaunchProjectWithOverridesInternal } from "@/app/actions/relaunch";
import { setAgentIntentInternal } from "@/app/actions/agent-intent";
import { setPowerIntentInternal } from "@/app/actions/power-intent";
import {
  setProjectModelInternal,
  setProjectRuntimeAuthModesInternal,
  setProjectRuntimeSystemInternal,
  setProjectSourceSnapshotInternal,
  setProjectVisibilityInternal,
  setProjectVisualEvidenceModeInternal,
} from "@/app/actions/project-settings";
import { createSpecInternal } from "@/app/actions/specs";
import {
  addRequiredSecret,
  createProjectSecretInternal,
  removeRequiredSecret,
} from "@/app/actions/secrets";
import { normalizeLegacySourceConfigRecipeInternal } from "@/app/actions/source-config";
import { addProjectCreditsInternal, setProjectBudgetLimitInternal } from "@/app/actions/budget";
import { deleteProjectInternal } from "@/app/actions/project-manage";
import { removeContainerInternal } from "@/app/actions/container-ops";
import { archiveProjectInternal, unarchiveProjectInternal } from "@/app/actions/archive";
import { launchProposalInternal } from "@/app/actions/launch";
import { createPersonalAgentProjectInternal, createPersonalTgSpecProjectInternal } from "@/app/actions/projects";
import { deleteProposalInternal, purgeProposalInternal } from "@/app/actions/proposal-manage";
import {
  requestProjectPreviewRefreshInternal,
  restartWorkerServiceInternal,
} from "@/app/actions/runtime-maintenance";
import { configureTgSpecProjectLaunch, startTgSpecProjectLaunch } from "@/lib/tg-spec-project-launch";
import { getAdminApiAuthResult } from "@/lib/admin-api-auth";
import { getPreviewRefreshAuthResult } from "@/lib/preview-refresh-auth";
import { readProjectPreviewGeneration } from "@/lib/preview-status";
import { getProjectSpecs, getProjectState, getProjectWorkerInfo, getWorkerSnapshot } from "@/lib/control-plane";
import { getFleetTupleAudit } from "@/lib/fleet-tuple-audit";
import { getProjectOperatorSnapshotForViewer } from "@/lib/admin-ops-projects";
import { getProjectInteractionSnapshotForViewer } from "@/lib/project-interaction";
import { buildVisualEvidenceReadiness } from "@/lib/project-visual-evidence-readiness";
import { prisma } from "@/lib/prisma";
import { runProjectAudit } from "@/lib/project-audit";
import { createProjectAsset, deleteProjectAsset, listProjectAssets } from "@/lib/project-assets";
import {
  listProjectReleaseArtifacts,
  publishProjectReleaseArtifact,
  type ProjectReleaseArtifactStatus,
} from "@/lib/project-release-artifacts";
import { getProjectProposalPath } from "@/lib/project-identity";
import { getFleetSpecArtifactAudit, getProjectSpecArtifactAudit } from "@/lib/spec-artifact-audit";
import { buildRuntimeIntentClaimDryRun } from "@/lib/runtime-intent-claim-dry-run";
import { buildRunnerInitReadinessSummary } from "@/lib/runner-init-readiness";
import { getAuthdHealthSnapshot } from "@/lib/authd-client";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import {
  finalizeRecoveryAttemptReport,
  loadRecoverySnapshot,
} from "@/lib/project-recovery";
import {
  prepareRuntimeForFreshClaim,
} from "@/lib/project-state-effects";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { getSystemOverview } from "@/lib/system-overview";
import { buildProjectVisualEvidenceArtifactCheck } from "@/lib/project-visual-evidence-artifact-check";
import {
  ProjectVisualEvidenceIngestError,
  ingestProjectVisualEvidence,
} from "@/lib/project-visual-evidence-ingest";
import {
  TgSpecAcceptedArtifactImportRequestSchema,
  importTgSpecAcceptedArtifact,
} from "@/lib/tg-spec-import";
import { getTokenManager } from "@/lib/token-manager";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { retryProjectNowInternal } from "@/lib/retry-now";
import type {
  RecoveryAttemptInput,
  RecoveryAttemptRecord,
} from "@/lib/project-recovery-types";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

export async function GET(request: Request, context: RouteContext) {
  const path = await readPath(context);
  const previewAuth = getPreviewRefreshAuthResult(request, { method: "GET", path });
  if (previewAuth.kind === "denied") {
    return NextResponse.json({ error: previewAuth.error }, { status: previewAuth.status });
  }

  if (previewAuth.kind !== "authorized") {
    const auth = getAdminApiAuthResult(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  }

  const url = new URL(request.url);

  if (path[0] === "projects" && path[1] && path[2] === "preview-status" && path.length === 3) {
    const result = await readProjectPreviewGeneration(path[1]);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }
    return NextResponse.json({
      projectId: path[1],
      generation: result.generation,
      observedAt: new Date().toISOString(),
    });
  }

  if (matches(path, "system-overview")) {
    return NextResponse.json(await getSystemOverview());
  }

  if (matches(path, "authd", "health")) {
    return NextResponse.json(await getAuthdHealthSnapshot());
  }

  if (matches(path, "audit")) {
    const projectIds = url.searchParams.get("projectIds")?.split(",").filter(Boolean);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const skipFilesystem = url.searchParams.get("skipFilesystem") === "true";
    const includeMigrationChecks = url.searchParams.get("includeMigrationChecks") === "true";
    return NextResponse.json(await runProjectAudit({ projectIds: projectIds?.length ? projectIds : undefined, includeArchived, skipFilesystem, includeMigrationChecks }));
  }

  if (matches(path, "fleet", "tuple-audit")) {
    return NextResponse.json(await getFleetTupleAudit({
      includeArchived: url.searchParams.get("includeArchived") === "true",
      limitExamples: readExampleLimit(url.searchParams.get("limitExamples")),
    }));
  }

  if (matches(path, "fleet", "spec-artifact-audit")) {
    return NextResponse.json(await getFleetSpecArtifactAudit({
      includeArchived: url.searchParams.get("includeArchived") !== "false",
      limitProjects: readExampleLimit(url.searchParams.get("limitProjects")),
    }));
  }

  if (matches(path, "projects")) {
    return NextResponse.json(await listProjects(url));
  }

  if (path[0] === "projects" && path[1] && path[2] === "health" && path.length === 3) {
    const [project, worker] = await Promise.all([
      getProjectState(path[1]),
      getWorkerSnapshot(path[1], { tail: readTail(url, 50) }),
    ]);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project, worker });
  }

  if (path[0] === "projects" && path[1] && path[2] === "specs" && path.length === 3) {
    return NextResponse.json(await getProjectSpecs(path[1]));
  }

  if (path[0] === "projects" && path[1] && path[2] === "worker-info" && path.length === 3) {
    const info = await getProjectWorkerInfo(path[1]);
    if (!info) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(info);
  }

  if (path[0] === "projects" && path[1] && path[2] === "worker-snapshot" && path.length === 3) {
    const worker = await getWorkerSnapshot(path[1], { tail: readTail(url, 50) });
    if (!worker) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(worker);
  }

  if (path[0] === "projects" && path[1] && path[2] === "snapshot" && path.length === 3) {
    const project = await getProjectOperatorSnapshotForViewer({
      projectId: path[1],
      session: null,
      hasBypass: true,
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(project);
  }

  if (path[0] === "projects" && path[1] && path[2] === "runtime-claim-dry-run" && path.length === 3) {
    return NextResponse.json(await buildRuntimeIntentClaimDryRun({
      projectId: path[1],
      host: url.searchParams.get("host") ?? undefined,
      capacity: readCapacity(url.searchParams.get("capacity")),
      activePreviewContainers: readCsv(url.searchParams.get("activePreviewContainers")),
    }));
  }

  if (path[0] === "projects" && path[1] && path[2] === "runner-init-readiness" && path.length === 3) {
    return NextResponse.json(await buildRunnerInitReadinessSummary(path[1]));
  }

  if (path[0] === "projects" && path[1] && path[2] === "spec-artifact-audit" && path.length === 3) {
    const audit = await getProjectSpecArtifactAudit(path[1]);
    if (!audit) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(audit);
  }

  if (path[0] === "projects" && path[1] && path[2] === "proof-reviews" && path.length === 3) {
    const result = await getProjectInteractionSnapshotForViewer({
      projectId: path[1],
      session: null,
      hasBypass: true,
      surface: "telegram",
    });

    switch (result.status) {
      case "ok":
        return NextResponse.json({
          project: {
            id: result.snapshot.project.id,
            name: result.snapshot.project.name,
            slug: result.snapshot.project.slug,
          },
          statusSummary: result.snapshot.execution.statusSummary,
          latestAcceptedUpdate: result.snapshot.execution.latestAcceptedUpdate,
          visualEvidenceReadiness: buildVisualEvidenceReadiness(result.snapshot),
          proofReviews: result.snapshot.proofReviews,
          visualEvidenceReviews: result.snapshot.visualEvidenceReviews,
        });
      case "not_found":
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      case "unauthorized":
        return NextResponse.json({ error: "Project access denied" }, { status: 401 });
      case "forbidden":
        return NextResponse.json({ error: "Project access denied" }, { status: 403 });
    }
  }

  if (path[0] === "projects" && path[1] && path[2] === "visual-evidence-artifact-check" && path.length === 3) {
    const result = await getProjectInteractionSnapshotForViewer({
      projectId: path[1],
      session: null,
      hasBypass: true,
      surface: "telegram",
    });

    switch (result.status) {
      case "ok": {
        const artifactCheck = await buildProjectVisualEvidenceArtifactCheck({
          projectId: path[1]!,
          reviews: result.snapshot.visualEvidenceReviews,
        });
        return NextResponse.json({
          project: {
            id: result.snapshot.project.id,
            name: result.snapshot.project.name,
            slug: result.snapshot.project.slug,
          },
          latestAcceptedUpdate: result.snapshot.execution.latestAcceptedUpdate,
          visualEvidenceReadiness: buildVisualEvidenceReadiness(result.snapshot),
          ...artifactCheck,
        });
      }
      case "not_found":
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      case "unauthorized":
        return NextResponse.json({ error: "Project access denied" }, { status: 401 });
      case "forbidden":
        return NextResponse.json({ error: "Project access denied" }, { status: 403 });
    }
  }

  if (path[0] === "projects" && path[1] && path[2] === "logs" && path.length === 3) {
    const tail = readTail(url, 100);
    const project = await prisma.project.findUnique({
      where: { id: path[1] },
      select: {
        id: true,
        name: true,
        log: true,
        runLogs: {
          orderBy: { createdAt: "desc" },
          take: tail,
          select: {
            id: true,
            event: true,
            detail: true,
            createdAt: true,
          },
        },
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(project);
  }

  if (path[0] === "projects" && path[1] && path[2] === "updates" && path.length === 3) {
    const tail = readTail(url, 20);
    const [project, updates, personalNotifications] = await Promise.all([
      prisma.project.findUnique({
        where: { id: path[1] },
        select: {
          id: true,
          name: true,
          tgSpecSourceProjectId: true,
        },
      }),
      prisma.projectUpdateOutbox.findMany({
        where: { projectId: path[1] },
        orderBy: { createdAt: "desc" },
        take: tail,
        select: {
          id: true,
          eventType: true,
          audience: true,
          requiredCapability: true,
          dedupeKey: true,
          status: true,
          attempts: true,
          payload: true,
          externalMessageId: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
          deliveredAt: true,
        },
      }),
      prisma.projectPersonalNotificationOutbox.findMany({
        where: { projectId: path[1] },
        orderBy: { createdAt: "desc" },
        take: tail,
        select: {
          id: true,
          recipientUserId: true,
          channel: true,
          eventType: true,
          requiredCapability: true,
          dedupeKey: true,
          status: true,
          attempts: true,
          payload: true,
          externalMessageId: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
          deliveredAt: true,
        },
      }),
    ]);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: project.id,
      name: project.name,
      deliveryDiagnostics: buildProjectUpdateDeliveryDiagnostics({
        tgSpecSourceProjectId: project.tgSpecSourceProjectId,
        updates,
        personalNotifications,
      }),
      updates,
      personalNotifications,
    });
  }

  if (path[0] === "projects" && path[1] && path[2] === "release-artifacts" && path[3] === "mac" && path.length === 4) {
    const artifacts = await listProjectReleaseArtifacts(path[1], {
      limit: readExampleLimit(url.searchParams.get("limit")) ?? 10,
    });
    return NextResponse.json({
      projectId: path[1],
      platform: "macos",
      artifacts,
      latest: artifacts[0] ?? null,
    });
  }

  if (path[0] === "projects" && path[1] && path[2] === "assets" && path.length === 3) {
    return NextResponse.json(await listProjectAssets(path[1]));
  }

  if (matches(path, "tokens", "status")) {
    return NextResponse.json(getTokenManager().getStatus());
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function buildProjectUpdateDeliveryDiagnostics(input: {
  tgSpecSourceProjectId: string | null;
  updates: Array<ProjectUpdateDeliveryRow>;
  personalNotifications: Array<ProjectPersonalNotificationDeliveryRow>;
}) {
  return {
    tgSpecSourceProjectId: input.tgSpecSourceProjectId,
    arenaProjectUpdateEligible: Boolean(input.tgSpecSourceProjectId),
    latestProjectUpdate: summarizeDeliveryRow(input.updates[0] ?? null),
    latestPersonalNotification: summarizeDeliveryRow(input.personalNotifications[0] ?? null),
    notes: [
      "Arena project update eligibility is owned by Project.tgSpecSourceProjectId.",
      "tg-spec delivery binding is evidenced by outbox row status/lastError; this route does not query tg-spec or send messages.",
    ],
  };
}

type ProjectUpdateDeliveryRow = {
  eventType: string;
  status: string;
  audience: string;
  lastError: string | null;
  externalMessageId: string | null;
  updatedAt: Date;
  deliveredAt: Date | null;
};

type ProjectPersonalNotificationDeliveryRow = {
  eventType: string;
  status: string;
  channel: string;
  lastError: string | null;
  externalMessageId: string | null;
  updatedAt: Date;
  deliveredAt: Date | null;
};

function summarizeDeliveryRow(row: ProjectUpdateDeliveryRow | ProjectPersonalNotificationDeliveryRow | null) {
  if (!row) return null;
  return {
    eventType: row.eventType,
    status: row.status,
    lastError: row.lastError,
    externalMessageId: row.externalMessageId,
    updatedAt: row.updatedAt,
    deliveredAt: row.deliveredAt,
  };
}

export async function POST(request: Request, context: RouteContext) {
  const path = await readPath(context);
  const previewAuth = getPreviewRefreshAuthResult(request, { method: "POST", path });
  if (previewAuth.kind === "denied") {
    return NextResponse.json({ error: previewAuth.error }, { status: previewAuth.status });
  }

  if (previewAuth.kind === "not_provided") {
    const auth = getAdminApiAuthResult(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const createdById = readOptionalString(body.createdById);

  if (path[0] === "projects" && path[1] && path[2] === "recovery" && path[3] === "attempt" && path.length === 4) {
    const action = readRecoveryAction(body.action);
    if (!action) {
      return badRequest("Explicit recovery action is required");
    }

    const input: RecoveryAttemptInput = {
      projectId: path[1],
      action,
    };

    const snapshotBefore = await loadRecoverySnapshot(path[1]);
    if (!snapshotBefore) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const attemptRecord = await executeRecoveryAction(snapshotBefore, input);
    const report = await finalizeRecoveryAttemptReport(input, snapshotBefore, attemptRecord);

    return NextResponse.json(report);
  }

  if (path[0] === "projects" && path[1] && path[2] === "relaunch" && path.length === 3) {
    const hasField = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    if (!hasField("agent") && !hasField("agentImpl") && !hasField("model") && !hasField("envOverrides") && !hasField("claudeAuthMode") && !hasField("codexAuthMode") && !hasField("runnerBackend") && !hasField("toolId") && !hasField("providerBillingMode")) {
      return NextResponse.json(await relaunchProjectInternal(path[1], INTERNAL_ACTION_TOKEN));
    }
    return NextResponse.json(await relaunchProjectWithOverridesInternal(path[1], {
      agent: hasField("agent") ? (readOptionalString(body.agent) ?? undefined) : undefined,
      agentImpl: hasField("agentImpl") ? (readOptionalString(body.agentImpl) ?? undefined) : undefined,
      // Preserve current project settings when relaunch body omits optional fields.
      model: hasField("model") ? readOptionalString(body.model) : undefined,
      envOverrides: hasField("envOverrides") ? readStrictStringRecord(body.envOverrides) : undefined,
      claudeAuthMode: hasField("claudeAuthMode") ? readOptionalString(body.claudeAuthMode) : undefined,
      codexAuthMode: hasField("codexAuthMode") ? readOptionalString(body.codexAuthMode) : undefined,
      runnerBackend: hasField("runnerBackend") ? readOptionalString(body.runnerBackend) : undefined,
      toolId: hasField("toolId") ? readOptionalString(body.toolId) : undefined,
      providerBillingMode: hasField("providerBillingMode") ? readOptionalString(body.providerBillingMode) : undefined,
    }, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "retry-now" && path.length === 3) {
    return NextResponse.json(await retryProjectNowInternal(path[1]));
  }

  if (path[0] === "projects" && path[1] && path[2] === "tg-spec-launch-configure" && path.length === 3) {
    const agent = readRequiredString(body.agent, "agent");
    if (!agent.ok) return badRequest(agent.error);
    const agentImpl = readRequiredString(body.agentImpl, "agentImpl");
    if (!agentImpl.ok) return badRequest(agentImpl.error);
    const runnerBackend = readRunnerBackend(body.runnerBackend);
    if (!runnerBackend.ok) return badRequest(runnerBackend.error);
    const providerBillingMode = readRequiredString(body.providerBillingMode, "providerBillingMode");
    if (!providerBillingMode.ok) return badRequest(providerBillingMode.error);
    const envOverrides = readOptionalNullableStringRecord(body.envOverrides, "envOverrides");
    if (!envOverrides.ok) return badRequest(envOverrides.error);
    const initialBudgetUsd = readOptionalFiniteNumber(body.initialBudgetUsd, "initialBudgetUsd");
    if (!initialBudgetUsd.ok) return badRequest(initialBudgetUsd.error);
    const addonIds = readOptionalStringArray(body.addonIds, "addonIds");
    if (!addonIds.ok) return badRequest(addonIds.error);
    const visualWorkbenchEvidenceAutomation = readOptionalBoolean(
      body.visualWorkbenchEvidenceAutomation,
      "visualWorkbenchEvidenceAutomation",
    );
    if (!visualWorkbenchEvidenceAutomation.ok) return badRequest(visualWorkbenchEvidenceAutomation.error);
    const visualEvidenceMode = readOptionalVisualEvidenceMode(
      body.visualEvidenceMode,
      "visualEvidenceMode",
    );
    if (!visualEvidenceMode.ok) return badRequest(visualEvidenceMode.error);
    const hasField = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

    return NextResponse.json(await configureTgSpecProjectLaunch(path[1], {
      agent: agent.value,
      agentImpl: agentImpl.value,
      ...(hasField("model") ? { model: readOptionalString(body.model) } : {}),
      ...(hasField("envOverrides") ? { envOverrides: envOverrides.value } : {}),
      ...(hasField("claudeAuthMode") ? { claudeAuthMode: readOptionalString(body.claudeAuthMode) } : {}),
      ...(hasField("codexAuthMode") ? { codexAuthMode: readOptionalString(body.codexAuthMode) } : {}),
      runnerBackend: runnerBackend.value,
      ...(hasField("toolId") ? { toolId: readOptionalString(body.toolId) } : {}),
      providerBillingMode: providerBillingMode.value,
      ...(hasField("initialBudgetUsd") ? { initialBudgetUsd: initialBudgetUsd.value } : {}),
      ...(hasField("addonIds") ? { addonIds: addonIds.value } : {}),
      ...(hasField("visualEvidenceMode")
        ? { visualEvidenceMode: visualEvidenceMode.value }
        : {}),
      ...(hasField("visualWorkbenchEvidenceAutomation")
        ? { visualWorkbenchEvidenceAutomation: visualWorkbenchEvidenceAutomation.value }
        : {}),
    }, {
      actorUserId: createdById,
      privileged: true,
    }));
  }

  if (path[0] === "projects" && path[1] && path[2] === "tg-spec-launch-start" && path.length === 3) {
    return NextResponse.json(await startTgSpecProjectLaunch(path[1], {
      actorUserId: createdById,
      privileged: true,
    }));
  }

  // RA-247: Explicit agent intent endpoints
  if (path[0] === "projects" && path[1] && path[2] === "agent-on" && path.length === 3) {
    return NextResponse.json(await setAgentIntentInternal(path[1], "ON", INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "agent-off" && path.length === 3) {
    return NextResponse.json(await setAgentIntentInternal(path[1], "OFF", INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "archive" && path.length === 3) {
    return NextResponse.json(await archiveProjectInternal(path[1], INTERNAL_ACTION_TOKEN));
  }

  // RA-247: Explicit sourceConfig recipe normalization endpoint
  if (path[0] === "projects" && path[1] && path[2] === "source-config" && path[3] === "normalize-recipe" && path.length === 4) {
    return NextResponse.json(await normalizeLegacySourceConfigRecipeInternal(path[1], INTERNAL_ACTION_TOKEN));
  }

  // RA-237: Unarchive = clear archivedAt (does NOT auto-turn-on)
  if (path[0] === "projects" && path[1] && path[2] === "unarchive" && path.length === 3) {
    return NextResponse.json(await unarchiveProjectInternal(path[1], INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "specs" && path.length === 3) {
    const content = readRequiredString(body.content, "content");
    if (!content.ok) return badRequest(content.error);
    return NextResponse.json(await createSpecInternal(path[1], {
      title: readOptionalArg(body.title),
      content: content.value,
    }, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "budget" && path.length === 3) {
    if (typeof body.totalCreditsUsd === "number") {
      return NextResponse.json(await setProjectBudgetLimitInternal(
        path[1],
        body.totalCreditsUsd,
        typeof body.isEnabled === "boolean" ? body.isEnabled : true,
        readOptionalArg(body.note),
        { createdById, internalActionToken: INTERNAL_ACTION_TOKEN },
      ));
    }
    if (typeof body.amountUsd === "number") {
      return NextResponse.json(await addProjectCreditsInternal(
        path[1],
        body.amountUsd,
        readOptionalArg(body.note),
        { createdById, internalActionToken: INTERNAL_ACTION_TOKEN },
      ));
    }
    return badRequest("Provide either totalCreditsUsd or amountUsd");
  }

  if (path[0] === "projects" && path[1] && path[2] === "secrets" && path.length === 3) {
    const key = readRequiredString(body.key, "key");
    if (!key.ok) return badRequest(key.error);
    const value = readRequiredString(body.value, "value");
    if (!value.ok) return badRequest(value.error);
    return NextResponse.json(await createProjectSecretInternal(
      path[1],
      key.value,
      value.value,
      readOptionalArg(body.description),
      { internalActionToken: INTERNAL_ACTION_TOKEN },
    ));
  }

  if (path[0] === "projects" && path[1] && path[2] === "required-secrets" && path[3] === "add" && path.length === 4) {
    const key = readRequiredString(body.key, "key");
    if (!key.ok) return badRequest(key.error);
    return NextResponse.json(await addRequiredSecret(path[1], key.value, readOptionalString(body.description) ?? undefined));
  }

  if (path[0] === "projects" && path[1] && path[2] === "required-secrets" && path[3] === "remove" && path.length === 4) {
    const key = readRequiredString(body.key, "key");
    if (!key.ok) return badRequest(key.error);
    return NextResponse.json(await removeRequiredSecret(path[1], key.value));
  }

  if (path[0] === "projects" && path[1] && path[2] === "visibility" && path.length === 3) {
    const visibility = readProjectVisibility(body.visibility);
    if (!visibility) return badRequest("visibility must be one of: private, public, featured");
    return NextResponse.json(await setProjectVisibilityInternal(path[1], visibility, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "model" && path.length === 3) {
    const model = readRequiredString(body.model, "model");
    if (!model.ok) return badRequest(model.error);
    return NextResponse.json(await setProjectModelInternal(path[1], model.value, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "runtime-system" && path.length === 3) {
    const agent = readRequiredString(body.agent, "agent");
    if (!agent.ok) return badRequest(agent.error);
    const agentImpl = readRequiredString(body.agentImpl, "agentImpl");
    if (!agentImpl.ok) return badRequest(agentImpl.error);
    const providerBillingMode = readRequiredString(body.providerBillingMode, "providerBillingMode");
    if (!providerBillingMode.ok) return badRequest(providerBillingMode.error);
    return NextResponse.json(await setProjectRuntimeSystemInternal(path[1], {
      agent: agent.value,
      agentImpl: agentImpl.value,
      model: readOptionalString(body.model),
      toolId: readOptionalString(body.toolId),
      providerBillingMode: providerBillingMode.value,
      claudeAuthMode: readOptionalString(body.claudeAuthMode),
      codexAuthMode: readOptionalString(body.codexAuthMode),
    }, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "source-snapshot" && path.length === 3) {
    const commitSha = readRequiredString(body.commitSha, "commitSha");
    if (!commitSha.ok) return badRequest(commitSha.error);
    return NextResponse.json(await setProjectSourceSnapshotInternal(path[1], commitSha.value, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "runtime-auth-modes" && path.length === 3) {
    const hasField = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    if (!hasField("claudeAuthMode") && !hasField("codexAuthMode")) {
      return badRequest("At least one auth mode is required");
    }
    return NextResponse.json(await setProjectRuntimeAuthModesInternal(path[1], {
      ...(hasField("claudeAuthMode") ? { claudeAuthMode: readOptionalString(body.claudeAuthMode) } : {}),
      ...(hasField("codexAuthMode") ? { codexAuthMode: readOptionalString(body.codexAuthMode) } : {}),
    }, INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "visual-evidence-mode" && path.length === 3) {
    const visualEvidenceMode = readOptionalVisualEvidenceMode(body.visualEvidenceMode, "visualEvidenceMode");
    if (!visualEvidenceMode.ok) return badRequest(visualEvidenceMode.error);
    if (!visualEvidenceMode.value) return badRequest("visualEvidenceMode is required");
    return NextResponse.json(await setProjectVisualEvidenceModeInternal(
      path[1],
      visualEvidenceMode.value,
      INTERNAL_ACTION_TOKEN,
    ));
  }

  if (path[0] === "projects" && path[1] && path[2] === "visual-evidence-ingest" && path.length === 3) {
    const taskId = readRequiredString(body.taskId, "taskId");
    if (!taskId.ok) return badRequest(taskId.error);
    const sourceEvidenceRef = readRequiredString(body.sourceEvidenceRef, "sourceEvidenceRef");
    if (!sourceEvidenceRef.ok) return badRequest(sourceEvidenceRef.error);
    const progressJson = readRequiredString(body.progressJson, "progressJson");
    if (!progressJson.ok) return badRequest(progressJson.error);
    const artifactFilename = readRequiredString(body.artifactFilename, "artifactFilename");
    if (!artifactFilename.ok) return badRequest(artifactFilename.error);
    const artifactContentType = readRequiredString(body.artifactContentType, "artifactContentType");
    if (!artifactContentType.ok) return badRequest(artifactContentType.error);
    const artifactContentBase64 = readRequiredString(body.artifactContentBase64, "artifactContentBase64");
    if (!artifactContentBase64.ok) return badRequest(artifactContentBase64.error);

    try {
      return NextResponse.json(await ingestProjectVisualEvidence({
        projectId: path[1],
        taskId: taskId.value,
        sourceEvidenceRef: sourceEvidenceRef.value,
        progressJson: progressJson.value,
        artifactFilename: artifactFilename.value,
        artifactContentType: artifactContentType.value,
        artifactContentBase64: artifactContentBase64.value,
        uploadedById: createdById ?? "arena-admin-api",
      }));
    } catch (error) {
      if (error instanceof ProjectVisualEvidenceIngestError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  }

  if (path[0] === "projects" && path[1] && path[2] === "release-artifacts" && path[3] === "mac" && path.length === 4) {
    const status = readReleaseArtifactStatus(body.status);
    if (!status) return badRequest("status must be one of: building, build_failed, available");
    const contentBase64 = readOptionalString(body.contentBase64);
    const buffer = contentBase64 ? Buffer.from(contentBase64, "base64") : null;

    try {
      const artifact = await publishProjectReleaseArtifact({
        projectId: path[1],
        platform: "macos",
        appKind: "electron",
        status,
        version: readOptionalString(body.version),
        tag: readOptionalString(body.tag),
        commitSha: readOptionalString(body.commitSha),
        filename: readOptionalString(body.filename),
        contentType: readOptionalString(body.contentType),
        sha256: readOptionalString(body.sha256),
        builderLabel: readOptionalString(body.builderLabel),
        failureSummary: readOptionalString(body.failureSummary),
        buffer,
      });
      revalidatePath(`/projects/${path[1]}`);
      revalidatePath(`/my/projects/${path[1]}`);
      revalidatePath("/my");
      notifyProjectChanged(path[1]);
      return NextResponse.json({ success: true, artifact });
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Invalid release artifact");
    }
  }

  if (path[0] === "projects" && path[1] && path[2] === "source-config" && path[3] === "normalize-legacy-recipe" && path.length === 4) {
    return NextResponse.json(await normalizeLegacySourceConfigRecipeInternal(path[1], INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "assets" && path.length === 3) {
    const originalName = readRequiredString(body.filename ?? body.originalName, "filename");
    if (!originalName.ok) return badRequest(originalName.error);
    const contentBase64 = readRequiredString(body.contentBase64, "contentBase64");
    if (!contentBase64.ok) return badRequest(contentBase64.error);
    const buffer = Buffer.from(contentBase64.value, "base64");
    const asset = await createProjectAsset({
      projectId: path[1],
      originalName: originalName.value,
      contentType: readOptionalString(body.contentType),
      buffer,
      assetPath: readOptionalString(body.path),
      uploadedById: createdById ?? "arena-admin-api",
    });
    return NextResponse.json({ success: true, asset });
  }

  if (path[0] === "projects" && path[1] && path[2] === "assets" && path[3] && path[4] === "delete" && path.length === 5) {
    const asset = await deleteProjectAsset(path[1], path[3]);
    return NextResponse.json({ success: true, asset });
  }

  if (path[0] === "projects" && path[1] && path[2] === "delete" && path.length === 3) {
    return NextResponse.json(await deleteProjectInternal(path[1], {
      removeDocker: typeof body.removeDocker === "boolean" ? body.removeDocker : true,
      removeWorkspace: typeof body.removeWorkspace === "boolean" ? body.removeWorkspace : true,
      internalActionToken: INTERNAL_ACTION_TOKEN,
    }));
  }

  // RA-247: Explicit power intent endpoints
  if (path[0] === "projects" && path[1] && path[2] === "power-on" && path.length === 3) {
    return NextResponse.json(await setPowerIntentInternal(path[1], "ON", INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "power-off" && path.length === 3) {
    return NextResponse.json(await setPowerIntentInternal(path[1], "OFF", INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "projects" && path[1] && path[2] === "preview-refresh" && path.length === 3) {
    return NextResponse.json(await requestProjectPreviewRefreshInternal(path[1], {
      internalActionToken: INTERNAL_ACTION_TOKEN,
    }));
  }

  if (path[0] === "workers" && path[1] && path[2] === "restart-service" && path.length === 3) {
    return NextResponse.json(await restartWorkerServiceInternal(path[1], {
      vpsIp: readOptionalString(body.vpsIp),
      internalActionToken: INTERNAL_ACTION_TOKEN,
    }));
  }

  if (matches(path, "projects", "create")) {
    const spec = readRequiredString(body.spec, "spec");
    if (!spec.ok) return badRequest(spec.error);
    const addonIds = readOptionalStringArray(body.addonIds, "addonIds");
    if (!addonIds.ok) return badRequest(addonIds.error);
    const initialBudgetUsd = readOptionalNumber(body.initialBudgetUsd ?? body.budget);
    return NextResponse.json(await createPersonalAgentProjectInternal({
      name: readOptionalString(body.title) ?? readOptionalString(body.name) ?? `Arena Control ${Date.now()}`,
      spec: spec.value,
      initialBudgetUsd,
      agent: readOptionalString(body.agent) ?? "codex",
      agentImpl: readOptionalString(body.agentImpl) ?? "direct",
      model: readOptionalString(body.model),
      envOverrides: readNullableStringRecord(body.envOverrides),
      claudeAuthMode: readOptionalString(body.claudeAuthMode),
      codexAuthMode: readOptionalString(body.codexAuthMode),
      runnerBackend: readOptionalString(body.runnerBackend),
      toolId: readOptionalString(body.toolId),
      proposalId: readOptionalString(body.proposalId),
      repoUrl: readOptionalString(body.repoUrl),
      repoBranch: readOptionalString(body.repoBranch),
      vpsServerType: readOptionalString(body.vpsServerType),
      providerBillingMode: readOptionalString(body.providerBillingMode),
      addonIds: addonIds.value,
      addonSecretValues: readNullableStringRecord(body.addonSecretValues),
      sourceSeedProfile: readOptionalString(body.sourceSeedProfile),
    }, {
      ownerScopeId: createdById ?? "arena-admin-api",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    }));
  }

  if (matches(path, "projects", "tg-spec-target-create")) {
    const sourceProjectId = readRequiredString(body.sourceProjectId, "sourceProjectId");
    if (!sourceProjectId.ok) return badRequest(sourceProjectId.error);
    const title = readRequiredString(body.title ?? body.name, "title");
    if (!title.ok) return badRequest(title.error);
    const addonIds = readOptionalStringArray(body.addonIds, "addonIds");
    if (!addonIds.ok) return badRequest(addonIds.error);

    return NextResponse.json(await createPersonalTgSpecProjectInternal({
      name: title.value,
      initialBudgetUsd: readOptionalNumber(body.initialBudgetUsd ?? body.budget),
      agent: readOptionalString(body.agent) ?? "codex",
      agentImpl: readOptionalString(body.agentImpl) ?? "direct",
      model: readOptionalString(body.model),
      envOverrides: readNullableStringRecord(body.envOverrides),
      claudeAuthMode: readOptionalString(body.claudeAuthMode),
      codexAuthMode: readOptionalString(body.codexAuthMode),
      runnerBackend: readOptionalString(body.runnerBackend) ?? "local",
      toolId: readOptionalString(body.toolId),
      proposalId: readOptionalString(body.proposalId),
      repoUrl: readOptionalString(body.repoUrl),
      repoBranch: readOptionalString(body.repoBranch),
      vpsServerType: readOptionalString(body.vpsServerType),
      providerBillingMode: readOptionalString(body.providerBillingMode) ?? "byok",
      addonIds: addonIds.value,
      addonSecretValues: readNullableStringRecord(body.addonSecretValues),
      sourceSeedProfile: readOptionalString(body.sourceSeedProfile),
    }, {
      ownerScopeId: createdById ?? "arena-admin-api",
      tgSpecSourceProjectId: sourceProjectId.value,
      awaitingLaunchConfiguration: readBoolean(body.awaitingLaunchConfiguration, true),
      allowMissingAddonSecrets: readBoolean(body.allowMissingAddonSecrets, true),
      internalActionToken: INTERNAL_ACTION_TOKEN,
    }));
  }

  if (path[0] === "projects" && path[1] && path[2] === "tg-spec-accepted-artifact-import" && path.length === 3) {
    const parsedImport = TgSpecAcceptedArtifactImportRequestSchema.safeParse(body);
    if (!parsedImport.success) {
      return NextResponse.json({ error: "Invalid request", details: parsedImport.error.flatten() }, { status: 400 });
    }

    try {
      const result = await importTgSpecAcceptedArtifact(path[1], parsedImport.data);
      if (result.kind === "not_found") {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      if (result.kind === "source_mismatch") {
        return NextResponse.json({
          error: "Project already bound to a different tg-spec source",
          sourceProjectId: result.sourceProjectId,
        }, { status: 409 });
      }
      if (result.kind === "target_required") {
        return NextResponse.json({ error: "Project is not configured as a tg-spec target" }, { status: 409 });
      }
      if (result.kind === "duplicate") {
        return NextResponse.json({ ok: true, imported: false, duplicate: true });
      }
      revalidatePath(`/projects/${result.projectId}`);
      revalidatePath(`/my/projects/${result.projectId}`);
      const proposalPath = getProjectProposalPath({ proposalId: result.proposalId });
      if (proposalPath) revalidatePath(proposalPath);
      revalidatePath("/my");
      revalidatePath("/admin");
      notifyProjectChanged(result.projectId);
      return NextResponse.json({
        ok: true,
        imported: result.kind === "imported",
        ...(result.kind === "updated" ? { updated: true } : {}),
        duplicate: false,
        mirrorSpecId: result.mirrorSpecId,
        sourceVersion: result.sourceVersion,
        specVersionId: result.specVersionId,
        specVersion: result.specVersion,
        metadataHash: result.metadataHash,
        metadataStatus: result.metadataStatus,
      });
    } catch (error) {
      if (error instanceof Error && /acceptedArtifact|packageSchemaVersion|sourceUrl/.test(error.message)) {
        return NextResponse.json({ error: "Invalid tg-spec metadata", details: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  if (matches(path, "projects", "launch-proposal")) {
    const proposalId = readRequiredString(body.proposalId, "proposalId");
    if (!proposalId.ok) return badRequest(proposalId.error);
    return NextResponse.json(await launchProposalInternal(proposalId.value, {
      agent: readOptionalString(body.agent) ?? undefined,
      agentImpl: readOptionalString(body.agentImpl) ?? undefined,
      model: readOptionalString(body.model),
      envOverrides: readStrictStringRecord(body.envOverrides),
      initialBudgetUsd: typeof body.initialBudgetUsd === "number" ? body.initialBudgetUsd : null,
      claudeAuthMode: readOptionalString(body.claudeAuthMode),
      codexAuthMode: readOptionalString(body.codexAuthMode),
      runnerBackend: readOptionalString(body.runnerBackend),
      repoUrl: readOptionalString(body.repoUrl),
      repoBranch: readOptionalString(body.repoBranch),
      vpsServerType: readOptionalString(body.vpsServerType),
      toolId: readOptionalString(body.toolId),
      providerBillingMode: readOptionalString(body.providerBillingMode),
    }, { createdById, internalActionToken: INTERNAL_ACTION_TOKEN }));
  }

  if (path[0] === "proposals" && path[1] && path[2] === "delete" && path.length === 3) {
    return NextResponse.json(await deleteProposalInternal(path[1], INTERNAL_ACTION_TOKEN));
  }

  if (path[0] === "proposals" && path[1] && path[2] === "purge" && path.length === 3) {
    return NextResponse.json(await purgeProposalInternal(path[1], INTERNAL_ACTION_TOKEN));
  }

  if (matches(path, "tokens", "refresh")) {
    const tm = getTokenManager();
    const refreshed = await tm.triggerRefreshSync({
      force: body.force === true,
    });
    return NextResponse.json({
      success: true,
      refreshed,
      status: tm.getStatus(),
    });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function readPath(context: RouteContext): Promise<string[]> {
  const params = await context.params;
  return Array.isArray(params.path) ? params.path : [];
}

function matches(path: string[], ...expected: string[]): boolean {
  return path.length === expected.length && expected.every((segment, index) => path[index] === segment);
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function readTail(url: URL, fallback: number): number {
  const raw = url.searchParams.get("tail");
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), 5000);
}

function readExampleLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function readCapacity(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.trunc(parsed));
}

function readCsv(value: string | null): string[] | null {
  if (!value) return null;
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalArg(value: unknown): string | undefined {
  return readOptionalString(value) ?? undefined;
}

function readRequiredString(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: value.trim() };
}

function readOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalFiniteNumber(
  value: unknown,
  field: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${field} must be a finite number` };
  }
  return { ok: true, value: parsed };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readOptionalBoolean(
  value: unknown,
  field: string,
): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value === "boolean") return { ok: true, value };
  return { ok: false, error: `${field} must be a boolean` };
}

function readOptionalVisualEvidenceMode(
  value: unknown,
  field: string,
): { ok: true; value: "off" | "required" | "new_tasks_only" | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === "off" || value === "required" || value === "new_tasks_only") {
    return { ok: true, value };
  }
  return { ok: false, error: `${field} must be one of: off, required, new_tasks_only` };
}

function readRecoveryAction(
  value: unknown,
): RecoveryAttemptInput["action"] | undefined {
  if (typeof value !== "string") return undefined;
  if (
    value === "preview_restore"
    || value === "recreate_runtime"
  ) {
    return value;
  }
  return undefined;
}

function readProjectVisibility(value: unknown) {
  if (value === "private" || value === "public" || value === "featured") {
    return value;
  }
  return null;
}

function readReleaseArtifactStatus(value: unknown): ProjectReleaseArtifactStatus | null {
  if (value === "building" || value === "build_failed" || value === "available") {
    return value;
  }
  return null;
}

function readStrictStringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, entry]) => typeof entry === "string")) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function readOptionalStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (!Array.isArray(value)) return { ok: false, error: `${field} must be an array of strings` };
  if (!value.every((entry) => typeof entry === "string")) {
    return { ok: false, error: `${field} must be an array of strings` };
  }
  return {
    ok: true,
    value: value.map((entry) => entry.trim()).filter(Boolean),
  };
}

function readNullableStringRecord(value: unknown): Record<string, string | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, entry]) => entry === null || typeof entry === "string")) return null;
  return Object.fromEntries(entries) as Record<string, string | null>;
}

function readOptionalNullableStringRecord(
  value: unknown,
  field: string,
): { ok: true; value: Record<string, string | null> | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${field} must be an object with string or null values` };
  }
  const entries = Object.entries(value);
  if (!entries.every(([, entry]) => entry === null || typeof entry === "string")) {
    return { ok: false, error: `${field} must be an object with string or null values` };
  }
  return { ok: true, value: Object.fromEntries(entries) as Record<string, string | null> };
}

function readRunnerBackend(
  value: unknown,
): { ok: true; value: "local" | "vps" } | { ok: false; error: string } {
  if (value === "local" || value === "vps") {
    return { ok: true, value };
  }
  return { ok: false, error: "runnerBackend must be one of: local, vps" };
}

async function listProjects(url: URL) {
  const archived = url.searchParams.get("archived");
  const backends = splitCsv(url.searchParams.get("runnerBackend"));
  const query = url.searchParams.get("q")?.trim() || null;
  const take = Math.min(Math.max(Number(url.searchParams.get("limit") || "100"), 1), 500);

  const projects = await prisma.project.findMany({
    where: {
      ...(archived === "true" ? { archivedAt: { not: null } } : archived === "false" ? { archivedAt: null } : {}),
      ...(backends.length > 0 ? { runnerBackend: { in: backends } } : {}),
      ...(query ? {
        OR: [
          { id: { contains: query } },
          { name: { contains: query, mode: "insensitive" as const } },
          { agent: { contains: query, mode: "insensitive" as const } },
          { agentImpl: { contains: query, mode: "insensitive" as const } },
        ],
      } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      name: true,
      mode: true,
      archivedAt: true,
      agent: true,
      agentImpl: true,
      model: true,
      runnerBackend: true,
      createdAt: true,
      updatedAt: true,
      estimatedCostUsd: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          workerHost: true,
          previewUrl: true,
          lastHeartbeat: true,
        },
      },
      budget: {
        select: {
          isEnabled: true,
          totalCreditsUsd: true,
          usedCreditsUsd: true,
        },
      },
      vpsHost: {
        select: {
          id: true,
          ip: true,
          status: true,
          serverType: true,
          region: true,
        },
      },
    },
  });

  return projects.map((project) => {
    const component = getPrimaryLifecycleComponent(project);
    const { components, ...projectSnapshotWithHistory } = project;
    return {
      ...projectSnapshotWithHistory,
      workerHost: component?.workerHost ?? null,
      previewUrl: component?.previewUrl ?? null,
      lastHeartbeat: component?.lastHeartbeat ?? null,
    };
  });
}

function splitCsv(value: string | null): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function executeRecoveryAction(
  snapshotBefore: Awaited<ReturnType<typeof loadRecoverySnapshot>>,
  input: RecoveryAttemptInput,
): Promise<RecoveryAttemptRecord> {
  const startedAt = new Date().toISOString();
  const executedSteps: string[] = [];
  const errors: string[] = [];

  if (!snapshotBefore) {
    return {
      executed: false,
      executedSteps,
      errors: ["Project not found"],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  if (input.action === "preview_restore") {
    const shouldRemoveContainer = Boolean(
      snapshotBefore.component.containerName
      && snapshotBefore.worker.workerUrl
      && snapshotBefore.worker.inspectStatus !== "not_found",
    );

    if (shouldRemoveContainer) {
      const removeResult = await removeContainerInternal(input.projectId, INTERNAL_ACTION_TOKEN);
      if (!removeResult.success) {
        errors.push(removeResult.error ?? "removeContainerInternal failed");
      } else {
        executedSteps.push("remove_existing_container");
      }
    }

    if (errors.length === 0) {
      executedSteps.push("agent_off");
      const agentResult = await setAgentIntentInternal(input.projectId, "OFF", INTERNAL_ACTION_TOKEN);
      if (!agentResult.success) {
        errors.push(agentResult.error ?? "agent off failed");
      }
    }

    if (errors.length === 0) {
      executedSteps.push("reset_runtime_for_preview_restore");
      await prisma.$transaction(async (tx) => {
        const prepared = await prepareRuntimeForFreshClaim(tx, input.projectId, {
          source: "system",
          trigger: "preview_restore",
          reason: "Explicit operator preview-only restore",
        }, {
          provisionedAt: null,
          clearInfraBlocker: true,
          preserveOutcome: true,
        });

        if (prepared.clearedStartIntentHistory) {
          executedSteps.push("clear_blocking_start_runtime_intent_history");
        }
      });
    }

    if (errors.length === 0) {
      if (snapshotBefore.component.powerIntent !== "ON") {
        executedSteps.push("power_on");
        const result = await setPowerIntentInternal(input.projectId, "ON", INTERNAL_ACTION_TOKEN);
        if (!result.success) {
          errors.push(result.error ?? "power on failed");
        }
      } else {
        executedSteps.push("queue_preview_restore_claim");
      }
    }
    return {
      executed: errors.length === 0,
      executedSteps,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  if (input.action === "recreate_runtime") {
    const shouldRemoveContainer = Boolean(
      snapshotBefore.component.containerName
      && snapshotBefore.worker.workerUrl
      && snapshotBefore.worker.inspectStatus !== "not_found",
    );

    if (shouldRemoveContainer) {
      const removeResult = await removeContainerInternal(input.projectId, INTERNAL_ACTION_TOKEN);
      if (!removeResult.success) {
        errors.push(removeResult.error ?? "removeContainerInternal failed");
      } else {
        executedSteps.push("remove_existing_container");
      }
    }

    if (errors.length === 0) {
      executedSteps.push("reset_runtime_for_fresh_start");
      await prisma.$transaction(async (tx) => {
        const prepared = await prepareRuntimeForFreshClaim(tx, input.projectId, {
          source: "system",
          trigger: "recreate_runtime",
          reason: "Explicit operator recreate of runtime container before fresh claim",
        }, {
          provisionedAt: null,
          clearInfraBlocker: true,
          preserveOutcome: true,
        });

        const clearedHistory = prepared.clearedStartIntentHistory;
        if (clearedHistory) {
          executedSteps.push("clear_blocking_start_runtime_intent_history");
        }

        await tx.runLog.create({
          data: {
            projectId: input.projectId,
            event: "RUNTIME_RECREATE",
            detail: JSON.stringify({
              source: "admin",
              trigger: "recreate_runtime",
              reason: "Explicit operator recreate of runtime container before fresh claim",
              before: {
                powerIntent: snapshotBefore.component.powerIntent,
                agentIntent: snapshotBefore.component.agentIntent,
                runtimeState: snapshotBefore.component.runtimeState,
                agentState: snapshotBefore.component.agentState,
                blockers: snapshotBefore.component.blockers,
                provisionedAt: snapshotBefore.component.provisionedAt,
                containerName: snapshotBefore.component.containerName,
                previewUrl: snapshotBefore.component.previewUrl,
                workerHost: snapshotBefore.component.workerHost,
              },
              after: {
                powerIntent: snapshotBefore.component.powerIntent,
                agentIntent: snapshotBefore.component.agentIntent,
                runtimeState: "ABSENT",
                agentState: "IDLE",
                blockers: snapshotBefore.component.blockers.filter((blocker) => blocker !== "INFRA"),
                provisionedAt: null,
                containerName: null,
                previewUrl: null,
                workerHost: null,
              },
              error: null,
            }),
          },
        });
      });

      if (snapshotBefore.component.powerIntent === "ON") {
        executedSteps.push("queue_fresh_claim");
      }

      revalidatePath("/");
      revalidatePath("/explore");
      revalidatePath("/admin");
      revalidatePath(`/projects/${input.projectId}`);
      revalidatePath(`/my/projects/${input.projectId}`);
      revalidatePath(`/admin/projects/${input.projectId}`);
    }
    return {
      executed: errors.length === 0,
      executedSteps,
      errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  errors.push(`Unsupported recovery action: ${input.action}`);
  return {
    executed: false,
    executedSteps,
    errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

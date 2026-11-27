import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/app/actions/relaunch", () => ({
  relaunchProjectInternal: vi.fn(),
  relaunchProjectWithOverridesInternal: vi.fn(),
}));

vi.mock("@/app/actions/agent-intent", () => ({
  setAgentIntentInternal: vi.fn(),
}));

vi.mock("@/app/actions/power-intent", () => ({
  setPowerIntentInternal: vi.fn(),
}));

vi.mock("@/app/actions/project-settings", () => ({
  setProjectModelInternal: vi.fn(),
  setProjectRuntimeAuthModesInternal: vi.fn(),
  setProjectRuntimeSystemInternal: vi.fn(),
  setProjectSourceSnapshotInternal: vi.fn(),
  setProjectVisibilityInternal: vi.fn(),
  setProjectVisualEvidenceModeInternal: vi.fn(),
}));

vi.mock("@/app/actions/specs", () => ({
  createSpecInternal: vi.fn(),
}));

vi.mock("@/app/actions/secrets", () => ({
  createProjectSecretInternal: vi.fn(),
  addRequiredSecret: vi.fn(),
  removeRequiredSecret: vi.fn(),
}));

vi.mock("@/app/actions/source-config", () => ({
  normalizeLegacySourceConfigRecipeInternal: vi.fn(),
}));

vi.mock("@/app/actions/budget", () => ({
  addProjectCreditsInternal: vi.fn(),
  setProjectBudgetLimitInternal: vi.fn(),
}));

vi.mock("@/app/actions/project-manage", () => ({
  deleteProjectInternal: vi.fn(),
}));

vi.mock("@/app/actions/container-ops", () => ({
  removeContainerInternal: vi.fn(),
}));

vi.mock("@/app/actions/archive", () => ({
  archiveProjectInternal: vi.fn(),
  unarchiveProjectInternal: vi.fn(),
}));

vi.mock("@/app/actions/runtime-maintenance", () => ({
  requestProjectPreviewRefreshInternal: vi.fn(),
  restartWorkerServiceInternal: vi.fn(),
}));

vi.mock("@/app/actions/launch", () => ({
  launchProposalInternal: vi.fn(),
}));

vi.mock("@/app/actions/projects", () => ({
  createPersonalAgentProjectInternal: vi.fn(),
  createPersonalTgSpecProjectInternal: vi.fn(),
}));

vi.mock("@/lib/tg-spec-project-launch", () => ({
  configureTgSpecProjectLaunch: vi.fn(),
  startTgSpecProjectLaunch: vi.fn(),
}));

vi.mock("@/app/actions/proposal-manage", () => ({
  deleteProposalInternal: vi.fn(),
  purgeProposalInternal: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  getAdminApiAuthResult: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/control-plane", () => ({
  getProjectState: vi.fn(),
  getProjectSpecs: vi.fn(),
  getProjectWorkerInfo: vi.fn(),
  getWorkerSnapshot: vi.fn(),
}));

vi.mock("@/lib/preview-status", () => ({
  readProjectPreviewGeneration: vi.fn(),
}));

vi.mock("@/lib/admin-ops-projects", () => ({
  getProjectOperatorSnapshotForViewer: vi.fn(),
}));

vi.mock("@/lib/project-interaction", () => ({
  getProjectInteractionSnapshotForViewer: vi.fn(),
  getProjectVisualEvidenceArtifactForDownload: vi.fn(),
}));

vi.mock("@/lib/project-visual-evidence-ingest", () => ({
  ProjectVisualEvidenceIngestError: class ProjectVisualEvidenceIngestError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
  ingestProjectVisualEvidence: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn().mockResolvedValue({}),
  prepareRuntimeForFreshClaim: vi.fn().mockResolvedValue({ row: {}, clearedStartIntentHistory: true, clearedInfraBlocker: true }),
  resetComponentForFreshStart: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    projectUpdateOutbox: {
      findMany: vi.fn(),
    },
    projectPersonalNotificationOutbox: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/project-audit", () => ({
  runProjectAudit: vi.fn(),
}));

vi.mock("@/lib/project-assets", () => ({
  createProjectAsset: vi.fn(),
  deleteProjectAsset: vi.fn(),
  listProjectAssets: vi.fn(),
}));

vi.mock("@/lib/project-release-artifacts", () => ({
  listProjectReleaseArtifacts: vi.fn(),
  publishProjectReleaseArtifact: vi.fn(),
}));

vi.mock("@/lib/spec-artifact-audit", () => ({
  getFleetSpecArtifactAudit: vi.fn(),
  getProjectSpecArtifactAudit: vi.fn(),
}));

vi.mock("@/lib/runtime-intent-claim-dry-run", () => ({
  buildRuntimeIntentClaimDryRun: vi.fn(),
}));

vi.mock("@/lib/runner-init-readiness", () => ({
  buildRunnerInitReadinessSummary: vi.fn(),
}));

vi.mock("@/lib/project-recovery", () => ({
  diagnoseRecoverySnapshot: vi.fn(),
  finalizeRecoveryAttemptReport: vi.fn(),
  loadRecoverySnapshot: vi.fn(),
}));

vi.mock("@/lib/system-overview", () => ({
  getSystemOverview: vi.fn(),
}));

vi.mock("@/lib/authd-client", () => ({
  getAuthdHealthSnapshot: vi.fn(),
}));

vi.mock("@/lib/token-manager", () => ({
  getTokenManager: vi.fn(() => ({
    getStatus: vi.fn(() => ({})),
    triggerRefreshSync: vi.fn(),
  })),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("@/lib/tg-spec-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tg-spec-import")>();
  return {
    ...actual,
    importTgSpecAcceptedArtifact: vi.fn(),
  };
});

vi.mock("@/lib/retry-now", () => ({
  retryProjectNowInternal: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  relaunchProjectInternal,
  relaunchProjectWithOverridesInternal,
} from "@/app/actions/relaunch";
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
import { deleteProjectInternal } from "@/app/actions/project-manage";
import { removeContainerInternal } from "@/app/actions/container-ops";
import { normalizeLegacySourceConfigRecipeInternal } from "@/app/actions/source-config";
import { archiveProjectInternal, unarchiveProjectInternal } from "@/app/actions/archive";
import { createPersonalAgentProjectInternal, createPersonalTgSpecProjectInternal } from "@/app/actions/projects";
import {
  requestProjectPreviewRefreshInternal,
  restartWorkerServiceInternal,
} from "@/app/actions/runtime-maintenance";
import { addRequiredSecret, removeRequiredSecret } from "@/app/actions/secrets";
import { getProjectState, getWorkerSnapshot } from "@/lib/control-plane";
import { readProjectPreviewGeneration } from "@/lib/preview-status";
import { getProjectOperatorSnapshotForViewer } from "@/lib/admin-ops-projects";
import {
  getProjectInteractionSnapshotForViewer,
  getProjectVisualEvidenceArtifactForDownload,
} from "@/lib/project-interaction";
import {
  ProjectVisualEvidenceIngestError,
  ingestProjectVisualEvidence,
} from "@/lib/project-visual-evidence-ingest";
import { getFleetSpecArtifactAudit, getProjectSpecArtifactAudit } from "@/lib/spec-artifact-audit";
import { buildRuntimeIntentClaimDryRun } from "@/lib/runtime-intent-claim-dry-run";
import { buildRunnerInitReadinessSummary } from "@/lib/runner-init-readiness";
import { getAuthdHealthSnapshot } from "@/lib/authd-client";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import {
  diagnoseRecoverySnapshot,
  finalizeRecoveryAttemptReport,
  loadRecoverySnapshot,
} from "@/lib/project-recovery";
import { prepareRuntimeForFreshClaim } from "@/lib/project-state-effects";
import { prisma } from "@/lib/prisma";
import { retryProjectNowInternal } from "@/lib/retry-now";
import { importTgSpecAcceptedArtifact } from "@/lib/tg-spec-import";
import { configureTgSpecProjectLaunch, startTgSpecProjectLaunch } from "@/lib/tg-spec-project-launch";
import {
  listProjectReleaseArtifacts,
  publishProjectReleaseArtifact,
} from "@/lib/project-release-artifacts";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { revalidatePath } from "next/cache";

async function postPath(
  path: string[],
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const req = new Request("http://localhost/api/admin/ctl", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
  return POST(req, { params: Promise.resolve({ path }) });
}

async function getPath(
  path: string[],
  query = "",
  headers: Record<string, string> = {},
) {
  const req = new Request(`http://localhost/api/admin/ctl${query}`, {
    method: "GET",
    headers,
  });
  return GET(req, { params: Promise.resolve({ path }) });
}

function acceptedImportPackageFixture() {
  return {
    sourceProjectId: "tg-project-1",
    sourceVersion: 7,
    specMarkdown: "# Visual Canary\n\nBuild a visible synth UI.",
    changeSummary: "Add visible synth UI",
    acceptedArtifact: {
      artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
      artifactId: "SPEC-007",
      acceptedAt: "2026-06-07T09:30:00.000Z",
      source: {
        id: "SRC-007",
        sourceSystem: "tg-spec",
        sourceProjectId: "tg-project-1",
        sourceVersion: 7,
        sourceRefType: "accepted_spec",
        sourceId: "tg-spec-version-7",
      },
      acceptedSpec: {
        id: "SPEC-007",
        version: 7,
        document: {
          specSchemaVersion: "ra-287.spec-document.v1",
          title: "Visual Canary",
          sections: [],
          requirements: [],
          extensionBlocks: [],
        },
        renderedMarkdown: "# Visual Canary\n\nBuild a visible synth UI.",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceRefs: ["SRC-007"],
      },
      acceptedDiff: {
        id: "DIFF-007",
        targetSpecVersion: 7,
        summary: "Add visible synth UI",
        items: [{
          id: "DIFF-007-REQ-UI",
          targetType: "spec",
          targetId: "REQ-UI",
          changeType: "created",
          workImpact: "requires_loop_work",
          workSurface: "frontend",
          summary: "Build a visible synth UI",
          sourceRefs: ["SRC-007"],
          sourceEvidence: [{
            sourceRef: "SRC-007",
            intent: "The canary needs ordinary-web frontend UI work.",
          }],
        }],
      },
      feedback: [],
      assumptions: [],
      secretRequirements: [],
      assets: [],
    },
  };
}

describe("POST /api/admin/ctl explicit lifecycle routes", () => {
  const originalPreviewDomain = process.env.PREVIEW_DOMAIN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PREVIEW_DOMAIN = "arena.example.test";
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({
      project: { update: vi.fn().mockResolvedValue({}) },
      projectComponent: { update: vi.fn().mockResolvedValue({}) },
      runLog: { create: vi.fn().mockResolvedValue({}) },
    }));
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.projectUpdateOutbox.findMany).mockResolvedValue([]);
    vi.mocked(prisma.projectPersonalNotificationOutbox.findMany).mockResolvedValue([]);
    vi.mocked(listProjectReleaseArtifacts).mockResolvedValue([]);
    vi.mocked(publishProjectReleaseArtifact).mockResolvedValue({
      id: "release-1",
      projectId: "project-1",
      platform: "macos",
      appKind: "electron",
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      contentType: "application/zip",
      sizeBytes: 12,
      sha256: `sha256:${"a".repeat(64)}`,
      storageKey: "release-1/Petsik.zip",
      builderLabel: "sample-machine",
      failureSummary: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z"),
    } as any);
    vi.mocked(relaunchProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(relaunchProjectWithOverridesInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(retryProjectNowInternal).mockResolvedValue({ success: true, projectId: "project-1", blocker: "RATE_LIMIT", remainingBlockers: [], resumePath: "supervisor" } as any);
    vi.mocked(setAgentIntentInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(setPowerIntentInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(setProjectVisibilityInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(ingestProjectVisualEvidence).mockResolvedValue({
      schemaVersion: "ra-356.project-visual-evidence-ingest.v1",
      status: "ingested",
      projectId: "project-1",
      taskId: "task-001",
      sourceEvidenceRef: "visual-workbench-capture:task-001:desktop:abc",
      reviewId: "visual:abc",
      progress: { imported: true, visualEvidenceReviewCount: 1 },
      asset: {
        assetId: "asset-1",
        path: "assets/system/visual-evidence/visual-abc/capture.png",
        sha256: "a".repeat(64),
        contentType: "image/png",
        sizeBytes: 12,
      },
      notes: [],
    } as any);
    vi.mocked(deleteProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(removeContainerInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(normalizeLegacySourceConfigRecipeInternal).mockResolvedValue({ success: true, normalized: true, projectId: "project-1", message: "ok" } as any);
    vi.mocked(addRequiredSecret).mockResolvedValue({ success: true } as any);
    vi.mocked(removeRequiredSecret).mockResolvedValue({ success: true } as any);
    vi.mocked(archiveProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(unarchiveProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(createPersonalAgentProjectInternal).mockResolvedValue({ success: true, projectId: "project-created" } as any);
    vi.mocked(createPersonalTgSpecProjectInternal).mockResolvedValue({ success: true, projectId: "project-tg-spec-created" } as any);
    vi.mocked(importTgSpecAcceptedArtifact).mockResolvedValue({
      kind: "imported",
      projectId: "project-1",
      proposalId: null,
      mirrorSpecId: "mirror-spec-1",
      sourceVersion: 7,
      specVersionId: "spec-version-7",
      specVersion: 1,
      metadataHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      metadataStatus: "present",
    } as any);
    vi.mocked(configureTgSpecProjectLaunch).mockResolvedValue({ success: true, projectId: "project-1" } as any);
    vi.mocked(startTgSpecProjectLaunch).mockResolvedValue({ success: true, projectId: "project-1" } as any);
    vi.mocked(requestProjectPreviewRefreshInternal).mockResolvedValue({ success: true, details: "Preview refresh requested" } as any);
    vi.mocked(restartWorkerServiceInternal).mockResolvedValue({ success: true, details: "Worker service restart scheduled for local" } as any);
    vi.mocked(getProjectState).mockResolvedValue({
      id: "project-1",
      name: "Demo",
      archivedAt: null,
      runnerBackend: "local",
      components: [],
    } as any);
    vi.mocked(getWorkerSnapshot).mockResolvedValue({
      workerUrl: "http://worker.local",
      inspectStatus: "running",
      meta: {
        containerRuntime: {
          previewDomain: "arena.example.test",
        },
      },
      logTail: null,
    } as any);
    vi.mocked(getProjectOperatorSnapshotForViewer).mockResolvedValue(null as any);
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({ status: "not_found" } as any);
    vi.mocked(diagnoseRecoverySnapshot).mockReturnValue({
      cohort: "needs_recovery",
      mismatches: ["Expected cohort healthy, observed needs_recovery"],
      suggestedAction: "recreate_runtime",
    } as any);
    vi.mocked(loadRecoverySnapshot).mockResolvedValue({
      projectId: "project-1",
      project: {
        id: "project-1",
        name: "Demo",
        archivedAt: null,
        runnerBackend: "local",
        previewUrl: null,
        containerName: "demo",
        workerHost: "local",
        lastError: null,
        startedAt: null,
        finishedAt: null,
        lastHeartbeat: null,
      },
      component: {
        id: "comp-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        lastOutcomeAt: null,
        retryAt: null,
        provisionedAt: null,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: "demo",
        workerHost: "local",
        lastHeartbeat: null,
        retryCount: 0,
      },
      worker: {
        workerUrl: "http://worker.local",
        inspectStatus: "not_found",
        logTail: null,
      },
      previewReachability: {
        classification: "unreachable",
        url: null,
        status: null,
        error: "No preview URL",
      },
    } as any);
    vi.mocked(finalizeRecoveryAttemptReport).mockResolvedValue({
      projectId: "project-1",
      input: { projectId: "project-1", action: "preview_restore" },
      diagnosis: {
        cohort: "needs_recovery",
        mismatches: ["Expected cohort healthy, observed needs_recovery"],
        suggestedAction: "preview_restore",
      },
      snapshotBefore: {} as any,
      attempt: {
        executed: true,
        executedSteps: ["agent_off", "reset_runtime_for_preview_restore", "clear_blocking_start_runtime_intent_history", "queue_preview_restore_claim"],
        errors: [],
        startedAt: "2026-04-21T00:00:00.000Z",
        finishedAt: "2026-04-21T00:00:01.000Z",
      },
      snapshotAfter: {} as any,
    } as any);
  });

  afterEach(() => {
    process.env.PREVIEW_DOMAIN = originalPreviewDomain;
  });

  it("keeps agent-on/agent-off endpoints", async () => {
    const onRes = await postPath(["projects", "project-1", "agent-on"]);
    const offRes = await postPath(["projects", "project-1", "agent-off"]);

    expect(onRes.status).toBe(200);
    expect(offRes.status).toBe(200);
    expect(setAgentIntentInternal).toHaveBeenNthCalledWith(1, "project-1", "ON", INTERNAL_ACTION_TOKEN);
    expect(setAgentIntentInternal).toHaveBeenNthCalledWith(2, "project-1", "OFF", INTERNAL_ACTION_TOKEN);
  });

  it("exposes retry-now as an explicit retryable-blocker endpoint", async () => {
    const retryRes = await postPath(["projects", "project-1", "retry-now"]);
    const payload = await retryRes.json();

    expect(retryRes.status).toBe(200);
    expect(retryProjectNowInternal).toHaveBeenCalledWith("project-1");
    expect(payload).toMatchObject({
      success: true,
      blocker: "RATE_LIMIT",
      resumePath: "supervisor",
    });
  });

  it("exposes explicit tg-spec launch start without using relaunch or agent-on", async () => {
    const startRes = await postPath(["projects", "project-1", "tg-spec-launch-start"], {
      createdById: "operator-1",
    });
    const payload = await startRes.json();

    expect(startRes.status).toBe(200);
    expect(payload).toEqual({ success: true, projectId: "project-1" });
    expect(startTgSpecProjectLaunch).toHaveBeenCalledWith("project-1", {
      actorUserId: "operator-1",
      privileged: true,
    });
    expect(setAgentIntentInternal).not.toHaveBeenCalled();
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
  });

  it("exposes explicit tg-spec launch configure through the launch owner", async () => {
    const configureRes = await postPath(["projects", "project-1", "tg-spec-launch-configure"], {
      createdById: "operator-1",
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.4",
      codexAuthMode: "subscription",
      runnerBackend: "local",
      providerBillingMode: "byok",
      visualWorkbenchEvidenceAutomation: true,
    });
    const payload = await configureRes.json();

    expect(configureRes.status).toBe(200);
    expect(payload).toEqual({ success: true, projectId: "project-1" });
    expect(configureTgSpecProjectLaunch).toHaveBeenCalledWith("project-1", {
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.4",
      codexAuthMode: "subscription",
      runnerBackend: "local",
      providerBillingMode: "byok",
      visualWorkbenchEvidenceAutomation: true,
    }, {
      actorUserId: "operator-1",
      privileged: true,
    });
    expect(startTgSpecProjectLaunch).not.toHaveBeenCalled();
    expect(setAgentIntentInternal).not.toHaveBeenCalled();
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
  });

  it("exposes visual evidence ingest without relaunching or sending lifecycle actions", async () => {
    const ingestRes = await postPath(["projects", "project-1", "visual-evidence-ingest"], {
      createdById: "operator-1",
      taskId: "task-001",
      sourceEvidenceRef: "visual-workbench-capture:task-001:desktop:abc",
      progressJson: "{\"steps\":[]}",
      artifactFilename: "capture.png",
      artifactContentType: "image/png",
      artifactContentBase64: Buffer.from("png").toString("base64"),
    });
    const payload = await ingestRes.json();

    expect(ingestRes.status).toBe(200);
    expect(payload).toMatchObject({
      schemaVersion: "ra-356.project-visual-evidence-ingest.v1",
      status: "ingested",
      reviewId: "visual:abc",
    });
    expect(ingestProjectVisualEvidence).toHaveBeenCalledWith({
      projectId: "project-1",
      taskId: "task-001",
      sourceEvidenceRef: "visual-workbench-capture:task-001:desktop:abc",
      progressJson: "{\"steps\":[]}",
      artifactFilename: "capture.png",
      artifactContentType: "image/png",
      artifactContentBase64: Buffer.from("png").toString("base64"),
      uploadedById: "operator-1",
    });
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(retryProjectNowInternal).not.toHaveBeenCalled();
    expect(setAgentIntentInternal).not.toHaveBeenCalled();
  });

  it("maps visual evidence ingest validation failures to typed 400 responses", async () => {
    vi.mocked(ingestProjectVisualEvidence).mockRejectedValueOnce(
      new ProjectVisualEvidenceIngestError("artifact_digest_mismatch", "digest mismatch"),
    );

    const ingestRes = await postPath(["projects", "project-1", "visual-evidence-ingest"], {
      taskId: "task-001",
      sourceEvidenceRef: "visual-workbench-capture:task-001:desktop:abc",
      progressJson: "{\"steps\":[]}",
      artifactFilename: "capture.png",
      artifactContentType: "image/png",
      artifactContentBase64: Buffer.from("png").toString("base64"),
    });
    const payload = await ingestRes.json();

    expect(ingestRes.status).toBe(400);
    expect(payload).toEqual({
      error: "digest mismatch",
      code: "artifact_digest_mismatch",
    });
  });

  it("exposes a read-only fleet tuple audit endpoint", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      {
        id: "project-ghost",
        name: "Ant Dream",
        archivedAt: null,
        previewUrl: null,
        workerHost: null,
        lastError: "Ghost-recovery limit reached",
        updatedAt: new Date("2026-04-17T10:00:00.000Z"),
        components: [{
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: ["INFRA"],
          lastOutcome: null,
          previewUrl: null,
          workerHost: null,
        }],
      },
      {
        id: "project-paused",
        name: "Space Invaders",
        archivedAt: null,
        previewUrl: "https://preview-space-invaders.arena.example.test",
        workerHost: "worker-1",
        lastError: null,
        updatedAt: new Date("2026-04-17T11:00:00.000Z"),
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "OFF",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          previewUrl: "https://preview-space-invaders.arena.example.test",
          workerHost: "worker-1",
        }],
      },
    ] as any);

    const response = await getPath(["fleet", "tuple-audit"], "?includeArchived=true&limitExamples=1");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: undefined,
    }));
    expect(payload.totals).toEqual({
      scannedProjects: 2,
      flaggedProjects: 1,
      distinctClasses: 1,
    });
    expect(payload.classes).toHaveLength(1);
    expect(payload.classes[0]).toEqual(expect.objectContaining({
      code: "ghost_baggage_parked",
      tuple: "OFF / * / ABSENT / IDLE / baggage / *",
      severity: "high",
      meaning: "parked row polluted by stale lifecycle baggage",
      recommendedAction: "power_off",
      recommendedTool: null,
      examples: [{
        projectId: "project-ghost",
        name: "Ant Dream",
        archived: false,
        previewUrl: null,
        updatedAt: "2026-04-17T10:00:00.000Z",
        workerHost: null,
      }],
    }));
  });

  it("exposes a read-only fleet spec artifact audit endpoint", async () => {
    vi.mocked(getFleetSpecArtifactAudit).mockResolvedValueOnce({
      truth: {
        scannedProjects: 2,
        currentV1Artifacts: 1,
        markdownOnlySpecs: 1,
        malformedMetadata: 0,
        unsafeMetadata: 0,
        noSpec: 0,
        runnerReady: 1,
        repairRequired: 1,
      },
      classification: {
        status: "artifact_repair_required",
        repairCohorts: [{ classification: "markdown_only_spec", count: 1 }],
      },
      why: ["1 scanned project(s) require explicit spec artifact repair before current spec-driven launch/resume."],
      allowedActions: [
        "project_spec_artifact_audit",
        "reimport_from_tg_spec",
        "manual_artifact_repair",
        "park_for_later_repair",
      ],
      recommendedNextAction: "reimport_from_tg_spec",
      operatorNotes: ["This is a spec artifact audit, not lifecycle classification."],
      projects: [],
    } as any);

    const response = await getPath(["fleet", "spec-artifact-audit"], "?includeArchived=false&limitProjects=10");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getFleetSpecArtifactAudit).toHaveBeenCalledWith({
      includeArchived: false,
      limitProjects: 10,
    });
    expect(payload).toMatchObject({
      classification: {
        status: "artifact_repair_required",
      },
      recommendedNextAction: "reimport_from_tg_spec",
    });
    expect(payload).not.toHaveProperty("acceptedDelta");
    expect(payload).not.toHaveProperty("sourceProvenance");
  });

  it("keeps power-on/power-off endpoints", async () => {
    const onRes = await postPath(["projects", "project-1", "power-on"]);
    const offRes = await postPath(["projects", "project-1", "power-off"]);

    expect(onRes.status).toBe(200);
    expect(offRes.status).toBe(200);
    expect(setPowerIntentInternal).toHaveBeenNthCalledWith(1, "project-1", "ON", INTERNAL_ACTION_TOKEN);
    expect(setPowerIntentInternal).toHaveBeenNthCalledWith(2, "project-1", "OFF", INTERNAL_ACTION_TOKEN);
  });

  it("exposes preview-refresh as an explicit maintenance endpoint", async () => {
    const refreshRes = await postPath(["projects", "project-1", "preview-refresh"]);

    expect(refreshRes.status).toBe(200);
    expect(requestProjectPreviewRefreshInternal).toHaveBeenCalledWith("project-1", {
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });
  });

  it("allows the narrow preview token only for an allowlisted preview refresh", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1, project-2";

    try {
      const response = await postPath(
        ["projects", "project-1", "preview-refresh"],
        {},
        { "x-arena-preview-refresh-token": "preview-secret" },
      );

      expect(response.status).toBe(200);
      expect(requestProjectPreviewRefreshInternal).toHaveBeenCalledWith("project-1", {
        internalActionToken: INTERNAL_ACTION_TOKEN,
      });
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("rejects power-off when the narrow preview token is presented", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";

    try {
      const response = await postPath(
        ["projects", "project-1", "power-off"],
        {},
        { "x-arena-preview-refresh-token": "preview-secret" },
      );

      expect(response.status).toBe(403);
      expect(setPowerIntentInternal).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("rejects projects/create when the narrow preview token is presented", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    try {
      const response = await postPath(
        ["projects", "create"],
        {},
        { "x-arena-preview-refresh-token": "preview-secret" },
      );
      expect(response.status).toBe(403);
      expect(createPersonalAgentProjectInternal).not.toHaveBeenCalled();
      expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("rejects preview refresh outside the narrow token project allowlist", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-2";

    try {
      const response = await postPath(
        ["projects", "project-1", "preview-refresh"],
        {},
        { "x-arena-preview-refresh-token": "preview-secret" },
      );

      expect(response.status).toBe(403);
      expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("keeps the narrow preview API disabled when its token is not configured", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";

    try {
      const response = await postPath(
        ["projects", "project-1", "preview-refresh"],
        {},
        { "x-arena-preview-refresh-token": "preview-secret" },
      );

      expect(response.status).toBe(503);
      expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("exposes worker restart as an explicit worker-maintenance endpoint", async () => {
    const restartRes = await postPath(["workers", "local", "restart-service"]);

    expect(restartRes.status).toBe(200);
    expect(restartWorkerServiceInternal).toHaveBeenCalledWith("local", {
      vpsIp: null,
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });
  });

  it("keeps archive/unarchive/relaunch/delete endpoints", async () => {
    const archiveRes = await postPath(["projects", "project-1", "archive"]);
    const unarchiveRes = await postPath(["projects", "project-1", "unarchive"]);
    const relaunchRes = await postPath(["projects", "project-1", "relaunch"]);
    const deleteRes = await postPath(["projects", "project-1", "delete"]);
    const normalizeRes = await postPath(["projects", "project-1", "source-config", "normalize-recipe"]);

    expect(archiveRes.status).toBe(200);
    expect(unarchiveRes.status).toBe(200);
    expect(relaunchRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
    expect(normalizeRes.status).toBe(200);
    expect(archiveProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(unarchiveProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(relaunchProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(deleteProjectInternal).toHaveBeenCalledWith("project-1", {
      removeDocker: true,
      removeWorkspace: true,
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });
    expect(normalizeLegacySourceConfigRecipeInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("routes providerBillingMode-only relaunch through the strict override boundary", async () => {
    const relaunchRes = await postPath(["projects", "project-1", "relaunch"], {
      providerBillingMode: "platform-creditz",
    });

    expect(relaunchRes.status).toBe(200);
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(relaunchProjectWithOverridesInternal).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        providerBillingMode: "platform-creditz",
      }),
      INTERNAL_ACTION_TOKEN,
    );
  });

  it("passes providerBillingMode through project creation instead of dropping it at ctl boundary", async () => {
    const createRes = await postPath(["projects", "create"], {
      title: "Invalid Billing Project",
      spec: "Build something",
      providerBillingMode: "platform-creditz",
    });

    expect(createRes.status).toBe(200);
    expect(createPersonalAgentProjectInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        providerBillingMode: "platform-creditz",
      }),
      expect.objectContaining({
        internalActionToken: INTERNAL_ACTION_TOKEN,
      }),
    );
  });

  it("passes project add-ons and launch-time secrets through project creation", async () => {
    const createRes = await postPath(["projects", "create"], {
      title: "Telegram Project",
      spec: "Build a Telegram Mini App.",
      addonIds: ["telegram_mini_app"],
      addonSecretValues: {
        TELEGRAM_BOT_TOKEN: "secret-token",
      },
    });

    expect(createRes.status).toBe(200);
    expect(createPersonalAgentProjectInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        addonIds: ["telegram_mini_app"],
        addonSecretValues: {
          TELEGRAM_BOT_TOKEN: "secret-token",
        },
      }),
      expect.objectContaining({
        internalActionToken: INTERNAL_ACTION_TOKEN,
      }),
    );
  });

  it("publishes a Mac release artifact through the release artifact owner", async () => {
    const response = await postPath(["projects", "project-1", "release-artifacts", "mac"], {
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      contentType: "application/zip",
      sha256: `sha256:${"a".repeat(64)}`,
      contentBase64: Buffer.from("petsik-build").toString("base64"),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, artifact: { id: "release-1" } });
    expect(publishProjectReleaseArtifact).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      platform: "macos",
      appKind: "electron",
      status: "available",
      tag: "mac-build/petsik-v0.1.0",
      buffer: Buffer.from("petsik-build"),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/my");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it.each([
    ["invalid tag", "Invalid release artifact tag"],
    ["non-allowlisted project", "Project not found"],
    ["metadata mismatch", "Release artifact sha256 mismatch"],
    ["version/tag mismatch", "Release artifact version must match Mac build tag"],
    ["content-type mismatch", "Release artifact content type does not match filename"],
  ])("rejects Mac release publish %s without projecting a download", async (_label, errorMessage) => {
    vi.mocked(publishProjectReleaseArtifact).mockRejectedValueOnce(new Error(errorMessage));

    const response = await postPath(["projects", "project-1", "release-artifacts", "mac"], {
      status: "available",
      version: "0.1.0",
      tag: "mac-build/petsik-v0.1.0",
      commitSha: "abc1234",
      filename: "Petsik.zip",
      contentBase64: Buffer.from("petsik-build").toString("base64"),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: errorMessage });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(notifyProjectChanged).not.toHaveBeenCalled();
  });

  it("passes explicit sourceSeedProfile through project creation", async () => {
    const createRes = await postPath(["projects", "create"], {
      title: "Visual Workbench Canary",
      spec: "Build a visible synth UI.",
      sourceSeedProfile: "visual_workbench_canary_v0",
    });

    expect(createRes.status).toBe(200);
    expect(createPersonalAgentProjectInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSeedProfile: "visual_workbench_canary_v0",
      }),
      expect.objectContaining({
        internalActionToken: INTERNAL_ACTION_TOKEN,
      }),
    );
  });

  it("creates a dormant tg-spec target through the tg-spec project owner", async () => {
    const createRes = await postPath(["projects", "tg-spec-target-create"], {
      title: "Accepted Visual Workbench Canary",
      sourceProjectId: "tg-project-1",
      sourceSeedProfile: "visual_workbench_canary_v0",
      createdById: "operator-1",
    });

    expect(createRes.status).toBe(200);
    expect(createPersonalTgSpecProjectInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Accepted Visual Workbench Canary",
        agent: "codex",
        agentImpl: "direct",
        runnerBackend: "local",
        providerBillingMode: "byok",
        sourceSeedProfile: "visual_workbench_canary_v0",
      }),
      expect.objectContaining({
        ownerScopeId: "operator-1",
        tgSpecSourceProjectId: "tg-project-1",
        awaitingLaunchConfiguration: true,
        allowMissingAddonSecrets: true,
        internalActionToken: INTERNAL_ACTION_TOKEN,
      }),
    );
    expect(createPersonalAgentProjectInternal).not.toHaveBeenCalled();
  });

  it("imports an accepted artifact package through the shared tg-spec import owner", async () => {
    const importPackage = acceptedImportPackageFixture();
    const importRes = await postPath(
      ["projects", "project-1", "tg-spec-accepted-artifact-import"],
      importPackage,
    );
    const payload = await importRes.json();

    expect(importRes.status).toBe(200);
    expect(importTgSpecAcceptedArtifact).toHaveBeenCalledWith("project-1", importPackage);
    expect(payload).toEqual({
      ok: true,
      imported: true,
      duplicate: false,
      mirrorSpecId: "mirror-spec-1",
      sourceVersion: 7,
      specVersionId: "spec-version-7",
      specVersion: 1,
      metadataHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      metadataStatus: "present",
    });
    expect(payload).not.toHaveProperty("acceptedArtifact");
  });

  it("rejects removed legacy lifecycle aliases", async () => {
    const pauseRes = await postPath(["projects", "project-1", "pause"]);
    const resumeRes = await postPath(["projects", "project-1", "resume"]);
    const sleepRes = await postPath(["projects", "project-1", "sleep"]);
    const wakeRes = await postPath(["projects", "project-1", "wake"]);
    const reviveRes = await postPath(["projects", "project-1", "revive"]);
    const cancelRes = await postPath(["projects", "project-1", "cancel"]);

    expect(pauseRes.status).toBe(404);
    expect(resumeRes.status).toBe(404);
    expect(sleepRes.status).toBe(404);
    expect(wakeRes.status).toBe(404);
    expect(reviveRes.status).toBe(404);
    expect(cancelRes.status).toBe(404);
    expect(setAgentIntentInternal).not.toHaveBeenCalled();
    expect(setPowerIntentInternal).not.toHaveBeenCalled();
    expect(archiveProjectInternal).not.toHaveBeenCalled();
  });

  it("exposes a narrow legacy sourceConfig recipe normalization surface", async () => {
    const normalizeRes = await postPath(["projects", "project-1", "source-config", "normalize-legacy-recipe"]);

    expect(normalizeRes.status).toBe(200);
    expect(normalizeLegacySourceConfigRecipeInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("exposes required-secret add/remove endpoints", async () => {
    const addRes = await postPath(["projects", "project-1", "required-secrets", "add"], {
      key: "TELEGRAM_BOT_TOKEN",
      description: "telegram token",
    });
    const removeRes = await postPath(["projects", "project-1", "required-secrets", "remove"], {
      key: "TELEGRAM_BOT_TOKEN",
    });

    expect(addRes.status).toBe(200);
    expect(removeRes.status).toBe(200);
    expect(addRequiredSecret).toHaveBeenCalledWith("project-1", "TELEGRAM_BOT_TOKEN", "telegram token");
    expect(removeRequiredSecret).toHaveBeenCalledWith("project-1", "TELEGRAM_BOT_TOKEN");
  });

  it("forces preview restore into Agent OFF + preview-only runtime claim without relaunch", async () => {
    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {
      action: "preview_restore",
    });

    expect(attemptRes.status).toBe(200);
    expect(setAgentIntentInternal).toHaveBeenCalledWith("project-1", "OFF", INTERNAL_ACTION_TOKEN);
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "preview_restore",
      }),
      expect.objectContaining({
        provisionedAt: null,
        clearInfraBlocker: true,
        preserveOutcome: true,
      }),
    );
    expect(setPowerIntentInternal).not.toHaveBeenCalled();
  });

  it("does not gate explicit recovery actions on diagnosis", async () => {
    vi.mocked(diagnoseRecoverySnapshot).mockReturnValueOnce({
      cohort: "healthy",
      mismatches: [],
      suggestedAction: "none",
    } as any);

    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {
      action: "preview_restore",
    });

    expect(attemptRes.status).toBe(200);
    expect(setAgentIntentInternal).toHaveBeenCalledWith("project-1", "OFF", INTERNAL_ACTION_TOKEN);
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        trigger: "preview_restore",
      }),
      expect.objectContaining({
        preserveOutcome: true,
      }),
    );
  });

  it("requires an explicit recovery action", async () => {
    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {});
    const payload = await attemptRes.json();

    expect(attemptRes.status).toBe(400);
    expect(payload).toEqual({ error: "Explicit recovery action is required" });
    expect(loadRecoverySnapshot).not.toHaveBeenCalled();
  });

  it("clears latest failed ensure_running lease during recreate_runtime even without a live container", async () => {
    const runLogCreate = vi.fn().mockResolvedValue({});
    const runtimeIntentFindFirst = vi.fn().mockResolvedValue({ id: "ri-2", state: "FAILED", action: "ensure_running" });
    const runtimeIntentDelete = vi.fn().mockResolvedValue({});
    const runtimeIntentDeleteMany = vi.fn().mockResolvedValue({ count: 7 });

    vi.mocked(loadRecoverySnapshot).mockResolvedValueOnce({
      projectId: "project-1",
      project: {
        id: "project-1",
        name: "Demo",
        archivedAt: null,
        runnerBackend: "local",
        previewUrl: null,
        containerName: null,
        workerHost: null,
        lastError: "preview start failed",
        startedAt: null,
        finishedAt: null,
        lastHeartbeat: null,
      },
      component: {
        id: "comp-1",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        lastOutcomeAt: null,
        retryAt: null,
        provisionedAt: "2026-04-18T00:31:00.000Z",
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
        workerHost: null,
        lastHeartbeat: null,
        retryCount: 0,
      },
      worker: {
        workerUrl: "http://worker.local",
        inspectStatus: "not_found",
        inspectSummary: null,
        parity: null,
        errors: null,
        logTail: null,
      },
      previewReachability: {
        classification: "unreachable",
        url: null,
        status: null,
        error: "No preview URL",
      },
    } as any);

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({
      runtimeIntent: {
        findFirst: runtimeIntentFindFirst,
        delete: runtimeIntentDelete,
        deleteMany: runtimeIntentDeleteMany,
      },
      runLog: {
        create: runLogCreate,
      },
    }));

    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {
      action: "recreate_runtime",
    });

    expect(attemptRes.status).toBe(200);
    expect(removeContainerInternal).not.toHaveBeenCalled();
    expect(runtimeIntentDelete).not.toHaveBeenCalled();
    expect(runtimeIntentFindFirst).not.toHaveBeenCalled();
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "recreate_runtime",
      }),
      expect.objectContaining({ provisionedAt: null, preserveOutcome: true }),
    );
    expect(finalizeRecoveryAttemptReport).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recreate_runtime" }),
      expect.anything(),
      expect.objectContaining({
        executed: true,
        executedSteps: [
          "reset_runtime_for_fresh_start",
          "clear_blocking_start_runtime_intent_history",
          "queue_fresh_claim",
        ],
        errors: [],
      }),
    );
  });

  it("clears provisionedAt during recreate_runtime so the next app-on is a fresh launch", async () => {
    const runLogCreate = vi.fn().mockResolvedValue({});
    const runtimeIntentFindFirst = vi.fn().mockResolvedValue({ id: "ri-1", state: "ABANDONED" });
    const runtimeIntentDelete = vi.fn().mockResolvedValue({});
    const runtimeIntentDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(loadRecoverySnapshot).mockResolvedValueOnce({
      projectId: "project-1",
      project: {
        id: "project-1",
        name: "Demo",
        archivedAt: null,
        runnerBackend: "local",
        previewUrl: "https://preview-demo.arena.example.test",
        containerName: "preview-demo",
        workerHost: "worker-1",
        lastError: "ghost recovery abandoned",
        startedAt: "2026-04-17T09:00:00.000Z",
        finishedAt: null,
        lastHeartbeat: "2026-04-17T09:19:00.000Z",
      },
      component: {
        id: "comp-1",
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: ["INFRA"],
        lastOutcome: null,
        lastOutcomeAt: null,
        retryAt: "2026-04-17T09:25:00.000Z",
        provisionedAt: "2026-04-17T08:59:00.000Z",
        previewHealth: "UNHEALTHY",
        previewCheckedAt: "2026-04-17T09:20:00.000Z",
        previewUrl: "https://preview-demo.arena.example.test",
        containerName: "preview-demo",
        workerHost: "worker-1",
        lastHeartbeat: "2026-04-17T09:19:00.000Z",
        retryCount: 3,
      },
      worker: {
        workerUrl: "http://worker.local",
        inspectStatus: "not_found",
        inspectSummary: null,
        parity: null,
        errors: null,
        logTail: null,
      },
      previewReachability: {
        classification: "unreachable",
        url: null,
        status: null,
        error: "No preview URL",
      },
    } as any);

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({
      runtimeIntent: {
        findFirst: runtimeIntentFindFirst,
        delete: runtimeIntentDelete,
        deleteMany: runtimeIntentDeleteMany,
      },
      runLog: {
        create: runLogCreate,
      },
    }));

    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {
      action: "recreate_runtime",
    });

    expect(attemptRes.status).toBe(200);
    expect(removeContainerInternal).not.toHaveBeenCalled();
    expect(runtimeIntentFindFirst).not.toHaveBeenCalled();
    expect(runtimeIntentDelete).not.toHaveBeenCalled();
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "recreate_runtime",
      }),
      expect.objectContaining({ provisionedAt: null, preserveOutcome: true }),
    );
    expect(runLogCreate).toHaveBeenCalledOnce();
    expect(JSON.parse(runLogCreate.mock.calls[0]?.[0].data.detail)).toEqual({
      source: "admin",
      trigger: "recreate_runtime",
      reason: "Explicit operator recreate of runtime container before fresh claim",
      before: {
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: "2026-04-17T08:59:00.000Z",
        blockers: ["INFRA"],
        containerName: "preview-demo",
        previewUrl: "https://preview-demo.arena.example.test",
        workerHost: "worker-1",
      },
      after: {
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: null,
        blockers: [],
        containerName: null,
        previewUrl: null,
        workerHost: null,
      },
      error: null,
    });
    expect(finalizeRecoveryAttemptReport).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recreate_runtime" }),
      expect.anything(),
      expect.objectContaining({
        executed: true,
        executedSteps: [
          "reset_runtime_for_fresh_start",
          "clear_blocking_start_runtime_intent_history",
        ],
        errors: [],
      }),
    );
  });

  it("preserves previous terminal outcome during agent-on recreate_runtime so maintenance does not imply loop work", async () => {
    const runLogCreate = vi.fn().mockResolvedValue({});
    const runtimeIntentDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

    vi.mocked(loadRecoverySnapshot).mockResolvedValueOnce({
      projectId: "project-1",
      component: {
        id: "comp-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "STOPPED",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
        lastOutcomeAt: "2026-04-17T09:20:00.000Z",
        retryAt: null,
        provisionedAt: "2026-04-17T08:59:00.000Z",
        previewHealth: "UNHEALTHY",
        previewCheckedAt: "2026-04-17T09:20:00.000Z",
        previewUrl: null,
        containerName: null,
        workerHost: "local",
        lastHeartbeat: "2026-04-17T09:19:00.000Z",
        retryCount: 0,
      },
      worker: {
        workerUrl: "http://worker.local",
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
      },
    } as any);

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({
      runtimeIntent: {
        deleteMany: runtimeIntentDeleteMany,
      },
      runLog: {
        create: runLogCreate,
      },
    }));

    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {
      action: "recreate_runtime",
    });

    expect(attemptRes.status).toBe(200);
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "recreate_runtime",
      }),
      expect.objectContaining({ provisionedAt: null, preserveOutcome: true }),
    );
  });

  it("recreates runtime by removing the existing container and clearing runtime identity", async () => {
    const runLogCreate = vi.fn().mockResolvedValue({});
    const runtimeIntentDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(loadRecoverySnapshot).mockResolvedValueOnce({
      projectId: "project-1",
      project: {
        id: "project-1",
        name: "Demo",
        archivedAt: null,
        runnerBackend: "local",
        previewUrl: "https://preview-demo.arena.example.test",
        containerName: "preview-demo",
        workerHost: "worker-1",
        lastError: null,
        startedAt: "2026-04-17T09:00:00.000Z",
        finishedAt: null,
        lastHeartbeat: "2026-04-17T09:19:00.000Z",
      },
      component: {
        id: "comp-1",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["INFRA"],
        lastOutcome: null,
        lastOutcomeAt: null,
        retryAt: "2026-04-17T09:25:00.000Z",
        provisionedAt: "2026-04-17T08:59:00.000Z",
        previewHealth: "UNHEALTHY",
        previewCheckedAt: "2026-04-17T09:20:00.000Z",
        previewUrl: "https://preview-demo.arena.example.test",
        containerName: "preview-demo",
        workerHost: "worker-1",
        lastHeartbeat: "2026-04-17T09:19:00.000Z",
        retryCount: 3,
      },
      worker: {
        workerUrl: "http://worker.local",
        inspectStatus: "running",
        inspectSummary: null,
        parity: null,
        errors: null,
        logTail: null,
      },
      previewReachability: {
        classification: "unreachable",
        url: null,
        status: null,
        error: "No preview URL",
      },
    } as any);

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (cb: any) => cb({
      runtimeIntent: {
        deleteMany: runtimeIntentDeleteMany,
      },
      runLog: {
        create: runLogCreate,
      },
    }));

    const attemptRes = await postPath(["projects", "project-1", "recovery", "attempt"], {
      action: "recreate_runtime",
    });

    expect(attemptRes.status).toBe(200);
    expect(removeContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "recreate_runtime",
      }),
      expect.objectContaining({ provisionedAt: null, preserveOutcome: true }),
    );
    expect(runLogCreate).toHaveBeenCalledOnce();

    expect(finalizeRecoveryAttemptReport).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recreate_runtime" }),
      expect.anything(),
      expect.objectContaining({
        executed: true,
        executedSteps: [
          "remove_existing_container",
          "reset_runtime_for_fresh_start",
          "clear_blocking_start_runtime_intent_history",
          "queue_fresh_claim",
        ],
        errors: [],
      }),
    );
  });

  it("exposes explicit project visibility control", async () => {
    const visibilityRes = await postPath(["projects", "project-1", "visibility"], { visibility: "featured" });

    expect(visibilityRes.status).toBe(200);
    expect(setProjectVisibilityInternal).toHaveBeenCalledWith("project-1", "featured", INTERNAL_ACTION_TOKEN);
  });

  it("exposes explicit project model control without relaunch", async () => {
    vi.mocked(setProjectModelInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      model: "claude-opus-4-8",
      modelId: "opus-4-8",
    } as any);

    const modelRes = await postPath(["projects", "project-1", "model"], { model: "opus-4-8" });

    expect(modelRes.status).toBe(200);
    expect(setProjectModelInternal).toHaveBeenCalledWith("project-1", "opus-4-8", INTERNAL_ACTION_TOKEN);
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(relaunchProjectWithOverridesInternal).not.toHaveBeenCalled();
  });

  it("exposes explicit project runtime-system control without relaunch", async () => {
    vi.mocked(setProjectRuntimeSystemInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      modelId: "gpt-55",
      toolId: "tool-codex",
      agentLoopVersionId: "ralph-v2",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    } as any);

    const res = await postPath(["projects", "project-1", "runtime-system"], {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      toolId: "tool-codex",
      providerBillingMode: "platform_credentials",
      codexAuthMode: "subscription",
    });

    expect(res.status).toBe(200);
    expect(setProjectRuntimeSystemInternal).toHaveBeenCalledWith("project-1", {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      toolId: "tool-codex",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
    }, INTERNAL_ACTION_TOKEN);
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(relaunchProjectWithOverridesInternal).not.toHaveBeenCalled();
  });

  it("exposes explicit project source snapshot control without relaunch", async () => {
    const commitSha = "298adb82e6f8b2dcc0df7026c011a90d514373d8";
    vi.mocked(setProjectSourceSnapshotInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      previousCommitSha: "38f10717374c27cafdae5a4cb42ff82608a38399",
      commitSha,
      repoUrl: "https://github.com/example/project",
      repoBranch: "arena/project-project-1",
    } as any);

    const sourceSnapshotRes = await postPath(["projects", "project-1", "source-snapshot"], { commitSha });

    expect(sourceSnapshotRes.status).toBe(200);
    expect(setProjectSourceSnapshotInternal).toHaveBeenCalledWith("project-1", commitSha, INTERNAL_ACTION_TOKEN);
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(relaunchProjectWithOverridesInternal).not.toHaveBeenCalled();
  });

  it("exposes explicit project runtime auth mode control without relaunch", async () => {
    vi.mocked(setProjectRuntimeAuthModesInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    } as any);

    const authModeRes = await postPath(["projects", "project-1", "runtime-auth-modes"], {
      codexAuthMode: "subscription",
    });

    expect(authModeRes.status).toBe(200);
    expect(setProjectRuntimeAuthModesInternal).toHaveBeenCalledWith(
      "project-1",
      { codexAuthMode: "subscription" },
      INTERNAL_ACTION_TOKEN,
    );
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(relaunchProjectWithOverridesInternal).not.toHaveBeenCalled();
  });

  it("exposes explicit project visual evidence mode control without relaunch", async () => {
    vi.mocked(setProjectVisualEvidenceModeInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      previousVisualEvidenceMode: "off",
      visualEvidenceMode: "new_tasks_only",
      visualWorkbenchEvidenceAutomation: "enabled",
    } as any);

    const visualModeRes = await postPath(["projects", "project-1", "visual-evidence-mode"], {
      visualEvidenceMode: "new_tasks_only",
    });

    expect(visualModeRes.status).toBe(200);
    expect(setProjectVisualEvidenceModeInternal).toHaveBeenCalledWith(
      "project-1",
      "new_tasks_only",
      INTERNAL_ACTION_TOKEN,
    );
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
    expect(relaunchProjectWithOverridesInternal).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/ctl read-side ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.projectUpdateOutbox.findMany).mockResolvedValue([]);
    vi.mocked(prisma.projectPersonalNotificationOutbox.findMany).mockResolvedValue([]);
    vi.mocked(getProjectOperatorSnapshotForViewer).mockResolvedValue(null as any);
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({ status: "not_found" } as any);
    vi.mocked(getProjectSpecArtifactAudit).mockResolvedValue(null as any);
    vi.mocked(readProjectPreviewGeneration).mockResolvedValue({
      ok: true,
      generation: "source:refresh-9",
    });
  });

  it("allows the narrow token to read preview-status", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    try {
      const response = await getPath(
        ["projects", "project-1", "preview-status"],
        "",
        { "x-arena-preview-refresh-token": "preview-secret" },
      );
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload).toEqual({
        projectId: "project-1",
        generation: "source:refresh-9",
        observedAt: expect.any(String),
      });
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("returns 503 without generation when preview runtime is unavailable", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    vi.mocked(readProjectPreviewGeneration).mockResolvedValue({
      ok: false,
      error: "Project preview runtime is not running",
    });
    try {
      const response = await getPath(
        ["projects", "project-1", "preview-status"],
        "",
        { "x-arena-preview-refresh-token": "preview-secret" },
      );
      const payload = await response.json();
      expect(response.status).toBe(503);
      expect(payload).toEqual({ error: "Project preview runtime is not running" });
      expect(payload).not.toHaveProperty("generation");
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("rejects preview-status outside the narrow token project allowlist", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-2";
    try {
      const response = await getPath(
        ["projects", "project-1", "preview-status"],
        "",
        { "x-arena-preview-refresh-token": "preview-secret" },
      );
      expect(response.status).toBe(403);
      expect(readProjectPreviewGeneration).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("returns 503 for preview-status when the narrow token is not configured", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    try {
      const response = await getPath(
        ["projects", "project-1", "preview-status"],
        "",
        { "x-arena-preview-refresh-token": "preview-secret" },
      );
      expect(response.status).toBe(503);
      expect(readProjectPreviewGeneration).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("rejects the narrow preview token on any other GET path", async () => {
    const previousToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    const previousProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    try {
      const response = await getPath(
        ["projects", "project-1", "health"],
        "",
        { "x-arena-preview-refresh-token": "preview-secret" },
      );
      expect(response.status).toBe(403);
      expect(readProjectPreviewGeneration).not.toHaveBeenCalled();
    } finally {
      if (previousToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
      else process.env.ARENA_PREVIEW_REFRESH_TOKEN = previousToken;
      if (previousProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
      else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = previousProjects;
    }
  });

  it("exposes sanitized authd health without provider auth values", async () => {
    vi.mocked(getAuthdHealthSnapshot).mockResolvedValueOnce({
      configured: true,
      available: true,
      ok: false,
      error: null,
      providers: {
        codex: {
          provider: "codex",
          source: "codex-auth-json",
          status: "missing",
          version: null,
          checkedAt: "2026-06-11T01:26:52.188Z",
          detail: "Codex auth.json is missing or empty.",
          metadata: {
            accessTokenExpiresAt: null,
            lastRefresh: null,
            hasRefreshToken: false,
            refreshRequired: false,
          },
        },
      },
    });

    const response = await getPath(["authd", "health"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getAuthdHealthSnapshot).toHaveBeenCalledWith();
    expect(payload).toEqual({
      configured: true,
      available: true,
      ok: false,
      error: null,
      providers: {
        codex: {
          provider: "codex",
          source: "codex-auth-json",
          status: "missing",
          version: null,
          checkedAt: "2026-06-11T01:26:52.188Z",
          detail: "Codex auth.json is missing or empty.",
          metadata: {
            accessTokenExpiresAt: null,
            lastRefresh: null,
            hasRefreshToken: false,
            refreshRequired: false,
          },
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("CODEX_AUTH_JSON");
  });

  it("lists projects from component-owned runtime identity without project-row ballast", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValueOnce([{
      id: "project-1",
      name: "Demo",
      mode: "PROJECT",
      archivedAt: null,
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.4",
      runnerBackend: "local",
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:01:00.000Z"),
      estimatedCostUsd: null,
      components: [{
        kind: "app",
        workerHost: null,
        previewUrl: null,
        lastHeartbeat: null,
      }],
      budget: null,
      vpsHost: null,
    }] as any);

    const response = await getPath(["projects"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload[0]).toEqual(expect.objectContaining({
      id: "project-1",
      workerHost: null,
      previewUrl: null,
      lastHeartbeat: null,
    }));
    expect(payload[0]).not.toHaveProperty("lastError");
  });

  it("exposes latest terminal signal on the project health endpoint", async () => {
    vi.mocked(getProjectState).mockResolvedValueOnce({
      id: "project-1",
      name: "Demo",
      archivedAt: null,
      components: [],
      latestTerminalSignal: {
        trigger: "terminal_failed",
        reason: "Verification timed out after 10 minutes",
        at: "2026-04-22T12:34:56.000Z",
      },
    } as any);
    vi.mocked(getWorkerSnapshot).mockResolvedValueOnce({
      projectId: "project-1",
      workerUrl: "http://worker.local",
      inspect: null,
      logs: null,
      parity: null,
      errors: {
        meta: null,
        inspect: null,
        logs: null,
      },
      error: null,
    } as any);

    const response = await getPath(["projects", "project-1", "health"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.project).toEqual(expect.objectContaining({
      id: "project-1",
      latestTerminalSignal: {
        trigger: "terminal_failed",
        reason: "Verification timed out after 10 minutes",
        at: "2026-04-22T12:34:56.000Z",
      },
    }));
  });

  it("exposes a narrow project operator snapshot endpoint", async () => {
    vi.mocked(getProjectOperatorSnapshotForViewer).mockResolvedValueOnce({
      id: "project-1",
      name: "Demo",
      archivedAt: null,
      repoUrl: "https://github.com/example/demo",
      repoBranch: "arena/project-project-1",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-demo",
        workerHost: "local",
        lastHeartbeat: "2026-04-21T20:00:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    } as any);

    const response = await getPath(["projects", "project-1", "snapshot"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getProjectOperatorSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: null,
      hasBypass: true,
    });
    expect(payload).toEqual({
      id: "project-1",
      name: "Demo",
      archivedAt: null,
      repoUrl: "https://github.com/example/demo",
      repoBranch: "arena/project-project-1",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 0,
        containerName: "preview-demo",
        workerHost: "local",
        lastHeartbeat: "2026-04-21T20:00:00.000Z",
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
    });
    expect(payload).not.toHaveProperty("runLogs");
    expect(payload).not.toHaveProperty("specs");
    expect(payload).not.toHaveProperty("assets");
    expect(payload).not.toHaveProperty("secrets");
    expect(payload).not.toHaveProperty("accessCapabilities");
  });

  it("exposes spec artifact audit through the operator read-side endpoint", async () => {
    vi.mocked(getProjectSpecArtifactAudit).mockResolvedValueOnce({
      projectId: "project-1",
      projectName: "Demo",
      classification: "current_v1_artifact",
      runnerReady: true,
      storageMode: "accepted_artifact_v1",
      latestSpec: {
        specId: "spec-1",
        specVersionId: "spec-version-3",
        version: 3,
        sourceProjectId: "tg-project-1",
        sourceVersion: 3,
        metadataHash: "sha256:metadata",
      },
      why: ["Latest spec metadata is a valid v1 AcceptedSpecArtifact."],
      allowedActions: ["no_action", "launch_or_resume"],
      recommendedNextAction: "launch_or_resume",
      operatorNotes: ["Do not derive public task projections from Ralph/progress steps."],
    } as any);

    const response = await getPath(["projects", "project-1", "spec-artifact-audit"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getProjectSpecArtifactAudit).toHaveBeenCalledWith("project-1");
    expect(payload).toMatchObject({
      projectId: "project-1",
      classification: "current_v1_artifact",
      runnerReady: true,
      recommendedNextAction: "launch_or_resume",
    });
    expect(payload).not.toHaveProperty("acceptedDelta");
    expect(payload).not.toHaveProperty("sourceProvenance");
  });

  it("exposes runtime claim dry-run through the operator read-side endpoint", async () => {
    vi.mocked(buildRuntimeIntentClaimDryRun).mockResolvedValueOnce({
      schemaVersion: "ra-356.runtime-claim-dry-run.v1",
      projectId: "project-1",
      host: "local",
      backend: "local",
      capacity: 2,
      activePreviewContainersSupplied: true,
      evaluatedAt: "2026-06-06T00:00:00.000Z",
      candidate: null,
      policyDecision: null,
      wouldCreateLease: false,
      wouldClaim: null,
      launch: {
        required: false,
        status: "not_required",
        sanitized: true,
        payload: null,
        message: null,
      },
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
      evidenceNotes: [],
    } as any);

    const response = await getPath(
      ["projects", "project-1", "runtime-claim-dry-run"],
      "?host=local&capacity=2&activePreviewContainers=preview-demo,preview-other",
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(buildRuntimeIntentClaimDryRun).toHaveBeenCalledWith({
      projectId: "project-1",
      host: "local",
      capacity: 2,
      activePreviewContainers: ["preview-demo", "preview-other"],
    });
    expect(payload).toMatchObject({
      schemaVersion: "ra-356.runtime-claim-dry-run.v1",
      projectId: "project-1",
      capacity: 2,
      launch: {
        sanitized: true,
      },
    });
  });

  it("exposes runner init readiness through the operator read-side endpoint", async () => {
    vi.mocked(buildRunnerInitReadinessSummary).mockResolvedValueOnce({
      schemaVersion: "ra-356.runner-init-readiness.v1",
      projectId: "project-1",
      available: true,
      project: {
        id: "project-1",
        name: "Demo",
        hasPendingLoopWork: true,
        agent: "codex",
        agentImpl: "ralph",
        model: "gpt-5.4",
        providerBillingMode: "byok",
        commitSha: null,
        agentIntent: "ON",
      },
      repo: {
        present: true,
        baseBranch: "main",
        projectBranch: "arena/project-project-1",
        commitSha: null,
      },
      specs: { count: 1, hash: "specs-hash" },
      assets: { count: 0, hash: "assets-empty" },
      secrets: { count: 1 },
      capabilities: { count: 1, values: ["progress"] },
      command: {
        present: true,
        source: "agent_loop_version",
        legacyPathNormalized: true,
        requiresLoopSource: true,
        loopSourcePresent: true,
        unresolvedPlaceholders: [],
        resolvable: true,
      },
      loopSource: {
        present: true,
        ref: "v1.4.0",
        installCommandPresent: true,
      },
      blockers: [],
      evidenceNotes: [],
    } as any);

    const response = await getPath(["projects", "project-1", "runner-init-readiness"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(buildRunnerInitReadinessSummary).toHaveBeenCalledWith("project-1");
    expect(payload).toMatchObject({
      schemaVersion: "ra-356.runner-init-readiness.v1",
      projectId: "project-1",
      command: {
        resolvable: true,
      },
      secrets: {
        count: 1,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("commandTemplate");
    expect(JSON.stringify(payload)).not.toContain("encryptedValue");
  });

  it("exposes current proof review read-side without raw asset bytes or outbox history", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-1",
          name: "Demo",
          slug: "demo",
        },
        execution: {
          statusSummary: {
            stage: "completed",
            title: "Готово к просмотру",
            summary: "Активные изменения завершены.",
          },
          activeChangeBatches: [{
            id: "batch-62",
            sourceVersion: 62,
            targetSpecVersion: 62,
            artifactId: "artifact-62",
            diffId: "diff-62",
            summary: "BUG-007 updated",
            acceptedAt: "2026-06-03T04:00:24.341Z",
            status: "completed",
            workItemCount: 1,
            completedItemCount: 1,
            pendingItemCount: 0,
            changeCounts: {
              total: 1,
              add: 0,
              modify: 1,
              remove: 0,
              fix: 0,
              question: 0,
              superseded: 0,
              other: 0,
            },
          }],
          latestAcceptedUpdate: {
            sourceVersion: 62,
            targetSpecVersion: 62,
            artifactId: "artifact-62",
            diffId: "diff-62",
            summary: "BUG-007 updated",
            diffItemCount: 1,
            workItemCount: 1,
            acceptedAt: "2026-06-03T04:00:24.341Z",
          },
        },
        app: {
          blockers: [],
        },
        tasks: [{
          id: "TASK-BUG-007",
          label: "Fix Wide Mobile Practice",
          status: "completed",
          orderIndex: 0,
          source: {
            sourceVersion: 62,
            targetSpecVersion: 62,
            artifactId: "artifact-62",
            diffId: "diff-62",
            diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
            changeType: "fix",
            feedbackId: "BUG-007",
          },
        }],
        proofReviews: [{
          id: "proof:TASK-BUG-007",
          taskId: "TASK-BUG-007",
          taskLabel: "Fix Wide Mobile Practice",
          status: "unavailable",
          action: {
            kind: "review_screenshots",
            label: "Проверить скриншоты",
          },
          source: {
            diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
          },
          before: {
            role: "before",
            kind: "screenshot",
            availability: "available",
            url: "/api/internal/projects/project-1/assets/before/download",
            assetId: "before-asset",
            contentType: "image/png",
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capturedAt: "2026-06-03T04:01:10.368Z",
            unavailableReason: null,
          },
          after: {
            role: "after",
            kind: "screenshot",
            availability: "available",
            url: "/api/internal/projects/project-1/assets/after/download",
            assetId: "after-asset",
            contentType: "image/png",
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capturedAt: "2026-06-03T04:07:29.458Z",
            unavailableReason: null,
          },
        }],
        visualEvidenceReviews: [{
          id: "visual:abc123",
          taskId: "TASK-BUG-007",
          taskLabel: "Fix Wide Mobile Practice",
          status: "unassessed",
          action: {
            kind: "review_visual_evidence",
            label: "Проверить скриншоты",
            href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
          },
          sourceEvidenceRef: "visual-workbench-capture:wide-mobile.practice:desktop:aaaaaaaaaaaa",
          feedbackItemIds: ["BUG-007"],
          diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
          sourceKind: "visual_workbench",
          target: {
            route: "/visual-workbench/wide-mobile.practice",
            viewport: { width: 1280, height: 800 },
            claim: "Wide mobile practice renders correctly",
            state: null,
            interaction: null,
          },
          observedAt: "2026-06-03T04:07:29.458Z",
          summary: "Visual Workbench story captured.",
          artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          artifact: {
            availability: "available",
            url: "/api/projects/project-1/visual-evidence/visual:abc123/artifact",
            contentType: "image/png",
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            unavailableReason: null,
          },
          assessments: [],
        }],
      },
    } as any);

    const response = await getPath(["projects", "project-1", "proof-reviews"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: null,
      hasBypass: true,
      surface: "telegram",
    });
    expect(payload).toMatchObject({
      project: {
        id: "project-1",
        name: "Demo",
        slug: "demo",
      },
      latestAcceptedUpdate: {
        sourceVersion: 62,
      },
      visualEvidenceReadiness: {
        status: "available",
        reasonCode: "visual_evidence_reviews_available",
        counts: {
          visualEvidenceReviewCount: 1,
          taskCount: 1,
          taskStatusCounts: {
            completed: 1,
          },
        },
        blockers: [],
      },
      proofReviews: [{
        id: "proof:TASK-BUG-007",
        status: "unavailable",
        before: {
          availability: "available",
          assetId: "before-asset",
        },
        after: {
          availability: "available",
          assetId: "after-asset",
        },
      }],
      visualEvidenceReviews: [{
        id: "visual:abc123",
        status: "unassessed",
        action: {
          kind: "review_visual_evidence",
          label: "Проверить скриншоты",
        },
      }],
    });
    expect(payload).not.toHaveProperty("updates");
    expect(payload).not.toHaveProperty("personalNotifications");
    expect(payload).not.toHaveProperty("assets");
    expect(JSON.stringify(payload)).not.toContain("assets/proof/");
  });

  it("explains absent visual evidence reviews without creating a screenshot action", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-waiting",
          name: "Waiting Demo",
          slug: "waiting-demo",
        },
        app: {
          blockers: ["RATE_LIMIT"],
        },
        execution: {
          statusSummary: {
            stage: "waiting",
            title: "Ждём окно модели",
            summary: "Рабочие задачи: 0 из 2.",
          },
          latestAcceptedUpdate: {
            sourceVersion: 1,
            targetSpecVersion: 1,
            artifactId: "artifact-1",
            diffId: "diff-1",
            summary: "Create ordinary-web UI",
            diffItemCount: 2,
            workItemCount: 2,
            acceptedAt: "2026-06-11T08:00:00.000Z",
          },
          activeChangeBatches: [{
            id: "batch-1",
            sourceVersion: 1,
            targetSpecVersion: 1,
            artifactId: "artifact-1",
            diffId: "diff-1",
            summary: "Create ordinary-web UI",
            acceptedAt: "2026-06-11T08:00:00.000Z",
            status: "pending",
            workItemCount: 2,
            completedItemCount: 0,
            pendingItemCount: 2,
            changeCounts: {
              total: 2,
              add: 2,
              modify: 0,
              remove: 0,
              fix: 0,
              question: 0,
              superseded: 0,
              other: 0,
            },
          }],
        },
        tasks: [{
          id: "task-001",
          label: "Build jam room shell",
          status: "pending",
          orderIndex: 0,
          source: null,
        }, {
          id: "task-002",
          label: "Add Workbench stories",
          status: "pending",
          orderIndex: 1,
          source: null,
        }],
        proofReviews: [],
        visualEvidenceReviews: [],
      },
    } as any);

    const response = await getPath(["projects", "project-waiting", "proof-reviews"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.visualEvidenceReadiness).toMatchObject({
      status: "not_available",
      reasonCode: "work_waiting_for_blocker",
      blockers: ["RATE_LIMIT"],
      counts: {
        visualEvidenceReviewCount: 0,
        activeWorkItemCount: 2,
        completedActiveWorkItemCount: 0,
        taskStatusCounts: {
          pending: 2,
        },
      },
    });
    expect(payload.visualEvidenceReviews).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("review_visual_evidence");
    expect(JSON.stringify(payload.visualEvidenceReadiness)).not.toContain("assets/proof/");
  });

  it("checks current visual evidence artifacts through the download owner without returning bytes", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-1",
          name: "Demo",
          slug: "demo",
        },
        app: {
          blockers: [],
        },
        execution: {
          statusSummary: {
            stage: "completed",
            title: "Готово к просмотру",
            summary: "Активные изменения завершены.",
          },
          latestAcceptedUpdate: {
            sourceVersion: 62,
            targetSpecVersion: 62,
            artifactId: "artifact-62",
            diffId: "diff-62",
            summary: "BUG-007 updated",
            diffItemCount: 1,
            workItemCount: 1,
            acceptedAt: "2026-06-03T04:00:24.341Z",
          },
          activeChangeBatches: [],
        },
        tasks: [{
          id: "TASK-BUG-007",
          label: "Fix Wide Mobile Practice",
          status: "completed",
          orderIndex: 0,
          source: {
            sourceVersion: 62,
            targetSpecVersion: 62,
            artifactId: "artifact-62",
            diffId: "diff-62",
            diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
            changeType: "fix",
            feedbackId: "BUG-007",
          },
        }],
        proofReviews: [],
        visualEvidenceReviews: [{
          id: "visual:abc123",
          taskId: "TASK-BUG-007",
          taskLabel: "Fix Wide Mobile Practice",
          status: "unassessed",
          action: {
            kind: "review_visual_evidence",
            label: "Проверить скриншоты",
            href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
          },
          sourceEvidenceRef: "visual-workbench-capture:wide-mobile.practice:desktop:aaaaaaaaaaaa",
          feedbackItemIds: ["BUG-007"],
          diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
          sourceKind: "visual_workbench",
          target: {
            route: "/visual-workbench/wide-mobile.practice",
            viewport: { width: 1280, height: 800 },
            claim: "Wide mobile practice renders correctly",
            state: null,
            interaction: null,
          },
          observedAt: "2026-06-03T04:07:29.458Z",
          summary: "Visual Workbench story captured.",
          artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          artifact: {
            availability: "available",
            url: "/api/projects/project-1/visual-evidence/visual%3Aabc123/artifact",
            contentType: "image/png",
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            unavailableReason: null,
          },
          assessments: [],
        }],
      },
    } as any);
    vi.mocked(getProjectVisualEvidenceArtifactForDownload).mockResolvedValueOnce({
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const response = await getPath(["projects", "project-1", "visual-evidence-artifact-check"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: null,
      hasBypass: true,
      surface: "telegram",
    });
    expect(getProjectVisualEvidenceArtifactForDownload).toHaveBeenCalledWith({
      projectId: "project-1",
      reviewId: "visual:abc123",
    });
    expect(payload).toMatchObject({
      artifactCheck: {
        status: "available",
        reviewCount: 1,
        downloadableCount: 1,
        notDownloadableCount: 0,
      },
      reviews: [{
        reviewId: "visual:abc123",
        taskId: "TASK-BUG-007",
        diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
        artifact: {
          availability: "available",
          contentType: "image/png",
        },
        download: {
          status: "downloadable",
          reasonCode: null,
          contentType: "image/png",
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          byteLength: 9,
        },
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("png-bytes");
    expect(JSON.stringify(payload)).not.toContain("assets/proof/");
  });

  it("reports absent visual evidence artifact checks without consulting raw folders", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-waiting",
          name: "Waiting Demo",
          slug: "waiting-demo",
        },
        app: {
          blockers: [],
        },
        execution: {
          statusSummary: {
            stage: "waiting",
            title: "Ждём работу",
            summary: "Рабочие задачи ещё не завершены.",
          },
          latestAcceptedUpdate: null,
          activeChangeBatches: [],
        },
        tasks: [],
        proofReviews: [],
        visualEvidenceReviews: [],
      },
    } as any);

    const response = await getPath(["projects", "project-waiting", "visual-evidence-artifact-check"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getProjectVisualEvidenceArtifactForDownload).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      artifactCheck: {
        status: "not_available",
        reviewCount: 0,
        downloadableCount: 0,
        notDownloadableCount: 0,
      },
      reviews: [],
    });
    expect(JSON.stringify(payload)).not.toContain(".ralph");
    expect(JSON.stringify(payload)).not.toContain(".arena");
  });

  it("reports unavailable visual evidence artifacts without running a raw fallback", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-1",
          name: "Demo",
          slug: "demo",
        },
        app: {
          blockers: [],
        },
        execution: {
          statusSummary: {
            stage: "completed",
            title: "Готово",
            summary: "Есть visual evidence review.",
          },
          latestAcceptedUpdate: null,
          activeChangeBatches: [],
        },
        tasks: [],
        proofReviews: [],
        visualEvidenceReviews: [{
          id: "visual:missing",
          taskId: "TASK-BUG-007",
          taskLabel: "Fix Wide Mobile Practice",
          status: "unassessed",
          action: {
            kind: "review_visual_evidence",
            label: "Проверить скриншоты",
            href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Amissing#project-visual-evidence",
          },
          sourceEvidenceRef: "visual-workbench-capture:wide-mobile.practice:desktop:bbbbbbbbbbbb",
          feedbackItemIds: ["BUG-007"],
          diffItemIds: ["DIFF-TELEGRAM:-1003676822421-62-BUG-007"],
          sourceKind: "visual_workbench",
          target: {
            route: "/visual-workbench/wide-mobile.practice",
            viewport: { width: 1280, height: 800 },
            claim: "Wide mobile practice renders correctly",
            state: null,
            interaction: null,
          },
          observedAt: "2026-06-03T04:07:29.458Z",
          summary: "Visual Workbench story captured.",
          artifactSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          artifact: {
            availability: "unavailable",
            url: null,
            contentType: null,
            sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            unavailableReason: "missing_artifact",
          },
          assessments: [],
        }],
      },
    } as any);

    const response = await getPath(["projects", "project-1", "visual-evidence-artifact-check"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getProjectVisualEvidenceArtifactForDownload).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      artifactCheck: {
        status: "not_downloadable",
        reviewCount: 1,
        downloadableCount: 0,
        notDownloadableCount: 1,
      },
      reviews: [{
        reviewId: "visual:missing",
        artifact: {
          availability: "unavailable",
          unavailableReason: "missing_artifact",
        },
        download: {
          status: "not_downloadable",
          reasonCode: "artifact_unavailable",
          byteLength: null,
        },
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("assets/proof/");
  });

  it("exposes a worker snapshot endpoint without bundling project truth", async () => {
    vi.mocked(getWorkerSnapshot).mockResolvedValueOnce({
      projectId: "project-1",
      workerUrl: "http://worker.local",
      meta: null,
      inspect: { status: "running", exitCode: 0, oomKilled: false },
      logs: ["line-1"],
      parity: null,
      errors: {
        meta: null,
        inspect: null,
        logs: null,
      },
      error: null,
    } as any);

    const response = await getPath(["projects", "project-1", "worker-snapshot"]);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      projectId: "project-1",
      workerUrl: "http://worker.local",
      inspect: { status: "running", exitCode: 0, oomKilled: false },
      logs: ["line-1"],
      error: null,
    }));
    expect(payload).not.toHaveProperty("project");
  });

  it("exposes project update delivery rows without rebuilding lifecycle truth", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      id: "project-1",
      name: "Demo",
      tgSpecSourceProjectId: "tg-project-1",
    } as any);
    vi.mocked(prisma.projectUpdateOutbox.findMany).mockResolvedValueOnce([{
      id: "update-1",
      eventType: "work.needs_evidence",
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
      dedupeKey: "work.needs_evidence:test",
      status: "SKIPPED",
      attempts: 1,
      payload: { outcome: "needs_evidence", reasonCode: "MANUAL" },
      externalMessageId: null,
      lastError: "Unsupported event type",
      createdAt: new Date("2026-05-15T00:00:00.000Z"),
      updatedAt: new Date("2026-05-15T00:00:10.000Z"),
      deliveredAt: new Date("2026-05-15T00:00:10.000Z"),
    }] as any);
    vi.mocked(prisma.projectPersonalNotificationOutbox.findMany).mockResolvedValueOnce([{
      id: "notification-1",
      recipientUserId: "user-1",
      channel: "telegram_private",
      eventType: "work.needs_evidence",
      requiredCapability: "project.secrets.manage",
      dedupeKey: "work.needs_evidence:personal",
      status: "SKIPPED",
      attempts: 1,
      payload: { outcome: "needs_evidence", reasonCode: "MANUAL" },
      externalMessageId: null,
      lastError: "Unsupported event type",
      createdAt: new Date("2026-05-15T00:00:01.000Z"),
      updatedAt: new Date("2026-05-15T00:00:11.000Z"),
      deliveredAt: new Date("2026-05-15T00:00:11.000Z"),
    }] as any);

    const response = await getPath(["projects", "project-1", "updates"], "?tail=5");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.projectUpdateOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: "project-1" },
      take: 5,
    }));
    expect(payload).toMatchObject({
      id: "project-1",
      name: "Demo",
      deliveryDiagnostics: {
        tgSpecSourceProjectId: "tg-project-1",
        arenaProjectUpdateEligible: true,
        latestProjectUpdate: {
          eventType: "work.needs_evidence",
          status: "SKIPPED",
          lastError: "Unsupported event type",
          externalMessageId: null,
        },
        latestPersonalNotification: {
          eventType: "work.needs_evidence",
          status: "SKIPPED",
          lastError: "Unsupported event type",
          externalMessageId: null,
        },
      },
      updates: [{
        eventType: "work.needs_evidence",
        status: "SKIPPED",
        payload: { outcome: "needs_evidence", reasonCode: "MANUAL" },
      }],
      personalNotifications: [{
        eventType: "work.needs_evidence",
        channel: "telegram_private",
        status: "SKIPPED",
      }],
    });
    expect(payload).not.toHaveProperty("app");
    expect(payload).not.toHaveProperty("runLogs");
  });
});

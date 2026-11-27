import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  projectReleaseArtifactFindMany: vi.fn(),
  resolveProjectAccess: vi.fn(),
  readProjectAssetBytes: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
    },
    projectReleaseArtifact: {
      findMany: mocks.projectReleaseArtifactFindMany,
    },
  },
}));

vi.mock("@/lib/project-access", () => ({
  resolveProjectAccess: mocks.resolveProjectAccess,
}));

vi.mock("@/lib/project-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-assets")>();
  return {
    ...actual,
    readProjectAssetBytes: mocks.readProjectAssetBytes,
  };
});

import {
  buildProjectInteractionSnapshot,
  getProjectInteractionSnapshotForViewer,
  getProjectVisualEvidenceArtifactForDownload,
} from "./project-interaction";
import { visualEvidenceAssetPathPrefixForReviewId } from "./project-assets";

const createdAt = new Date("2026-05-09T10:00:00.000Z");
const updatedAt = new Date("2026-05-09T10:05:00.000Z");
const visualDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(() => {
  mocks.projectFindUnique.mockReset();
  mocks.projectReleaseArtifactFindMany.mockReset();
  mocks.projectReleaseArtifactFindMany.mockResolvedValue([]);
  mocks.resolveProjectAccess.mockReset();
  mocks.readProjectAssetBytes.mockReset();
});

function access(capabilities: string[] = []) {
  return {
    canView: true,
    canManage: capabilities.some((capability) => capability !== "project.view"),
    canAccessPrivate: capabilities.length > 0,
    effectiveCapabilities: capabilities,
    hasCapability: (required: string) => capabilities.includes(required),
  } as any;
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Telegram Shop",
    slug: "telegram-shop",
    mode: "personal",
    visibility: "private",
    ownerScopeType: "user",
    ownerScopeId: "user-1",
    archivedAt: null,
    createdAt,
    updatedAt,
    tgSpecSourceProjectId: "tg-project-1",
    tgSpecMirrorSpecId: "spec-1",
    tgSpecLastImportedVersion: 3,
    agentImpl: "ralph",
    progressJson: JSON.stringify({
      state: "working",
      message: "Building preview",
      iteration: 2,
      featuresCompleted: 1,
      featuresTotal: 3,
      currentFeature: { description: "Checkout flow", debug: "must-not-leak" },
      recentFeatures: [
        { id: "feature-1", description: "Cart", debug: "must-not-leak" },
      ],
      debug: "must-not-leak",
      steps: [
        {
          id: "task-1",
          displayTitle: "Checkout",
          label: "Checkout flow",
          description: "Implement checkout flow\nwith concise manager-facing context",
          status: "in_progress",
          debug: "must-not-leak",
        },
        { id: "task-2", label: "Deploy preview", status: "pending" },
      ],
    }),
    requiredSecrets: JSON.stringify([
      { key: "TELEGRAM_BOT_TOKEN", description: "Bot token", blocking: true },
      { key: "STRIPE_SECRET_KEY", blocking: false, requestedAt: "2026-05-09T10:01:00.000Z" },
    ]),
    components: [{
      id: "component-1",
      kind: "app",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: updatedAt,
      retryAt: null,
      retryCount: 0,
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.test",
      workerHost: "local",
      lastHeartbeat: updatedAt,
      sourceConfig: null,
      runtimeConfig: { useRepoHead: true },
    }],
    vpsHost: null,
    agentLoopVersion: {
      version: "1.5.0",
      supportTier: "supported",
      agentLoop: { name: "ralph" },
    },
    specs: [{
      id: "spec-1",
      title: "Spec",
      content: "Build the product",
      orderIndex: 0,
      createdAt,
      updatedAt,
      versions: [{
        id: "spec-version-3",
        version: 3,
        content: "Build the product",
        message: "Accepted in Telegram",
        createdAt: updatedAt,
      }],
    }],
    assets: [{
      id: "asset-1",
      path: "assets/logo.png",
      originalName: "logo.png",
      contentType: "image/png",
      sizeBytes: 42,
      sha256: "hash",
      uploadedById: "tg-spec",
      createdAt,
      updatedAt,
    }],
    releaseArtifacts: [],
    secrets: [{
      id: "secret-1",
      key: "TELEGRAM_BOT_TOKEN",
      description: "Bot token",
      createdAt,
      updatedAt,
      encryptedValue: "must-not-leak",
    }],
    budget: { isEnabled: true, totalCreditsUsd: 25, usedCreditsUsd: 2 },
    runLogs: [{
      id: "run-log-1",
      event: "RUNNING",
      createdAt,
      detail: "secret=must-not-leak",
    }],
    events: [{
      id: "event-1",
      direction: "out",
      type: "required_secrets",
      userId: null,
      createdAt,
      payload: { token: "must-not-leak" },
    }],
    ...overrides,
  } as any;
}

function acceptedArtifactWithFeedback() {
  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: "SPEC-003",
    acceptedAt: "2026-05-16T12:00:00.000Z",
    source: {
      id: "SRC-003",
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-project-1",
      sourceVersion: 3,
      sourceRefType: "accepted_spec",
      sourceId: "tg-spec-version-3",
    },
    acceptedSpec: {
      id: "SPEC-003",
      version: 3,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: "Telegram Shop",
        sections: [],
        requirements: [],
        extensionBlocks: [{
          id: "SPEC-LEGACY-MARKDOWN",
          title: "Rendered spec",
          body: "Build the product",
          reason: "Test fixture.",
          sourceRefs: ["SRC-003"],
        }],
      },
      renderedMarkdown: "Build the product",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: ["SRC-003"],
    },
    acceptedDiff: {
      id: "DIFF-003",
      targetSpecVersion: 3,
      summary: "Feedback update",
      items: [{
        id: "DIFF-003-BUG-006",
        targetType: "feedback",
        targetId: "BUG-006",
        changeType: "reopened",
        workImpact: "requires_loop_work",
        summary: "Checkout still fails after previous loop claim.",
        sourceRefs: ["SRC-003"],
      }],
    },
    feedback: [{
      id: "BUG-006",
      title: "Checkout still fails",
      body: "Users still cannot complete checkout after the previous loop claim.",
      state: "reopened",
      reopenCount: 2,
      defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
      sourceRefs: ["SRC-003"],
    }],
    assumptions: [{
      id: "ASM-001",
      title: "AI provider",
      statement: "Production generation requires a real provider.",
      state: "corrected",
      sourceRefs: ["SRC-003"],
      outcome: {
        kind: "corrected_into_spec",
        acceptedDiffItemId: "DIFF-003-ASM-001",
        correctionSummary: "Use the configured production provider.",
      },
    }],
    secretRequirements: [],
    assets: [],
  };
}

function acceptedArtifactWithMixedWorkItems() {
  const artifact = acceptedArtifactWithFeedback() as any;
  artifact.acceptedDiff.items.push(
    {
      id: "DIFF-003-SPEC",
      targetType: "spec",
      targetId: "SPEC-003",
      changeType: "updated",
      workImpact: "requires_loop_work",
      summary: "Product checkout flow now requires Telegram WebApp launch.",
      sourceRefs: ["SRC-003"],
    },
    {
      id: "DIFF-003-ASM-001",
      targetType: "assumption",
      targetId: "ASM-001",
      changeType: "corrected",
      workImpact: "requires_loop_work",
      summary: "AI provider assumption was corrected.",
      sourceRefs: ["SRC-003"],
    },
  );
  return artifact;
}

function projectWithAcceptedVisualArtifact(overrides: Record<string, unknown> = {}) {
  return project({
    specs: [{
      id: "spec-1",
      title: "Spec",
      content: "Build the product",
      orderIndex: 0,
      createdAt,
      updatedAt,
      versions: [{
        id: "spec-version-3",
        version: 3,
        content: "Build the product",
        message: "Accepted in Telegram",
        createdAt: updatedAt,
        acceptedArtifact: acceptedArtifactWithMixedWorkItems(),
      }],
    }],
    ...overrides,
  });
}

function acceptedArtifactWithSpecWork(sourceVersion: number) {
  const suffix = String(sourceVersion).padStart(3, "0");
  const artifact = acceptedArtifactWithFeedback() as any;
  artifact.artifactId = `SPEC-${suffix}`;
  artifact.acceptedAt = `2026-05-16T12:0${sourceVersion}:00.000Z`;
  artifact.source.id = `SRC-${suffix}`;
  artifact.source.sourceVersion = sourceVersion;
  artifact.source.sourceId = `tg-spec-version-${sourceVersion}`;
  artifact.acceptedSpec.id = `SPEC-${suffix}`;
  artifact.acceptedSpec.version = sourceVersion;
  artifact.acceptedSpec.sourceRefs = [`SRC-${suffix}`];
  artifact.acceptedDiff = {
    id: `DIFF-${suffix}`,
    targetSpecVersion: sourceVersion,
    summary: `Spec update v${sourceVersion}`,
    items: [{
      id: `DIFF-${suffix}-SPEC`,
      targetType: "spec",
      targetId: `SPEC-${suffix}`,
      changeType: "updated",
      workImpact: "requires_loop_work",
      summary: `Spec work for v${sourceVersion}`,
      sourceRefs: [`SRC-${suffix}`],
    }],
  };
  artifact.feedback = [];
  artifact.assumptions = [];
  return artifact;
}

function acceptedArtifactWithRemovedSupersededWork() {
  const artifact = acceptedArtifactWithFeedback() as any;
  artifact.acceptedDiff = {
    id: "DIFF-005",
    targetSpecVersion: 5,
    summary: "Remove stale work",
    items: [
      {
        id: "DIFF-005-ASSET-OLD-LOGO",
        targetType: "asset",
        targetId: "ASSET-OLD-LOGO",
        changeType: "removed",
        workImpact: "requires_loop_work",
        summary: "Old logo asset was removed.",
        sourceRefs: ["SRC-003"],
      },
      {
        id: "DIFF-005-ASM-001",
        targetType: "assumption",
        targetId: "ASM-001",
        changeType: "superseded",
        workImpact: "requires_loop_work",
        summary: "AI provider assumption was superseded.",
        sourceRefs: ["SRC-003"],
      },
    ],
  };
  artifact.assumptions = [{
    id: "ASM-001",
    title: "AI provider",
    statement: "Use placeholder AI provider.",
    state: "superseded",
    sourceRefs: ["SRC-003"],
  }];
  artifact.assets = [{
    id: "ASSET-OLD-LOGO",
    kind: "image",
    label: "Old logo",
    required: false,
    state: "removed",
    logicalPath: "assets/old-logo.png",
    sourceRefs: ["SRC-003"],
  }];
  return artifact;
}

function acceptedArtifactWithLongLists() {
  const artifact = acceptedArtifactWithFeedback() as any;
  artifact.acceptedDiff.items = Array.from({ length: 105 }, (_, index) => {
    const id = String(index + 1).padStart(3, "0");
    return {
      id: `DIFF-003-SPEC-${id}`,
      targetType: "spec",
      targetId: `SPEC-${id}`,
      changeType: "updated",
      workImpact: "requires_loop_work",
      summary: `Spec work item ${index + 1}`,
      sourceRefs: ["SRC-003"],
    };
  });
  artifact.feedback = Array.from({ length: 101 }, (_, index) => {
    const id = String(index + 1).padStart(3, "0");
    return {
      id: `BUG-${id}`,
      title: `Bug ${index + 1}`,
      body: `Bug detail ${index + 1}`,
      state: "open",
      reopenCount: 0,
      defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
      sourceRefs: ["SRC-003"],
    };
  });
  artifact.assumptions = Array.from({ length: 102 }, (_, index) => {
    const id = String(index + 1).padStart(3, "0");
    return {
      id: `ASM-${id}`,
      title: `Assumption ${index + 1}`,
      statement: `Assumption detail ${index + 1}`,
      state: "proposed",
      sourceRefs: ["SRC-003"],
    };
  });
  return artifact;
}

describe("buildProjectInteractionSnapshot", () => {
  it("exposes required secret status without leaking secret values or raw activity payloads", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project(),
      access(["project.view", "project.secrets.manage", "project.required_secrets.manage"]),
      "user-1",
    );

    expect(snapshot.secrets.required).toEqual([
      {
        key: "TELEGRAM_BOT_TOKEN",
        description: "Bot token",
        blocking: true,
        provided: true,
        providedAt: updatedAt.toISOString(),
      },
      {
        key: "STRIPE_SECRET_KEY",
        blocking: false,
        requestedAt: "2026-05-09T10:01:00.000Z",
        provided: false,
        providedAt: null,
      },
    ]);
    expect(snapshot.secrets.provided).toEqual([{
      id: "secret-1",
      key: "TELEGRAM_BOT_TOKEN",
      description: "Bot token",
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    }]);
    expect(snapshot.activity.runEvents).toEqual([{
      id: "run-log-1",
      event: "RUNNING",
      label: "Running",
      createdAt: createdAt.toISOString(),
    }]);
    expect(snapshot.activity.projectEvents).toEqual([{
      id: "event-1",
      direction: "out",
      type: "required_secrets",
      label: "Required Secrets",
      userId: null,
      createdAt: createdAt.toISOString(),
    }]);
    expect(snapshot.execution.current).toMatchObject({
      type: "progress.updated",
      title: "Ralph работает",
      summary: "Checkout",
      tone: "active",
      task: {
        id: "task-1",
        label: "Checkout",
        status: "in_progress",
      },
      progress: {
        completed: 0,
        total: 2,
        percent: 0,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
    expect(JSON.stringify(snapshot)).not.toContain("encryptedValue");
    expect(JSON.stringify(snapshot)).not.toContain("payload");
    expect(JSON.stringify(snapshot)).not.toContain("detail");
  });

  it("exposes the latest Mac release artifact for private project viewers", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        releaseArtifacts: [{
          id: "release-1",
          projectId: "project-1",
          platform: "macos",
          appKind: "electron",
          status: "available",
          version: "0.1.0",
          tag: "mac-build/petsik-v0.1.0",
          commitSha: "abc1234",
          filename: "Petsik-0.1.0-mac.zip",
          contentType: "application/zip",
          sizeBytes: 123456,
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          storageKey: "release-1/Petsik-0.1.0-mac.zip",
          builderLabel: "sample-machine",
          failureSummary: null,
          createdAt,
          updatedAt,
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.macBuild).toEqual({
      status: "available",
      latestArtifact: {
        id: "release-1",
        version: "0.1.0",
        tag: "mac-build/petsik-v0.1.0",
        commitSha: "abc1234",
        filename: "Petsik-0.1.0-mac.zip",
        contentType: "application/zip",
        sizeBytes: 123456,
        sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        createdAt: createdAt.toISOString(),
        downloadUrl: "/api/projects/project-1/release-artifacts/release-1/download",
      },
      failureSummary: null,
      builderLabel: "sample-machine",
      updatedAt: updatedAt.toISOString(),
    });
  });

  it("hides Mac release artifact metadata from public project snapshots", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        visibility: "featured",
        releaseArtifacts: [{
          id: "release-private",
          projectId: "project-1",
          platform: "macos",
          appKind: "electron",
          status: "available",
          version: "0.1.0",
          tag: "mac-build/petsik-v0.1.0",
          commitSha: "abc1234",
          filename: "Petsik-private.zip",
          contentType: "application/zip",
          sizeBytes: 123456,
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          storageKey: "release-private/Petsik-private.zip",
          builderLabel: "sample-machine",
          failureSummary: null,
          createdAt,
          updatedAt,
        }],
      }),
      access([]),
      null,
    );

    expect(snapshot.viewer.audience).toBe("public");
    expect(snapshot.macBuild).toEqual({
      status: "not_available",
      latestArtifact: null,
      failureSummary: null,
      builderLabel: null,
      updatedAt: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("Petsik-private.zip");
  });

  it("normalizes unsafe activity codes instead of exposing raw log or event text", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        runLogs: [{
          id: "run-log-unsafe",
          event: "secret=must-not-leak",
          createdAt,
          detail: "token=must-not-leak",
        }],
        events: [{
          id: "event-unsafe",
          direction: "out",
          type: "secret=must-not-leak",
          userId: "user-1",
          createdAt,
          payload: { token: "must-not-leak" },
        }],
      }),
      access(["project.view", "project.secrets.manage", "project.required_secrets.manage"]),
      "user-1",
    );

    expect(snapshot.activity.runEvents).toEqual([{
      id: "run-log-unsafe",
      event: "OTHER",
      label: "Run event",
      createdAt: createdAt.toISOString(),
    }]);
    expect(snapshot.activity.projectEvents).toEqual([{
      id: "event-unsafe",
      direction: "out",
      type: "other",
      label: "Project event",
      userId: "user-1",
      createdAt: createdAt.toISOString(),
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
  });

  it("redacts secret, spec, budget and activity sections from contributor snapshots", () => {
    const snapshot = buildProjectInteractionSnapshot(project(), access(["project.view"]), "user-1");

    expect(snapshot.viewer).toMatchObject({
      surface: "arena",
      audience: "contributor",
      sections: {
        status: true,
        preview: true,
        tasks: true,
        progress: true,
        specs: false,
        assets: true,
        secrets: false,
        budget: false,
        activity: false,
        settings: false,
        access: false,
      },
    });
    expect(snapshot.secrets).toEqual({ required: [], provided: [] });
    expect(snapshot.budget).toBeNull();
    expect(snapshot.activity).toEqual({ runEvents: [], projectEvents: [] });
    expect(snapshot.specs).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.progress.summary).toMatchObject({
      currentFeature: "Checkout flow",
      featuresCompleted: 1,
      featuresTotal: 3,
    });
    expect(JSON.stringify(snapshot)).not.toContain("Build the product");
  });

  it("projects a compact action-required execution event for secret blockers", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          blockers: ["SECRETS"],
        }],
      }),
      access(["project.view", "project.secrets.manage"]),
      "user-1",
    );

    expect(snapshot.execution.current).toMatchObject({
      type: "action.required",
      title: "Нужны настройки проекта",
      tone: "warning",
      action: {
        kind: "manage_secrets",
      },
    });
    expect(JSON.stringify(snapshot.execution)).not.toContain("encryptedValue");
    expect(JSON.stringify(snapshot.execution)).not.toContain("must-not-leak");
  });

  it("projects pending Ralph spec-gap assumption reviews as action-required progress, not product truth", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "idle",
          message: "Waiting for review",
          assumptionReviews: [
            {
              id: "ASM-RALPH-PROVIDER",
              title: "Provider choice",
              statement: "The spec does not name a production provider, so Ralph will use the configured provider.",
              sourceRefs: ["ASM-001", "judgment-001"],
              privateReasoning: "must-not-leak",
            },
          ],
        }),
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: null,
          blockers: [],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.assumptions).toEqual([]);
    expect(snapshot.progress.raw?.assumptionReviews).toEqual([{
      id: "ASM-RALPH-PROVIDER",
      title: "Provider choice",
      statement: "The spec does not name a production provider, so Ralph will use the configured provider.",
      sourceRefs: ["ASM-001"],
    }]);
    expect(snapshot.execution.current).toMatchObject({
      type: "action.required",
      title: "Ralph сделал вывод",
      summary: "The spec does not name a production provider, so Ralph will use the configured provider.",
      tone: "warning",
      action: {
        kind: "review",
        label: "Открыть вопросы",
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("judgment-001");
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
  });

  it("keeps implemented-unverified confirmation prompts out of user-facing assumption reviews", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "idle",
          message: "Waiting for review",
          assumptionReviews: [
            {
              id: "ASM-RALPH-BUG-005",
              title: "Needs confirmation for BUG-005",
              statement: "BUG-005 appears implemented, but product evidence has not confirmed it yet.",
              sourceRefs: ["BUG-005", "judgment-001"],
              privateReasoning: "must-not-leak",
            },
          ],
        }),
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          blockers: [],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.assumptions).toEqual([]);
    expect(snapshot.progress.raw?.assumptionReviews).toBeUndefined();
    expect(snapshot.execution.current).toMatchObject({
      type: "work.completed",
      title: "Готово к просмотру",
      tone: "success",
    });
    expect(JSON.stringify(snapshot)).not.toContain("Needs confirmation");
    expect(JSON.stringify(snapshot)).not.toContain("judgment-001");
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
  });

  it("projects failed terminal execution without falling back to plan-ready", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: "FAILED",
          blockers: [],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.current).toMatchObject({
      type: "work.failed",
      title: "Ralph остановился",
      tone: "danger",
      action: {
        kind: "review",
      },
    });
  });

  it("does not project plan-ready from raw runner progress totals without accepted diff tasks", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: null,
          blockers: [],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.execution.current).toMatchObject({
      type: "planning.started",
      title: "Ralph планирует работу",
    });
  });

  it("projects interaction tasks from accepted diff work items instead of raw progress steps", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithMixedWorkItems(),
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.tasks).toEqual([
      {
        id: "TASK-BUG-006",
        label: "Checkout still fails: Users still cannot complete checkout after the previous loop claim.",
        status: "pending",
        orderIndex: 0,
        source: {
          sourceVersion: 3,
          targetSpecVersion: 3,
          artifactId: "SPEC-003",
          diffId: "DIFF-003",
          diffItemIds: ["DIFF-003-BUG-006"],
          changeType: "reopened",
          feedbackId: "BUG-006",
        },
      },
      {
        id: "TASK-SPEC-003",
        label: "Product checkout flow now requires Telegram WebApp launch.",
        status: "pending",
        orderIndex: 1,
        source: {
          sourceVersion: 3,
          targetSpecVersion: 3,
          artifactId: "SPEC-003",
          diffId: "DIFF-003",
          diffItemIds: ["DIFF-003-SPEC"],
          changeType: "updated",
          feedbackId: null,
        },
      },
      {
        id: "TASK-ASM-001",
        label: "AI provider: Production generation requires a real provider.",
        status: "pending",
        orderIndex: 2,
        source: {
          sourceVersion: 3,
          targetSpecVersion: 3,
          artifactId: "SPEC-003",
          diffId: "DIFF-003",
          diffItemIds: ["DIFF-003-ASM-001"],
          changeType: "corrected",
          feedbackId: null,
        },
      },
    ]);
    expect(snapshot.feedback).toEqual([{
      id: "BUG-006",
      title: "Checkout still fails",
      body: "Users still cannot complete checkout after the previous loop claim.",
      state: "reopened",
      reopenCount: 2,
      orderIndex: 0,
      resolution: null,
    }]);
    expect(snapshot.assumptions).toEqual([{
      id: "ASM-001",
      title: "AI provider",
      statement: "Production generation requires a real provider.",
      state: "corrected",
      orderIndex: 0,
      outcome: {
        kind: "corrected_into_spec",
        correctionSummary: "Use the configured production provider.",
      },
    }]);
    expect(snapshot.tasks.map((task) => task.id)).not.toContain("task-1");
    expect(snapshot.progress.raw?.steps?.map((task) => task.id)).toEqual(["task-1", "task-2"]);
  });

  it("does not force-complete fresh same-version accepted artifact work by stale acceptedAt", () => {
    const artifact = acceptedArtifactWithMixedWorkItems();
    const snapshot = buildProjectInteractionSnapshot(
      project({
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          lastOutcomeAt: new Date("2026-05-20T12:00:00.000Z"),
          blockers: [],
        }],
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: new Date("2026-05-16T12:00:00.000Z"),
            updatedAt: new Date("2026-05-22T12:00:00.000Z"),
            acceptedArtifact: artifact,
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.tasks.map((task) => [task.id, task.status])).toEqual([
      ["TASK-BUG-006", "pending"],
      ["TASK-SPEC-003", "pending"],
      ["TASK-ASM-001", "pending"],
    ]);
    expect(snapshot.execution.activeChangeBatches).toEqual([
      expect.objectContaining({
        diffId: "DIFF-003",
        status: "pending",
        workItemCount: 3,
        completedItemCount: 0,
        pendingItemCount: 3,
      }),
    ]);
  });

  it("projects active accepted change batches from stacked spec versions and progress refs", () => {
    const v3 = acceptedArtifactWithMixedWorkItems();
    const v4 = acceptedArtifactWithSpecWork(4);
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          message: "Applying stacked changes",
          featuresCompleted: 1,
          featuresTotal: 3,
          steps: [
            {
              id: "task-1",
              label: "Fix checkout",
              status: "completed",
              feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            },
            {
              id: "task-2",
              label: "Telegram launch",
              status: "pending",
              feedbackItemRefs: [{ itemId: "SPEC-003", diffItemId: "DIFF-003-SPEC" }],
            },
            {
              id: "task-3",
              label: "New v4 behavior",
              status: "in_progress",
              feedbackItemRefs: [{ itemId: "SPEC-004", diffItemId: "DIFF-004-SPEC" }],
            },
          ],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [
            {
              id: "spec-version-4",
              version: 4,
              content: "Build the product v4",
              message: "Accepted in Telegram",
              createdAt: updatedAt,
              acceptedArtifact: v4,
            },
            {
              id: "spec-version-3",
              version: 3,
              content: "Build the product v3",
              message: "Accepted in Telegram",
              createdAt,
              acceptedArtifact: v3,
            },
          ],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.activeChangeBatches).toEqual([
      expect.objectContaining({
        diffId: "DIFF-003",
        sourceVersion: 3,
        status: "pending",
        workItemCount: 3,
        completedItemCount: 1,
        pendingItemCount: 2,
      }),
      expect.objectContaining({
        diffId: "DIFF-004",
        sourceVersion: 4,
        status: "in_progress",
        workItemCount: 1,
        completedItemCount: 0,
        pendingItemCount: 1,
      }),
    ]);
    expect(snapshot.execution.statusSummary).toMatchObject({
      stage: "working",
      title: "Ralph работает",
      currentTaskLabel: "New v4 behavior",
      activeBatchCount: 2,
      activeWorkItemCount: 3,
      completedWorkItemCount: 1,
    });
    expect(snapshot.execution.current?.progress).toEqual({
      completed: 1,
      total: 3,
      percent: 33,
    });
    expect(snapshot.execution.statusSummary.lines).toContain("Рабочие задачи: 1 из 3.");
    expect(snapshot.execution.statusSummary.lines).toContain("Часть активных изменений готова; Ralph продолжает работу по нескольким обновлениям.");
    expect(snapshot.execution.statusSummary.lines).not.toContain("Текущий план: 1/3 задач готово");
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: "TASK-SPEC-004",
        status: "in_progress",
        source: expect.objectContaining({
          sourceVersion: 4,
          diffId: "DIFF-004",
          diffItemIds: ["DIFF-004-SPEC"],
          changeType: "updated",
        }),
      }),
      expect.objectContaining({
        id: "TASK-SPEC-003",
        status: "pending",
        source: expect.objectContaining({
          sourceVersion: 3,
          diffId: "DIFF-003",
          diffItemIds: ["DIFF-003-SPEC"],
          changeType: "updated",
        }),
      }),
      expect.objectContaining({
        id: "TASK-ASM-001",
        status: "pending",
        source: expect.objectContaining({
          sourceVersion: 3,
          diffId: "DIFF-003",
          diffItemIds: ["DIFF-003-ASM-001"],
          changeType: "corrected",
        }),
      }),
      expect.objectContaining({
        id: "TASK-BUG-006",
        status: "completed",
        source: expect.objectContaining({
          sourceVersion: 3,
          diffId: "DIFF-003",
          diffItemIds: ["DIFF-003-BUG-006"],
          changeType: "reopened",
        }),
      }),
    ]);
  });

  it("keeps task progress based on task statuses instead of the active task ordinal", () => {
    const artifact = acceptedArtifactWithSpecWork(6) as any;
    artifact.acceptedDiff.items = Array.from({ length: 100 }, (_, index) => {
      const id = String(index + 1).padStart(3, "0");
      return {
        id: `DIFF-006-SPEC-${id}`,
        targetType: "spec",
        targetId: `SPEC-${id}`,
        changeType: "updated",
        workImpact: "requires_loop_work",
        summary: `Spec work item ${index + 1}`,
        sourceRefs: ["SRC-006"],
      };
    });

    const progressSteps = artifact.acceptedDiff.items.map((item: any, index: number) => {
      const number = String(index + 1).padStart(3, "0");
      const status = index === 22
        ? "in_progress"
        : index >= 98
          ? "pending"
          : "completed";
      return {
        id: `task-${number}`,
        label: `Work item ${number}`,
        status,
        feedbackItemRefs: [{ diffItemId: item.id }],
      };
    });

    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          message: "Working on item 23",
          iteration: 30,
          steps: progressSteps,
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product v6",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-6",
            version: 6,
            content: "Build the product v6",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: artifact,
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.activeChangeBatches).toEqual([
      expect.objectContaining({
        diffId: "DIFF-006",
        status: "in_progress",
        workItemCount: 100,
        completedItemCount: 97,
        pendingItemCount: 3,
      }),
    ]);
    expect(snapshot.execution.current?.task).toMatchObject({
      id: "task-023",
      status: "in_progress",
    });
    expect(snapshot.execution.current?.progress).toEqual({
      completed: 97,
      total: 100,
      percent: 97,
    });
    expect(snapshot.execution.statusSummary.lines).toContain("Рабочие задачи: 97 из 100.");
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toContain("23 из 100");
    expect(snapshot.tasks.slice(0, 3).map((task) => [task.id, task.status])).toEqual([
      ["TASK-SPEC-023", "in_progress"],
      ["TASK-SPEC-099", "pending"],
      ["TASK-SPEC-100", "pending"],
    ]);
    expect(snapshot.tasks.slice(3).every((task) => task.status === "completed")).toBe(true);
  });

  it("derives proof reviews from accepted diff tasks and task proof evidence", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed with proof",
          steps: [{
            id: "task-1",
            label: "Fix checkout",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            proofExpectations: [{
              kind: "before_after_screenshot",
              reason: "ordinary_web_ui_ux_task",
              source: "projectConfig.techStack.web+task.requiredRolePasses.ux",
              status: "satisfied",
              rawPolicy: "must-not-leak",
              evidence: [{
                kind: "screenshot",
                role: "before",
                ref: "proof:before",
                result: "pass",
                target: {
                  route: "/checkout",
                  viewport: { width: 1280, height: 800 },
                  claim: "checkout failure is visible before the fix",
                },
                artifactPath: "assets/proof/task-1/before.png",
                observedAt: "2026-05-16T12:01:00.000Z",
                rawPath: "must-not-leak",
              }, {
                kind: "screenshot",
                role: "after",
                ref: "proof:after",
                result: "pass",
                target: {
                  route: "/checkout",
                  viewport: { width: 1280, height: 800 },
                  claim: "checkout completes after the fix",
                },
                artifactPath: "assets/proof/task-1/after.png",
                observedAt: "2026-05-16T12:02:00.000Z",
              }],
            }],
          }],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithFeedback(),
          }],
        }],
        assets: [
          {
            id: "asset-proof-before",
            path: "assets/proof/task-1/before.png",
            originalName: "before.png",
            contentType: "image/png",
            sizeBytes: 100,
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            uploadedById: "runner",
            createdAt,
            updatedAt,
          },
          {
            id: "asset-proof-after",
            path: "assets/proof/task-1/after.png",
            originalName: "after.png",
            contentType: "image/png",
            sizeBytes: 101,
            sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            uploadedById: "runner",
            createdAt,
            updatedAt,
          },
        ],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.proofReviews).toEqual([{
      id: "proof:TASK-BUG-006",
      taskId: "TASK-BUG-006",
      taskLabel: "Checkout still fails: Users still cannot complete checkout after the previous loop claim.",
      status: "ready",
      action: {
        kind: "review_screenshots",
        label: "Проверить скриншоты",
      },
      source: {
        sourceVersion: 3,
        targetSpecVersion: 3,
        artifactId: "SPEC-003",
        diffId: "DIFF-003",
        diffItemIds: ["DIFF-003-BUG-006"],
        changeType: "reopened",
        feedbackId: "BUG-006",
      },
      before: {
        role: "before",
        kind: "screenshot",
        availability: "available",
        url: "/api/internal/projects/project-1/assets/asset-proof-before/download",
        assetId: "asset-proof-before",
        contentType: "image/png",
        sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        capturedAt: "2026-05-16T12:01:00.000Z",
        unavailableReason: null,
      },
      after: {
        role: "after",
        kind: "screenshot",
        availability: "available",
        url: "/api/internal/projects/project-1/assets/asset-proof-after/download",
        assetId: "asset-proof-after",
        contentType: "image/png",
        sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        capturedAt: "2026-05-16T12:02:00.000Z",
        unavailableReason: null,
      },
    }]);
    expect(JSON.stringify(snapshot.proofReviews)).not.toContain(".ralph");
    expect(JSON.stringify(snapshot.proofReviews)).not.toContain("assets/proof");
    expect(JSON.stringify(snapshot.proofReviews)).not.toContain("must-not-leak");
  });

  it("builds visual evidence reviews from exported Workbench task evidence without raw paths", () => {
    const snapshot = buildProjectInteractionSnapshot(
      projectWithAcceptedVisualArtifact({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed with visual workbench evidence",
          steps: [{
            id: "task-1",
            label: "Fix synth pad visual state",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            visualEvidence: [{
              sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
              sourceKind: "visual_workbench",
              result: "inconclusive",
              observedAt: "2026-06-07T09:00:00.000Z",
              summary: "Visual Workbench story synth-pad.playing.desktop captured at desktop.",
              feedbackItemIds: ["BUG-006"],
              diffItemIds: ["DIFF-003-BUG-006"],
              artifactPath: ".ralph/visual-workbench/must-not-leak.png",
              artifactSha256: `sha256:${visualDigest}`,
              target: {
                route: "/visual-workbench/synth-pad.playing.desktop",
                viewport: { width: 1280, height: 800 },
                claim: "synth pad shows the active playing state",
                state: "playing",
              },
            }],
          }],
        }),
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.visualEvidenceReviews).toHaveLength(1);
    const review = snapshot.visualEvidenceReviews[0];
    expect(review).toMatchObject({
      taskId: "TASK-BUG-006",
      taskLabel: "Checkout still fails: Users still cannot complete checkout after the previous loop claim.",
      status: "unassessed",
      action: {
        kind: "review_visual_evidence",
        label: "Проверить скриншоты",
      },
      sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
      feedbackItemIds: ["BUG-006"],
      diffItemIds: ["DIFF-003-BUG-006"],
      sourceKind: "visual_workbench",
      target: {
        route: "/visual-workbench/synth-pad.playing.desktop",
        viewport: { width: 1280, height: 800 },
        claim: "synth pad shows the active playing state",
        state: "playing",
        interaction: null,
      },
      observedAt: "2026-06-07T09:00:00.000Z",
      summary: "Visual Workbench story synth-pad.playing.desktop captured at desktop.",
      artifactSha256: `sha256:${visualDigest}`,
      artifact: {
        availability: "unavailable",
        url: null,
        contentType: null,
        sha256: `sha256:${visualDigest}`,
        unavailableReason: "missing_artifact",
      },
      assessments: [],
    });
    expect(review.id).toMatch(/^visual:[a-f0-9]{16}$/);
    expect(review.action.href).toBe(
      `/my/projects/project-1?focus=visualEvidence&review=${encodeURIComponent(review.id)}#project-visual-evidence`,
    );
    expect(JSON.stringify(snapshot.visualEvidenceReviews)).not.toContain(".ralph");
    expect(JSON.stringify(snapshot.visualEvidenceReviews)).not.toContain("artifactPath");
    expect(JSON.stringify(snapshot.visualEvidenceReviews)).not.toContain("must-not-leak");
  });

  it("does not build visual evidence reviews without accepted diff identity on the progress step", () => {
    const snapshot = buildProjectInteractionSnapshot(
      projectWithAcceptedVisualArtifact({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed with visual workbench evidence",
          steps: [{
            id: "task-1",
            label: "Fix synth pad visual state",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006" }],
            visualEvidence: [{
              sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
              sourceKind: "visual_workbench",
              result: "inconclusive",
              observedAt: "2026-06-07T09:00:00.000Z",
              summary: "Visual Workbench story synth-pad.playing.desktop captured at desktop.",
              feedbackItemIds: ["BUG-006"],
              artifactSha256: `sha256:${visualDigest}`,
              target: {
                route: "/visual-workbench/synth-pad.playing.desktop",
                viewport: { width: 1280, height: 800 },
                claim: "synth pad shows the active playing state",
              },
            }],
          }],
        }),
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.visualEvidenceReviews).toEqual([]);
  });

  it("does not build visual evidence reviews without diff identity on the evidence row", () => {
    const snapshot = buildProjectInteractionSnapshot(
      projectWithAcceptedVisualArtifact({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed with visual workbench evidence",
          steps: [{
            id: "task-1",
            label: "Fix synth pad visual state",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            visualEvidence: [{
              sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
              sourceKind: "visual_workbench",
              result: "inconclusive",
              observedAt: "2026-06-07T09:00:00.000Z",
              summary: "Visual Workbench story synth-pad.playing.desktop captured at desktop.",
              feedbackItemIds: ["BUG-006"],
              artifactSha256: `sha256:${visualDigest}`,
              target: {
                route: "/visual-workbench/synth-pad.playing.desktop",
                viewport: { width: 1280, height: 800 },
                claim: "synth pad shows the active playing state",
              },
            }],
          }],
        }),
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.visualEvidenceReviews).toEqual([]);
  });

  it("marks visual evidence artifacts available only from the dedicated review namespace and digest", () => {
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    const reviewId = `visual:${createHash("sha256").update(sourceEvidenceRef).digest("hex").slice(0, 16)}`;
    const snapshot = buildProjectInteractionSnapshot(
      projectWithAcceptedVisualArtifact({
        progressJson: JSON.stringify({
          state: "completed",
          steps: [{
            id: "task-1",
            label: "Fix synth pad visual state",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            visualEvidence: [{
              sourceEvidenceRef,
              sourceKind: "visual_workbench",
              result: "inconclusive",
              observedAt: "2026-06-07T09:00:00.000Z",
              summary: "Visual Workbench story captured.",
              feedbackItemIds: ["BUG-006"],
              diffItemIds: ["DIFF-003-BUG-006"],
              artifactSha256: `sha256:${visualDigest}`,
              target: {
                route: "/visual-workbench/synth-pad.playing.desktop",
                viewport: { width: 1280, height: 800 },
                claim: "synth pad shows the active playing state",
              },
            }],
          }],
        }),
        assets: [
          {
            id: "asset-visual",
            path: `${visualEvidenceAssetPathPrefixForReviewId(reviewId)}capture.png`,
            originalName: "capture.png",
            contentType: "image/png",
            sizeBytes: 3,
            sha256: visualDigest,
            uploadedById: "system",
            createdAt,
            updatedAt,
          },
          {
            id: "asset-visual-wrong",
            path: "assets/input/capture.png",
            originalName: "capture.png",
            contentType: "image/png",
            sizeBytes: 3,
            sha256: visualDigest,
            uploadedById: "tg-spec",
            createdAt,
            updatedAt,
          },
        ],
      }),
      access(["project.view", "project.runtime.manage"]),
      "user-1",
    );

    expect(snapshot.visualEvidenceReviews).toHaveLength(1);
    expect(snapshot.visualEvidenceReviews[0].artifact).toEqual({
      availability: "available",
      url: `/api/projects/project-1/visual-evidence/${encodeURIComponent(reviewId)}/artifact`,
      contentType: "image/png",
      sha256: `sha256:${visualDigest}`,
      unavailableReason: null,
    });
    expect(snapshot.assets.map((asset) => asset.id)).toEqual(["asset-visual-wrong"]);
  });

  it("groups visual evidence manual assessments and reports the assessment status", () => {
    const snapshot = buildProjectInteractionSnapshot(
      projectWithAcceptedVisualArtifact({
        progressJson: JSON.stringify({
          state: "completed",
          steps: [{
            id: "task-1",
            label: "Fix synth pad visual state",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            visualEvidence: [{
              sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
              sourceKind: "visual_workbench",
              result: "inconclusive",
              observedAt: "2026-06-07T09:00:00.000Z",
              summary: "Visual Workbench story captured.",
              feedbackItemIds: ["BUG-006"],
              diffItemIds: ["DIFF-003-BUG-006"],
              artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              target: {
                route: "/visual-workbench/synth-pad.playing.desktop",
                viewport: { width: 1280, height: 800 },
                claim: "synth pad shows the active playing state",
              },
              assessments: [{
                ref: "visual-workbench-assessment:manual_note:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa:bbbbbbbbbbbb",
                result: "pass",
                observedAt: "2026-06-07T09:01:00.000Z",
                summary: "Manual Visual Workbench assessment (pass): active state is visible.",
                recordedBy: "manual",
              }],
            }],
          }],
        }),
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.visualEvidenceReviews).toHaveLength(1);
    expect(snapshot.visualEvidenceReviews[0]).toMatchObject({
      status: "passed",
      assessments: [{
        ref: "visual-workbench-assessment:manual_note:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa:bbbbbbbbbbbb",
        result: "pass",
        observedAt: "2026-06-07T09:01:00.000Z",
        summary: "Manual Visual Workbench assessment (pass): active state is visible.",
        recordedBy: "manual",
      }],
    });
  });

  it("does not mark bare screenshot proof ready without a review target", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed with bare screenshot proof",
          steps: [{
            id: "task-1",
            label: "Fix Study animation buttons",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            proofExpectations: [{
              kind: "before_after_screenshot",
              reason: "ordinary_web_ui_ux_task",
              source: "projectConfig.techStack.web+task.requiredRolePasses.ux",
              status: "satisfied",
              evidence: [{
                kind: "screenshot",
                role: "before",
                ref: "screenshot-proof:before",
                result: "pass",
                artifactPath: "assets/proof/task-1/before.png",
                observedAt: "2026-06-03T02:55:46.804Z",
              }, {
                kind: "screenshot",
                role: "after",
                ref: "screenshot-proof:after",
                result: "pass",
                artifactPath: "assets/proof/task-1/after.png",
                observedAt: "2026-06-03T02:58:41.978Z",
              }],
            }],
          }],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-24",
            version: 24,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithFeedback(),
          }],
        }],
        assets: [
          {
            id: "asset-proof-before",
            path: "assets/proof/task-1/before.png",
            originalName: "before.png",
            contentType: "image/png",
            sizeBytes: 100,
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            uploadedById: "runner",
            createdAt,
            updatedAt,
          },
          {
            id: "asset-proof-after",
            path: "assets/proof/task-1/after.png",
            originalName: "after.png",
            contentType: "image/png",
            sizeBytes: 101,
            sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            uploadedById: "runner",
            createdAt,
            updatedAt,
          },
        ],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.proofReviews).toEqual([
      expect.objectContaining({
        id: "proof:TASK-BUG-006",
        status: "unavailable",
        before: expect.objectContaining({
          availability: "available",
          url: "/api/internal/projects/project-1/assets/asset-proof-before/download",
          assetId: "asset-proof-before",
          unavailableReason: null,
        }),
        after: expect.objectContaining({
          availability: "available",
          url: "/api/internal/projects/project-1/assets/asset-proof-after/download",
          assetId: "asset-proof-after",
          unavailableReason: null,
        }),
      }),
    ]);
  });

  it("does not mark screenshot proof ready when before and after assets have identical digests", () => {
    const sharedDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed with proof",
          steps: [{
            id: "task-1",
            label: "Fix checkout",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            proofExpectations: [{
              kind: "before_after_screenshot",
              reason: "ordinary_web_ui_ux_task",
              source: "projectConfig.techStack.web+task.requiredRolePasses.ux",
              status: "satisfied",
              evidence: [{
                kind: "screenshot",
                role: "before",
                result: "pass",
                target: {
                  route: "/checkout",
                  viewport: { width: 1280, height: 800 },
                  claim: "checkout failure is visible before the fix",
                },
                artifactPath: "assets/proof/task-1/before.png",
              }, {
                kind: "screenshot",
                role: "after",
                result: "pass",
                target: {
                  route: "/checkout",
                  viewport: { width: 1280, height: 800 },
                  claim: "checkout completes after the fix",
                },
                artifactPath: "assets/proof/task-1/after.png",
              }],
            }],
          }],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithFeedback(),
          }],
        }],
        assets: [
          {
            id: "asset-proof-before",
            path: "assets/proof/task-1/before.png",
            originalName: "before.png",
            contentType: "image/png",
            sizeBytes: 100,
            sha256: sharedDigest,
            uploadedById: "runner",
            createdAt,
            updatedAt,
          },
          {
            id: "asset-proof-after",
            path: "assets/proof/task-1/after.png",
            originalName: "after.png",
            contentType: "image/png",
            sizeBytes: 100,
            sha256: sharedDigest,
            uploadedById: "runner",
            createdAt,
            updatedAt,
          },
        ],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.proofReviews).toEqual([
      expect.objectContaining({
        id: "proof:TASK-BUG-006",
        status: "unavailable",
        before: expect.objectContaining({
          availability: "available",
          sha256: sharedDigest,
        }),
        after: expect.objectContaining({
          availability: "available",
          sha256: sharedDigest,
        }),
      }),
    ]);
  });

  it("marks local screenshot proof paths unavailable without exposing them", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "completed",
          steps: [{
            id: "task-1",
            label: "Fix checkout",
            status: "completed",
            feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
            proofExpectations: [{
              kind: "before_after_screenshot",
              reason: "ordinary_web_ui_ux_task",
              source: "projectConfig.techStack.web+task.requiredRolePasses.ux",
              status: "satisfied",
              evidence: [{
                kind: "screenshot",
                role: "before",
                ref: "proof:before",
                result: "pass",
                target: {
                  route: "/checkout",
                  viewport: { width: 1280, height: 800 },
                  claim: "checkout failure is visible before the fix",
                },
                artifactPath: ".ralph/evidence/task-1/before.png",
                contentType: "image/png",
                sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              }, {
                kind: "screenshot",
                role: "after",
                ref: "proof:after",
                result: "pass",
                target: {
                  route: "/checkout",
                  viewport: { width: 1280, height: 800 },
                  claim: "checkout completes after the fix",
                },
                artifactPath: "/tmp/after.png",
                contentType: "image/png",
              }],
            }],
          }],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithFeedback(),
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.proofReviews).toEqual([
      expect.objectContaining({
        id: "proof:TASK-BUG-006",
        status: "unavailable",
        action: {
          kind: "review_screenshots",
          label: "Проверить скриншоты",
        },
        before: expect.objectContaining({
          availability: "unavailable",
          url: null,
          unavailableReason: "unsafe_path",
          contentType: "image/png",
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
        after: expect.objectContaining({
          availability: "unavailable",
          url: null,
          unavailableReason: "unsafe_path",
        }),
      }),
    ]);
    expect(JSON.stringify(snapshot.proofReviews)).not.toContain(".ralph");
    expect(JSON.stringify(snapshot.proofReviews)).not.toContain("/tmp/after");
  });

  it("does not show old unlinked accepted batches as zero progress once newer linked progress exists", () => {
    const v3 = acceptedArtifactWithMixedWorkItems();
    const v4 = acceptedArtifactWithSpecWork(4);
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "paused_rate_limit",
          message: "Waiting for model limit",
          steps: [
            ...Array.from({ length: 100 }, (_, index) => ({
              id: `old-task-${index + 1}`,
              label: `Old completed task ${index + 1}`,
              status: "completed",
              feedbackItemRefs: [{ itemId: "OLD", diffItemId: "DIFF-OLD-SPEC" }],
            })),
            {
              id: "task-4",
              label: "New v4 behavior",
              status: "in_progress",
              feedbackItemRefs: [{ itemId: "SPEC-004", diffItemId: "DIFF-004-SPEC" }],
            },
          ],
        }),
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          blockers: ["RATE_LIMIT"],
          retryAt: new Date("2026-05-16T13:00:00.000Z"),
        }],
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [
            {
              id: "spec-version-4",
              version: 4,
              content: "Build the product v4",
              message: "Accepted in Telegram",
              createdAt: updatedAt,
              acceptedArtifact: v4,
            },
            {
              id: "spec-version-3",
              version: 3,
              content: "Build the product v3",
              message: "Accepted in Telegram",
              createdAt,
              acceptedArtifact: v3,
            },
          ],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.activeChangeBatches).toEqual([
      expect.objectContaining({
        diffId: "DIFF-004",
        completedItemCount: 0,
        pendingItemCount: 1,
      }),
    ]);
    expect(snapshot.execution.current?.progress).toEqual({
      completed: 0,
      total: 1,
      percent: 0,
    });
    expect(snapshot.execution.statusSummary.lines).toContain("Рабочие задачи: 0 из 1.");
    expect(snapshot.execution.statusSummary.lines).toContain("Активные изменения выполняются.");
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/v3: 0\/3/);
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/100/);
  });

  it("keeps new accepted work visible after an earlier completed loop outcome", () => {
    const artifact = acceptedArtifactWithSpecWork(4);
    artifact.acceptedAt = "2026-05-16T12:04:00.000Z";
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Previous work completed",
          featuresCompleted: 100,
          featuresTotal: 100,
        }),
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          lastOutcomeAt: new Date("2026-05-16T12:03:00.000Z"),
        }],
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product v4",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-4",
            version: 4,
            content: "Build the product v4",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: artifact,
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.current?.type).toBe("plan.ready");
    expect(snapshot.execution.current?.title).toBe("Есть новые изменения");
    expect(snapshot.execution.activeChangeBatches).toHaveLength(1);
    expect(snapshot.execution.statusSummary.lines).toContain("Активные изменения ждут начала работы.");
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/пункт|пункта|пунктов|\d+\/\d+/);
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/100/);
  });

  it("marks accepted diff tasks completed when their batch is covered by a completed loop outcome", () => {
    const artifact = acceptedArtifactWithMixedWorkItems();
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "completed",
          message: "Work completed",
          featuresCompleted: 100,
          featuresTotal: 100,
          currentFeature: "Stale checkout task",
        }),
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          lastOutcomeAt: new Date("2026-05-16T12:30:00.000Z"),
        }],
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: artifact,
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.activeChangeBatches).toEqual([]);
    expect(snapshot.execution.statusSummary.lines).toContain("Активные изменения завершены.");
    expect(snapshot.execution.statusSummary.currentTaskLabel).toBeNull();
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/Сейчас: Stale checkout task/);
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/100/);
    expect(snapshot.tasks.map((task) => task.status)).toEqual(["completed", "completed", "completed"]);
  });

  it("keeps blocker status primary while still showing active accepted changes", () => {
    const artifact = acceptedArtifactWithMixedWorkItems();
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "paused_rate_limit",
          message: "Waiting for model limit",
          currentFeature: "Stale checkout task",
        }),
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          blockers: ["RATE_LIMIT"],
          retryAt: new Date("2026-05-16T13:00:00.000Z"),
        }],
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: artifact,
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.current).toMatchObject({
      type: "action.required",
      title: "Ждём окно модели",
    });
    expect(snapshot.execution.statusSummary.stage).toBe("waiting");
    expect(snapshot.execution.statusSummary.currentTaskLabel).toBeNull();
    expect(snapshot.execution.statusSummary.lines).toContain("Активные изменения ждут начала работы.");
    expect(snapshot.execution.statusSummary.lines.join("\n")).not.toMatch(/Сейчас: Stale checkout task/);
  });

  it("uses specific user-facing copy for non-rate-limit blockers", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        components: [{
          ...project().components[0],
          agentState: "IDLE",
          blockers: ["BUDGET"],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.current).toMatchObject({
      type: "action.required",
      title: "Нужен бюджет",
      summary: "Работа продолжится после пополнения или изменения бюджета.",
    });
    expect(snapshot.execution.statusSummary.title).toBe("Нужен бюджет");
  });

  it("does not mark a diff item completed until all linked progress steps finish", () => {
    const artifact = acceptedArtifactWithSpecWork(4);
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          message: "Split task work",
          steps: [
            {
              id: "task-1",
              label: "First half",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-004-SPEC" }],
            },
            {
              id: "task-2",
              label: "Second half",
              status: "pending",
              feedbackItemRefs: [{ diffItemId: "DIFF-004-SPEC" }],
            },
          ],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product v4",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-4",
            version: 4,
            content: "Build the product v4",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: artifact,
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.activeChangeBatches).toEqual([
      expect.objectContaining({
        diffId: "DIFF-004",
        completedItemCount: 0,
        pendingItemCount: 1,
      }),
    ]);
  });

  it("keeps removed and superseded accepted work explicit in task provenance and labels", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          message: "Removing stale work",
          steps: [
            {
              id: "task-1",
              label: "Remove old logo",
              status: "pending",
              feedbackItemRefs: [{ diffItemId: "DIFF-005-ASSET-OLD-LOGO" }],
            },
            {
              id: "task-2",
              label: "Replace provider assumption",
              status: "pending",
              feedbackItemRefs: [{ diffItemId: "DIFF-005-ASM-001" }],
            },
          ],
        }),
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product v5",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-5",
            version: 5,
            content: "Build the product v5",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithRemovedSupersededWork(),
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.activeChangeBatches).toEqual([
      expect.objectContaining({
        diffId: "DIFF-005",
        changeCounts: expect.objectContaining({
          removed: 1,
          superseded: 1,
        }),
      }),
    ]);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: "TASK-ASSET-OLD-LOGO",
        label: "Убрать: Old logo: assets/old-logo.png",
        source: expect.objectContaining({
          changeType: "removed",
          diffItemIds: ["DIFF-005-ASSET-OLD-LOGO"],
        }),
      }),
      expect.objectContaining({
        id: "TASK-ASM-001",
        label: "Заменить: AI provider: Use placeholder AI provider.",
        source: expect.objectContaining({
          changeType: "superseded",
          diffItemIds: ["DIFF-005-ASM-001"],
        }),
      }),
    ]);
  });

  it("exposes collection counts when long interaction lists are truncated", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-3",
            version: 3,
            content: "Build the product",
            message: "Accepted in Telegram",
            createdAt: updatedAt,
            acceptedArtifact: acceptedArtifactWithLongLists(),
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.tasks).toHaveLength(100);
    expect(snapshot.feedback).toHaveLength(100);
    expect(snapshot.assumptions).toHaveLength(100);
    expect(snapshot.collections).toEqual({
      tasks: { total: 105, visible: 100, limit: 100, hasMore: true },
      feedback: { total: 101, visible: 100, limit: 100, hasMore: true },
      assumptions: { total: 102, visible: 100, limit: 100, hasMore: true },
    });
  });

  it("fails private interaction snapshots when accepted artifact metadata is invalid", () => {
    expect(() => buildProjectInteractionSnapshot(
      project({
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-broken",
            version: 4,
            content: "Build the product",
            message: "Imported with a stale artifact shape",
            createdAt: updatedAt,
            acceptedArtifact: {
              artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
              artifactId: "SPEC-BROKEN",
            },
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
      { surface: "telegram" },
    )).toThrow(/Invalid accepted spec artifact/);
  });

  it("fails private interaction snapshots when accepted artifact metadata has a stale shape", () => {
    expect(() => buildProjectInteractionSnapshot(
      project({
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-stale",
            version: 4,
            content: "Build the product",
            message: "Imported with stale artifact metadata",
            createdAt: updatedAt,
            acceptedArtifact: {
              acceptedDelta: {
                version: 4,
              },
            },
          }],
        }],
      }),
      access(["project.view"]),
      "user-1",
      { surface: "telegram" },
    )).toThrow(/unsupported artifact shape/);
  });

  it("does not parse private accepted artifacts for public snapshots", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        visibility: "featured",
        specs: [{
          id: "spec-1",
          title: "Spec",
          content: "Build the product",
          orderIndex: 0,
          createdAt,
          updatedAt,
          versions: [{
            id: "spec-version-broken",
            version: 4,
            content: "Build the product",
            message: "Imported with a stale artifact shape",
            createdAt: updatedAt,
            acceptedArtifact: {
              artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
              artifactId: "SPEC-BROKEN",
            },
          }],
        }],
      }),
      {
        ...access([]),
        canView: true,
        canAccessPrivate: false,
      },
      null,
      { surface: "telegram" },
    );

    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.feedback).toEqual([]);
    expect(snapshot.assumptions).toEqual([]);
  });

  it("keeps public snapshots to visibility-safe status and preview only", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({ visibility: "featured" }),
      {
        ...access([]),
        canView: true,
        canAccessPrivate: false,
      },
      null,
      { surface: "telegram" },
    );

    expect(snapshot.viewer).toMatchObject({
      userId: null,
      surface: "telegram",
      audience: "public",
      canView: true,
      canManage: false,
      sections: {
        status: true,
        preview: true,
        tasks: false,
        progress: false,
        specs: false,
        assets: false,
        secrets: false,
        budget: false,
        activity: false,
        settings: false,
        access: false,
      },
      effectiveCapabilities: [],
    });
    expect(snapshot.viewer.allowedActions).toMatchObject({
      view: true,
      startApp: false,
      stopApp: false,
      startAgent: false,
      pauseAgent: false,
      relaunch: false,
      launchSetup: false,
      writeSpecs: false,
      manageAssets: false,
      manageSecrets: false,
      revealSecrets: false,
      manageRequiredSecrets: false,
      viewBudget: false,
      manageBudget: false,
      manageSettings: false,
      manageAccess: false,
      deleteProject: false,
    });
    expect(snapshot.project.tgSpec).toEqual({
      sourceProjectId: null,
      mirrorSpecId: null,
      lastImportedVersion: null,
    });
    expect(snapshot.app).toMatchObject({
      publicStatus: "BUILDING",
      componentId: null,
      powerIntent: null,
      agentIntent: null,
      runtimeState: null,
      agentState: null,
      blockers: [],
      lastOutcome: null,
      retryAt: null,
      retryCount: 0,
      lastHeartbeat: null,
      loopRuntime: null,
      loopSupportStatus: null,
      loopSupportLabel: null,
      loopSupportHint: null,
    });
    expect(snapshot.preview).toEqual({
      url: "https://preview.example.test",
      health: "HEALTHY",
      checkedAt: updatedAt.toISOString(),
    });
    expect(snapshot.macBuild).toEqual({
      status: "not_available",
      latestArtifact: null,
      failureSummary: null,
      builderLabel: null,
      updatedAt: null,
    });
    expect(snapshot.execution.current).toMatchObject({
      type: "preview.ready",
      title: "Превью доступно",
      action: { kind: "open_preview" },
    });
    expect(snapshot.execution.statusSummary).toMatchObject({
      stage: "preview",
      title: "Превью доступно",
      activeBatchCount: 0,
      activeWorkItemCount: 0,
    });
    expect(snapshot.progress).toEqual({
      summary: {
        state: null,
        message: null,
        iteration: null,
        featuresCompleted: null,
        featuresTotal: null,
        currentFeature: null,
      },
      raw: null,
    });
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.feedback).toEqual([]);
    expect(snapshot.assumptions).toEqual([]);
    expect(snapshot.specs).toEqual([]);
    expect(snapshot.assets).toEqual([]);
    expect(snapshot.secrets).toEqual({ required: [], provided: [] });
    expect(snapshot.budget).toBeNull();
    expect(snapshot.activity).toEqual({ runEvents: [], projectEvents: [] });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
    expect(JSON.stringify(snapshot)).not.toContain("Build the product");
    expect(JSON.stringify(snapshot)).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("keeps progress as a stable summary with bounded raw object data", () => {
    const snapshot = buildProjectInteractionSnapshot(project(), access(["project.view"]), "user-1");

    expect(snapshot.progress.summary).toEqual({
      state: "working",
      message: "Building preview",
      iteration: 2,
      featuresCompleted: 1,
      featuresTotal: 3,
      currentFeature: "Checkout flow",
    });
    expect(snapshot.progress.raw).toEqual({
      state: "working",
      message: "Building preview",
      iteration: 2,
      featuresCompleted: 1,
      featuresTotal: 3,
      currentFeature: { description: "Checkout flow" },
      recentFeatures: [{ id: "feature-1", description: "Cart" }],
      steps: [
        {
          id: "task-1",
          label: "Checkout",
          status: "in_progress",
          orderIndex: 0,
          source: null,
        },
        { id: "task-2", label: "Deploy preview", status: "pending", orderIndex: 1, source: null },
      ],
    });
    expect(JSON.stringify(snapshot.progress.raw)).not.toContain("must-not-leak");
    expect(JSON.stringify(snapshot.progress.raw)).not.toContain("manager-facing context");
  });

  it("keeps detailed progress step descriptions for project managers only", () => {
    const snapshot = buildProjectInteractionSnapshot(project(), access(["project.view", "project.runtime.manage"]), "user-1");

    expect(snapshot.viewer.audience).toBe("admin");
    expect(snapshot.progress.raw?.steps?.[0]).toMatchObject({
      id: "task-1",
      label: "Checkout",
      description: "Implement checkout flow\nwith concise manager-facing context",
      status: "in_progress",
    });
  });

  it("derives execution progress from steps before legacy feature totals", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          message: "Legacy totals lag behind steps",
          featuresCompleted: 1,
          featuresTotal: 3,
          steps: [
            { id: "task-1", label: "Build API", status: "completed" },
            { id: "task-2", label: "Optional deploy", description: "Deploy step is optional for this run", status: "skipped" },
            { id: "task-3", label: "Ship UI", status: "pending" },
          ],
        }),
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.execution.current?.progress).toEqual({
      completed: 2,
      total: 3,
      percent: 67,
    });
    expect(snapshot.progress.raw?.steps?.[1]).toMatchObject({
      id: "task-2",
      label: "Optional deploy",
      status: "skipped",
    });
    expect(snapshot.progress.raw?.steps?.[1]?.description).toBeUndefined();
  });

  it("preserves skipped step descriptions for project managers", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          steps: [
            { id: "task-1", label: "Build API", status: "completed" },
            { id: "task-2", label: "Optional deploy", description: "Deploy step is optional for this run", status: "skipped" },
          ],
        }),
      }),
      access(["project.view", "project.runtime.manage"]),
      "user-1",
    );

    expect(snapshot.progress.raw?.steps?.[1]).toMatchObject({
      id: "task-2",
      label: "Optional deploy",
      description: "Deploy step is optional for this run",
      status: "skipped",
    });
  });

  it("keeps all sanitized progress steps so current work is not hidden after item 100", () => {
    const steps = Array.from({ length: 105 }, (_, index) => ({
      id: `task-${String(index + 1).padStart(3, "0")}`,
      label: `Task ${index + 1}`,
      status: index === 104 ? "in_progress" : "completed",
      debug: "must-not-leak",
    }));
    const snapshot = buildProjectInteractionSnapshot(
      project({
        progressJson: JSON.stringify({
          state: "working",
          message: "Working past the first page",
          featuresCompleted: 104,
          featuresTotal: 105,
          steps,
        }),
      }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.progress.raw?.steps).toHaveLength(105);
    expect(snapshot.progress.raw?.steps?.at(-1)).toMatchObject({
      id: "task-105",
      label: "Task 105",
      status: "in_progress",
      orderIndex: 104,
      source: null,
    });
    expect(snapshot.execution.current?.task?.id).toBe("task-105");
    expect(JSON.stringify(snapshot.progress.raw)).not.toContain("must-not-leak");
  });

  it("normalizes invalid progress payloads to an empty progress shape", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project({ progressJson: "[\"not\", \"a\", \"manager\", \"progress\", \"object\"]" }),
      access(["project.view"]),
      "user-1",
    );

    expect(snapshot.progress).toEqual({
      summary: {
        state: null,
        message: null,
        iteration: null,
        featuresCompleted: null,
        featuresTotal: null,
        currentFeature: null,
      },
      raw: null,
    });
  });

  it("serializes management actions from Arena capabilities", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project(),
      access([
        "project.view",
        "project.runtime.manage",
        "project.specs.write",
        "project.assets.manage",
        "project.secrets.manage",
        "project.secrets.reveal",
        "project.required_secrets.manage",
        "project.budget.manage",
        "project.settings.manage",
        "project.access.manage",
        "project.delete",
      ]),
      "user-1",
    );

    expect(snapshot.viewer.allowedActions).toMatchObject({
      view: true,
      startApp: true,
      stopApp: true,
      startAgent: true,
      pauseAgent: true,
      relaunch: true,
      launchSetup: false,
      writeSpecs: true,
      manageAssets: true,
      manageSecrets: true,
      revealSecrets: true,
      manageRequiredSecrets: true,
      viewBudget: true,
      manageBudget: true,
      manageSettings: true,
      manageAccess: true,
      deleteProject: true,
    });
    expect(snapshot.viewer).toMatchObject({
      surface: "arena",
      audience: "admin",
      sections: {
        secrets: true,
        budget: true,
        activity: true,
        settings: true,
        access: true,
      },
    });
    expect(snapshot.secrets.provided).toEqual([{
      id: "secret-1",
      key: "TELEGRAM_BOT_TOKEN",
      description: "Bot token",
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    }]);
  });

  it("disables runtime and admin verbs on the Telegram surface while keeping granted secret setup", () => {
    const snapshot = buildProjectInteractionSnapshot(
      project(),
      access([
        "project.view",
        "project.runtime.manage",
        "project.secrets.manage",
        "project.secrets.reveal",
        "project.required_secrets.manage",
        "project.budget.manage",
        "project.settings.manage",
        "project.access.manage",
        "project.delete",
      ]),
      "user-1",
      { surface: "telegram" },
    );

    expect(snapshot.viewer).toMatchObject({
      surface: "telegram",
      audience: "admin",
      sections: {
        status: true,
        preview: true,
        tasks: true,
        progress: true,
        specs: true,
        assets: true,
        secrets: true,
        budget: false,
        activity: false,
        settings: false,
        access: false,
      },
    });
    expect(snapshot.viewer.allowedActions).toMatchObject({
      view: true,
      startApp: false,
      stopApp: false,
      startAgent: false,
      pauseAgent: false,
      relaunch: false,
      launchSetup: false,
      writeSpecs: false,
      manageAssets: false,
      manageSecrets: true,
      revealSecrets: false,
      manageRequiredSecrets: true,
      viewBudget: false,
      manageBudget: false,
      manageSettings: false,
      manageAccess: false,
      deleteProject: false,
    });
    expect(snapshot.secrets.required).toHaveLength(2);
    expect(snapshot.secrets.provided).toHaveLength(1);
    expect(snapshot.budget).toBeNull();
    expect(snapshot.activity).toEqual({ runEvents: [], projectEvents: [] });
  });

  it("allows Telegram launch setup only as an explicit owner setup action", () => {
    const baseProject = project();
    const snapshot = buildProjectInteractionSnapshot(
      {
        ...baseProject,
        components: [{
          ...baseProject.components[0],
          powerIntent: "OFF",
          agentIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: null,
          sourceConfig: {
            recipe: "tg_spec_target",
            launchConfiguration: "tg_spec_launch_configuration_required",
          },
        }],
      },
      {
        ...access(["project.view", "project.runtime.manage"]),
        isOwner: true,
      },
      "user-1",
      { surface: "telegram" },
    );

    expect(snapshot.viewer.allowedActions).toMatchObject({
      startApp: false,
      startAgent: false,
      relaunch: false,
      launchSetup: true,
    });
  });
});

describe("getProjectInteractionSnapshotForViewer", () => {
  it("downloads visual evidence artifacts when current evidence has accepted diff identity", async () => {
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    const reviewId = `visual:${createHash("sha256").update(sourceEvidenceRef).digest("hex").slice(0, 16)}`;
    const asset = {
      id: "asset-visual",
      path: `${visualEvidenceAssetPathPrefixForReviewId(reviewId)}capture.png`,
      originalName: "capture.png",
      contentType: "image/png",
      sizeBytes: 3,
      sha256: visualDigest,
      storageKey: "visual/capture.png",
      uploadedById: "system",
      createdAt,
      updatedAt,
    };
    mocks.projectFindUnique.mockResolvedValueOnce(projectWithAcceptedVisualArtifact({
      progressJson: JSON.stringify({
        state: "completed",
        steps: [{
          id: "task-1",
          label: "Fix synth pad visual state",
          status: "completed",
          feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
          visualEvidence: [{
            sourceEvidenceRef,
            sourceKind: "visual_workbench",
            result: "inconclusive",
            observedAt: "2026-06-07T09:00:00.000Z",
            summary: "Visual Workbench story captured.",
            feedbackItemIds: ["BUG-006"],
            diffItemIds: ["DIFF-003-BUG-006"],
            artifactSha256: `sha256:${visualDigest}`,
            target: {
              route: "/visual-workbench/synth-pad.playing.desktop",
              viewport: { width: 1280, height: 800 },
              claim: "synth pad shows the active playing state",
            },
          }],
        }],
      }),
      assets: [asset],
    }));
    mocks.readProjectAssetBytes.mockResolvedValueOnce(Buffer.from("png"));

    await expect(getProjectVisualEvidenceArtifactForDownload({
      projectId: "project-1",
      reviewId,
    })).resolves.toEqual({
      bytes: Buffer.from("png"),
      contentType: "image/png",
      sha256: `sha256:${visualDigest}`,
    });
    expect(mocks.readProjectAssetBytes).toHaveBeenCalledWith(asset);
  });

  it("does not download visual evidence artifacts when the evidence row lacks accepted diff identity", async () => {
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    const reviewId = `visual:${createHash("sha256").update(sourceEvidenceRef).digest("hex").slice(0, 16)}`;

    mocks.projectFindUnique.mockResolvedValueOnce(projectWithAcceptedVisualArtifact({
      progressJson: JSON.stringify({
        state: "completed",
        steps: [{
          id: "task-1",
          label: "Fix synth pad visual state",
          status: "completed",
          feedbackItemRefs: [{ itemId: "BUG-006", diffItemId: "DIFF-003-BUG-006" }],
          visualEvidence: [{
            sourceEvidenceRef,
            sourceKind: "visual_workbench",
            result: "inconclusive",
            observedAt: "2026-06-07T09:00:00.000Z",
            summary: "Visual Workbench story captured.",
            feedbackItemIds: ["BUG-006"],
            artifactSha256: `sha256:${visualDigest}`,
            target: {
              route: "/visual-workbench/synth-pad.playing.desktop",
              viewport: { width: 1280, height: 800 },
              claim: "synth pad shows the active playing state",
            },
          }],
        }],
      }),
      assets: [{
        id: "asset-visual",
        path: `${visualEvidenceAssetPathPrefixForReviewId(reviewId)}capture.png`,
        originalName: "capture.png",
        contentType: "image/png",
        sizeBytes: 3,
        sha256: visualDigest,
        storageKey: "visual/capture.png",
        uploadedById: "system",
        createdAt,
        updatedAt,
      }],
    }));

    await expect(getProjectVisualEvidenceArtifactForDownload({
      projectId: "project-1",
      reviewId,
    })).resolves.toBeNull();
  });

  it("rejects unauthenticated private viewers without returning a snapshot", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(project());
    mocks.resolveProjectAccess.mockResolvedValueOnce({
      ...access([]),
      canView: false,
      canAccessPrivate: false,
    });

    const result = await getProjectInteractionSnapshotForViewer({
      projectId: "project-1",
      session: null,
      hasBypass: false,
    });

    expect(result).toEqual({ status: "unauthorized" });
    expect(mocks.projectFindUnique).toHaveBeenCalled();
  });

  it("returns a public snapshot for featured guests without private project access", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(project({ visibility: "featured" }));
    mocks.resolveProjectAccess.mockResolvedValueOnce({
      ...access([]),
      canView: true,
      canAccessPrivate: false,
    });

    const result = await getProjectInteractionSnapshotForViewer({
      projectId: "project-1",
      session: null,
      hasBypass: false,
      surface: "telegram",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.viewer).toMatchObject({
      userId: null,
      surface: "telegram",
      audience: "public",
      canView: true,
      canManage: false,
      effectiveCapabilities: [],
    });
    expect(result.snapshot.specs).toEqual([]);
    expect(result.snapshot.tasks).toEqual([]);
    expect(result.snapshot.feedback).toEqual([]);
    expect(result.snapshot.assumptions).toEqual([]);
    expect(result.snapshot.secrets).toEqual({ required: [], provided: [] });
  });

  it("returns a public snapshot for authenticated public viewers without private project access", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(project({ visibility: "public" }));
    mocks.resolveProjectAccess.mockResolvedValueOnce({
      ...access([]),
      canView: true,
      canAccessPrivate: false,
    });

    const result = await getProjectInteractionSnapshotForViewer({
      projectId: "project-1",
      session: { user: { id: "user-public" } } as any,
      hasBypass: false,
      surface: "telegram",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.viewer).toMatchObject({
      userId: "user-public",
      surface: "telegram",
      audience: "public",
      canView: true,
      canManage: false,
      effectiveCapabilities: [],
    });
    expect(result.snapshot.specs).toEqual([]);
    expect(result.snapshot.tasks).toEqual([]);
    expect(result.snapshot.feedback).toEqual([]);
    expect(result.snapshot.assumptions).toEqual([]);
    expect(result.snapshot.secrets).toEqual({ required: [], provided: [] });
  });

  it("allows project.view grants to read a manager snapshot without management actions", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(project());
    mocks.resolveProjectAccess.mockResolvedValueOnce({
      ...access(["project.view"]),
      canManage: false,
      canAccessPrivate: true,
    });

    const result = await getProjectInteractionSnapshotForViewer({
      projectId: "project-1",
      session: { user: { id: "user-2" } } as any,
      hasBypass: false,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.snapshot.viewer).toMatchObject({
      userId: "user-2",
      canView: true,
      canManage: false,
      effectiveCapabilities: ["project.view"],
    });
    expect(result.snapshot.viewer.allowedActions).toMatchObject({
      view: true,
      startApp: false,
      stopApp: false,
      manageSecrets: false,
      manageBudget: false,
      deleteProject: false,
    });
    expect(result.snapshot.viewer.sections).toMatchObject({
      specs: false,
      secrets: false,
      budget: false,
      activity: false,
    });
    expect(result.snapshot.specs).toEqual([]);
    expect(result.snapshot.secrets).toEqual({ required: [], provided: [] });
    expect(result.snapshot.budget).toBeNull();
    expect(result.snapshot.activity).toEqual({ runEvents: [], projectEvents: [] });
  });
});

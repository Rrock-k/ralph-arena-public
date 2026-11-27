import { describe, expect, it } from "vitest";
import {
  ProjectInteractionProgressSchema,
  ProjectInteractionSnapshotSchema,
} from "../project-interaction.js";

function validSnapshot() {
  return {
    version: "ra-287.project-interaction.v2",
    project: {
      id: "project-1",
      name: "Telegram Shop",
      slug: "telegram-shop",
      mode: "personal",
      visibility: "private",
      archivedAt: null,
      createdAt: "2026-05-09T10:00:00.000Z",
      updatedAt: "2026-05-09T10:05:00.000Z",
      tgSpec: {
        sourceProjectId: "tg-project-1",
        mirrorSpecId: "spec-1",
        lastImportedVersion: 3,
      },
    },
    viewer: {
      userId: "user-1",
      surface: "arena",
      audience: "admin",
      canView: true,
      canManage: true,
      sections: {
        status: true,
        preview: true,
        tasks: true,
        feedback: true,
        assumptions: true,
        progress: true,
        specs: true,
        assets: true,
        secrets: true,
        budget: true,
        activity: true,
        settings: false,
        access: false,
      },
      effectiveCapabilities: [
        "project.view",
        "project.runtime.manage",
        "project.secrets.manage",
        "project.budget.view",
      ],
      allowedActions: {
        view: true,
        startApp: true,
        stopApp: true,
        startAgent: true,
        pauseAgent: true,
        relaunch: true,
        launchSetup: false,
        writeSpecs: false,
        manageAssets: false,
        manageSecrets: true,
        revealSecrets: false,
        manageRequiredSecrets: false,
        viewBudget: true,
        manageBudget: false,
        manageSettings: false,
        manageAccess: false,
        deleteProject: false,
      },
    },
    app: {
      publicStatus: "BUILDING",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["SECRETS"],
      lastOutcome: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: "2026-05-09T10:05:00.000Z",
      retryAt: null,
      retryCount: 0,
      lastHeartbeat: "2026-05-09T10:05:00.000Z",
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
    },
    preview: {
      url: "https://preview.example.test",
      health: "HEALTHY",
      checkedAt: "2026-05-09T10:05:00.000Z",
    },
    macBuild: {
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
        createdAt: "2026-05-09T10:06:00.000Z",
        downloadUrl: "/api/projects/project-1/release-artifacts/release-1/download",
      },
      failureSummary: null,
      builderLabel: "sample-machine",
      updatedAt: "2026-05-09T10:06:00.000Z",
    },
    progress: {
      summary: {
        state: "working",
        message: "Building preview",
        iteration: 2,
        featuresCompleted: 1,
        featuresTotal: 3,
        currentFeature: "Checkout flow",
      },
      raw: {
        state: "working",
        message: "Building preview",
        iteration: 2,
        currentFeature: { description: "Checkout flow" },
      },
    },
    execution: {
      current: {
        id: "project-1:progress.updated:task-1",
        type: "progress.updated",
        title: "Ralph работает",
        summary: "Checkout flow",
        tone: "active",
        createdAt: "2026-05-09T10:05:00.000Z",
        task: {
          id: "task-1",
          label: "Checkout flow",
          status: "in_progress",
          orderIndex: 0,
          source: null,
        },
        progress: {
          completed: 1,
          total: 3,
          percent: 33,
        },
        acceptedUpdate: null,
        previewUrl: null,
        action: {
          kind: "open_work",
          label: "Ход работы",
        },
      },
      feed: [{
        id: "project-1:progress.updated:task-1",
        type: "progress.updated",
        title: "Ralph работает",
        summary: "Checkout flow",
        tone: "active",
        createdAt: "2026-05-09T10:05:00.000Z",
        task: {
          id: "task-1",
          label: "Checkout flow",
          status: "in_progress",
          orderIndex: 0,
          source: null,
        },
        progress: {
          completed: 1,
          total: 3,
          percent: 33,
        },
        acceptedUpdate: null,
        previewUrl: null,
        action: {
          kind: "open_work",
          label: "Ход работы",
        },
      }],
      latestAcceptedUpdate: null,
      activeChangeBatches: [{
        id: "DIFF-003",
        sourceVersion: 3,
        targetSpecVersion: 3,
        artifactId: "SPEC-003",
        diffId: "DIFF-003",
        summary: "Feedback update",
        acceptedAt: "2026-05-09T10:05:00.000Z",
        status: "in_progress",
        workItemCount: 2,
        completedItemCount: 1,
        pendingItemCount: 1,
        changeCounts: {
          added: 1,
          updated: 0,
          reopened: 1,
          corrected: 0,
          removed: 0,
          superseded: 0,
          other: 0,
        },
      }],
      statusSummary: {
        stage: "working",
        title: "Ralph работает",
        summary: "Сейчас: Checkout flow",
        lines: [
          "Сейчас: Checkout flow",
          "Активные изменения: 1/2 пунктов выполнено",
        ],
        currentTaskLabel: "Checkout flow",
        activeBatchCount: 1,
        activeWorkItemCount: 1,
        completedWorkItemCount: 1,
        action: {
          kind: "open_work",
          label: "Ход работы",
        },
      },
    },
    collections: {
      tasks: { total: 1, visible: 1, limit: 100, hasMore: false },
      feedback: { total: 1, visible: 1, limit: 100, hasMore: false },
      assumptions: { total: 1, visible: 1, limit: 100, hasMore: false },
    },
    tasks: [{
      id: "task-1",
      label: "Checkout flow",
      status: "in_progress",
      orderIndex: 0,
      source: null,
    }],
    proofReviews: [],
    visualEvidenceReviews: [],
    feedback: [{
      id: "BUG-001",
      title: "Checkout still fails",
      body: "Users still cannot complete checkout.",
      state: "reopened",
      reopenCount: 2,
      orderIndex: 0,
      resolution: null,
    }],
    assumptions: [{
      id: "ASM-001",
      title: "AI provider",
      statement: "Production generation requires a real provider.",
      state: "corrected",
      orderIndex: 0,
      outcome: {
        kind: "corrected_into_spec",
        correctionSummary: "Use the configured production provider.",
      },
    }],
    specs: [{
      id: "spec-1",
      title: "Spec",
      content: "Build the product",
      orderIndex: 0,
      createdAt: "2026-05-09T10:00:00.000Z",
      updatedAt: "2026-05-09T10:05:00.000Z",
      versions: [{
        id: "spec-version-3",
        version: 3,
        content: "Build the product",
        message: "Accepted in Telegram",
        createdAt: "2026-05-09T10:05:00.000Z",
      }],
      latestVersion: {
        version: 3,
        message: "Accepted in Telegram",
        createdAt: "2026-05-09T10:05:00.000Z",
      },
    }],
    assets: [{
      id: "asset-1",
      path: "assets/logo.png",
      originalName: "logo.png",
      contentType: "image/png",
      sizeBytes: 42,
      sha256: "hash",
      uploadedById: "tg-spec",
      createdAt: "2026-05-09T10:00:00.000Z",
      updatedAt: "2026-05-09T10:05:00.000Z",
    }],
    secrets: {
      required: [{
        key: "TELEGRAM_BOT_TOKEN",
        description: "Bot token",
        blocking: true,
        requestedAt: "2026-05-09T10:01:00.000Z",
        provided: false,
        providedAt: null,
      }],
      provided: [{
        id: "secret-1",
        key: "STRIPE_SECRET_KEY",
        description: "Stripe key",
        createdAt: "2026-05-09T10:00:00.000Z",
        updatedAt: "2026-05-09T10:05:00.000Z",
      }],
    },
    budget: {
      isEnabled: true,
      totalCreditsUsd: 25,
      usedCreditsUsd: 2,
    },
    activity: {
      runEvents: [{
        id: "run-log-1",
        event: "RUNNING",
        label: "Running",
        createdAt: "2026-05-09T10:00:00.000Z",
      }],
      projectEvents: [{
        id: "event-1",
        direction: "out",
        type: "required_secrets",
        label: "Required Secrets",
        userId: null,
        createdAt: "2026-05-09T10:00:00.000Z",
      }],
    },
  };
}

describe("ProjectInteractionSnapshotSchema", () => {
  it("parses a representative manager snapshot", () => {
    expect(ProjectInteractionSnapshotSchema.parse(validSnapshot())).toMatchObject({
      version: "ra-287.project-interaction.v2",
      project: { visibility: "private" },
      app: { publicStatus: "BUILDING", runtimeState: "RUNNING" },
    });
  });

  it("accepts the public audience tier for visibility-safe snapshots", () => {
    const snapshot = validSnapshot() as any;
    snapshot.viewer.userId = null;
    snapshot.viewer.audience = "public";
    snapshot.viewer.canManage = false;
    snapshot.viewer.sections = {
      status: true,
      preview: true,
      tasks: false,
      feedback: false,
      assumptions: false,
      progress: false,
      specs: false,
      assets: false,
      secrets: false,
      budget: false,
      activity: false,
      settings: false,
      access: false,
    };
    snapshot.viewer.effectiveCapabilities = [];
    snapshot.viewer.allowedActions = {
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
    };
    snapshot.feedback = [];
    snapshot.assumptions = [];

    expect(ProjectInteractionSnapshotSchema.parse(snapshot)).toMatchObject({
      viewer: { audience: "public", canManage: false },
    });
  });

  it("rejects unknown lifecycle and status vocabulary", () => {
    const snapshot = validSnapshot() as any;
    snapshot.app.agentState = "PAUSED";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects unsafe Mac build download URLs", () => {
    const snapshot = validSnapshot() as any;
    snapshot.macBuild.latestArtifact.downloadUrl = "https://example.test/Petsik.zip";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects unknown access capabilities", () => {
    const snapshot = validSnapshot() as any;
    snapshot.viewer.effectiveCapabilities.push("telegram.manage.project");

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects unknown interaction surface vocabulary", () => {
    const snapshot = validSnapshot() as any;
    snapshot.viewer.surface = "telegram-admin";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects unknown task status vocabulary", () => {
    const snapshot = validSnapshot() as any;
    snapshot.tasks[0].status = "blocked";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("accepts strict proof review projections with safe Arena asset URLs", () => {
    const snapshot = validSnapshot() as any;
    snapshot.proofReviews = [{
      id: "proof:TASK-BUG-001",
      taskId: "TASK-BUG-001",
      taskLabel: "Checkout proof",
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
        diffItemIds: ["DIFF-003-BUG-001"],
        changeType: "reopened",
        feedbackId: "BUG-001",
      },
      before: {
        role: "before",
        kind: "screenshot",
        availability: "available",
        url: "/api/internal/projects/project-1/assets/asset-before/download",
        assetId: "asset-before",
        contentType: "image/png",
        sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        capturedAt: "2026-05-09T10:03:00.000Z",
        unavailableReason: null,
      },
      after: {
        role: "after",
        kind: "screenshot",
        availability: "available",
        url: "/api/internal/projects/project-1/assets/asset-after/download",
        assetId: "asset-after",
        contentType: "image/png",
        sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        capturedAt: "2026-05-09T10:04:00.000Z",
        unavailableReason: null,
      },
    }];

    expect(ProjectInteractionSnapshotSchema.parse(snapshot).proofReviews).toHaveLength(1);
  });

  it("accepts visual evidence review projections with safe project focus hrefs", () => {
    const snapshot = validSnapshot() as any;
    snapshot.visualEvidenceReviews = [{
      id: "visual:abc123",
      taskId: "task-1",
      taskLabel: "Checkout flow",
      status: "unassessed",
      action: {
        kind: "review_visual_evidence",
        label: "Проверить скриншоты",
        href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
      },
      sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
      feedbackItemIds: ["BUG-001"],
      diffItemIds: ["DIFF-003-BUG-001"],
      sourceKind: "visual_workbench",
      target: {
        route: "/checkout",
        viewport: { width: 1280, height: 800 },
        claim: "checkout completes",
        state: null,
        interaction: null,
      },
      observedAt: "2026-05-16T12:02:00.000Z",
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
    }];

    expect(ProjectInteractionSnapshotSchema.parse(snapshot).visualEvidenceReviews).toHaveLength(1);
  });

  it("rejects visual evidence review projections with raw file hrefs", () => {
    const snapshot = validSnapshot() as any;
    snapshot.visualEvidenceReviews = [{
      id: "visual:abc123",
      taskId: "task-1",
      taskLabel: "Checkout flow",
      status: "unassessed",
      action: {
        kind: "review_visual_evidence",
        label: "Проверить скриншоты",
        href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
      },
      sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
      feedbackItemIds: ["BUG-001"],
      diffItemIds: ["DIFF-003-BUG-001"],
      sourceKind: "visual_workbench",
      target: {
        route: "/checkout",
        viewport: { width: 1280, height: 800 },
        claim: "checkout completes",
        state: null,
        interaction: null,
      },
      observedAt: "2026-05-16T12:02:00.000Z",
      summary: "Visual Workbench story captured.",
      artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      artifact: {
        availability: "unavailable",
        url: "/tmp/.ralph/visual-workbench/capture.png",
        contentType: null,
        sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        unavailableReason: "missing_artifact",
      },
      assessments: [],
    }];

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects raw proof paths and incomplete available proof artifacts", () => {
    const withRawPath = validSnapshot() as any;
    withRawPath.proofReviews = [{
      id: "proof:TASK-BUG-001",
      taskId: "TASK-BUG-001",
      taskLabel: "Checkout proof",
      status: "unavailable",
      action: {
        kind: "review_screenshots",
        label: "Проверить скриншоты",
      },
      source: {
        sourceVersion: 3,
        targetSpecVersion: 3,
        artifactId: "SPEC-003",
        diffId: "DIFF-003",
        diffItemIds: ["DIFF-003-BUG-001"],
        changeType: "reopened",
        feedbackId: "BUG-001",
      },
      before: {
        role: "before",
        kind: "screenshot",
        availability: "unavailable",
        url: null,
        assetId: null,
        contentType: "image/png",
        sha256: null,
        capturedAt: null,
        unavailableReason: "unsafe_path",
        artifactPath: ".ralph/evidence/task/before.png",
      },
      after: {
        role: "after",
        kind: "screenshot",
        availability: "available",
        url: null,
        assetId: "asset-after",
        contentType: "image/png",
        sha256: null,
        capturedAt: null,
        unavailableReason: null,
      },
    }];

    expect(ProjectInteractionSnapshotSchema.safeParse(withRawPath).success).toBe(false);
  });

  it("rejects unknown execution feed vocabulary", () => {
    const snapshot = validSnapshot() as any;
    snapshot.execution.current.type = "runner.paused";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects unknown feedback status vocabulary", () => {
    const snapshot = validSnapshot() as any;
    snapshot.feedback[0].state = "waiting_for_verification";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects retired feedback to task back-links", () => {
    const snapshot = validSnapshot() as any;
    snapshot.feedback[0].relatedTaskIds = ["task-1"];

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects extra fields on accepted assumption projections", () => {
    const snapshot = validSnapshot() as any;
    snapshot.assumptions[0].rawJudgmentId = "judgment-001";

    expect(ProjectInteractionSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

describe("ProjectInteractionProgressSchema", () => {
  it("keeps raw progress bounded to object-shaped payloads", () => {
    expect(ProjectInteractionProgressSchema.safeParse({
      summary: {
        state: null,
        message: null,
        iteration: null,
        featuresCompleted: null,
        featuresTotal: null,
        currentFeature: null,
      },
      raw: ["not", "an", "object"],
    }).success).toBe(false);
  });

  it("rejects raw progress fields outside the safe display projection", () => {
    expect(ProjectInteractionProgressSchema.safeParse({
      summary: {
        state: null,
        message: null,
        iteration: null,
        featuresCompleted: null,
        featuresTotal: null,
        currentFeature: null,
      },
      raw: {
        state: "working",
        secret: "must-not-leak",
      },
    }).success).toBe(false);
  });

  it("accepts sanitized pending assumption reviews in raw progress", () => {
    expect(ProjectInteractionProgressSchema.parse({
      summary: {
        state: null,
        message: null,
        iteration: null,
        featuresCompleted: null,
        featuresTotal: null,
        currentFeature: null,
      },
      raw: {
        assumptionReviews: [{
          id: "ASM-RALPH-BUG-005",
          title: "Needs confirmation for BUG-005",
          statement: "BUG-005 appears implemented, but product evidence has not confirmed it yet.",
          sourceRefs: ["BUG-005"],
        }],
      },
    }).raw?.assumptionReviews?.[0]).toMatchObject({
      id: "ASM-RALPH-BUG-005",
    });
  });
});

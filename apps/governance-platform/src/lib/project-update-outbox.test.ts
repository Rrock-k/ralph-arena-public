import { describe, expect, it, vi } from "vitest";
import {
  ackProjectUpdateDelivery,
  buildProjectUpdatePayload,
  claimProjectUpdates,
  enqueueProjectUpdate,
  PROJECT_UPDATE_EVENT_DEFINITIONS,
} from "./project-update-outbox";

describe("project update outbox", () => {
  it("builds safe payloads without carrying raw or secret fields", () => {
    const payload = buildProjectUpdatePayload("required_secret.missing", {
      requiredSecretKeys: ["telegram_bot_token", "bad key", "OPENAI_API_KEY"],
      secretValue: "must-not-leak",
      log: "raw runner log",
      stack: "stack trace",
    });

    expect(payload).toEqual({
      requiredSecretKeys: ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"],
      count: 2,
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
    expect(JSON.stringify(payload)).not.toContain("raw runner log");
    expect(JSON.stringify(payload)).not.toContain("stack trace");
  });

  it("drops local or private preview URLs from delivery payloads", () => {
    expect(buildProjectUpdatePayload("preview.ready", {
      previewUrl: "http://127.0.0.1:3000",
    })).toEqual({});
    expect(buildProjectUpdatePayload("preview.ready", {
      previewUrl: "https://preview-demo.arena.example.test",
    })).toEqual({
      previewUrl: "https://preview-demo.arena.example.test/",
    });
  });

  it("keeps only real Telegram Mini App entrypoint links in ready payloads", () => {
    expect(buildProjectUpdatePayload("preview.ready", {
      previewUrl: "https://preview-demo.arena.example.test",
      telegramMiniAppUrl: "https://t.me/samplebot/sampleapp?startapp=arena-project-1",
      rawTelegramPreviewEntryUrl: "https://app.arena.example.test/api/auth/telegram-preview-entry?projectId=arena-project-1",
    })).toEqual({
      previewUrl: "https://preview-demo.arena.example.test/",
      telegramMiniAppUrl: "https://t.me/samplebot/sampleapp?startapp=arena-project-1",
    });

    expect(buildProjectUpdatePayload("preview.ready", {
      telegramMiniAppUrl: "https://t.me/samplebot?startapp=arena-project-1",
    })).toEqual({
      telegramMiniAppUrl: "https://t.me/samplebot?startapp=arena-project-1",
    });

    expect(buildProjectUpdatePayload("preview.ready", {
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=arena-project-1",
    })).toEqual({
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=arena-project-1",
    });

    expect(buildProjectUpdatePayload("preview.ready", {
      telegramMiniAppUrl: "https://app.arena.example.test/api/auth/telegram-preview-entry?projectId=arena-project-1",
    })).toEqual({});
    expect(buildProjectUpdatePayload("preview.ready", {
      telegramMiniAppUrl: "https://t.me/samplebot",
    })).toEqual({});
    expect(buildProjectUpdatePayload("preview.ready", {
      telegramMiniAppUrl: "https://t.me/samplebot?startapp=bad:value",
    })).toEqual({});
  });

  it("builds a non-failure evidence-needed payload for manual blockers", () => {
    expect(buildProjectUpdatePayload("work.needs_evidence", {
      reasonCode: "manual",
      summary: "Controller escalation requires production user evidence before continuing.",
      rawLog: "must-not-leak",
    })).toEqual({
      outcome: "needs_evidence",
      reasonCode: "MANUAL",
      summary: "Controller escalation requires production user evidence before continuing.",
    });
  });

  it("builds compact execution progress payloads", () => {
    expect(buildProjectUpdatePayload("planning.started", {
      rawLog: "must-not-leak",
    })).toEqual({ phase: "planning" });
    expect(buildProjectUpdatePayload("plan.ready", {
      sourceVersion: 8,
      targetSpecVersion: 8,
      workItemCount: 3,
      totalTasks: 110,
      rawPlan: "must-not-leak",
    })).toEqual({
      sourceVersion: 8,
      targetSpecVersion: 8,
      workItemCount: 3,
    });
    expect(buildProjectUpdatePayload("progress.updated", {
      currentTask: "  Build checkout preview\nwith payment state  ",
      completedTasks: 2,
      totalTasks: 5,
      percent: 40,
      rawRunnerState: "must-not-leak",
    })).toEqual({
      currentTask: "Build checkout preview with payment state",
    });
    expect(JSON.stringify(buildProjectUpdatePayload("progress.updated", {
      rawRunnerState: "must-not-leak",
    }))).not.toContain("must-not-leak");
    expect(buildProjectUpdatePayload("task.completed", {
      taskId: "task-001",
      title: "  Build checkout preview\nwith payment state  ",
      status: "completed",
      diffItemId: "DIFF-012-SPEC",
      feedbackItemId: "BUG-001",
      coveredSummary: "Product Spec: checkout must show the payment state.",
      rawRunnerState: "must-not-leak",
    })).toEqual({
      taskId: "task-001",
      title: "Build checkout preview with payment state",
      status: "completed",
      diffItemId: "DIFF-012-SPEC",
      feedbackItemId: "BUG-001",
      coveredSummary: "Product Spec: checkout must show the payment state.",
    });
  });

  it("builds safe scoped change-batch completion payloads", () => {
    expect(buildProjectUpdatePayload("change_batch.completed", {
      sourceVersion: 12,
      targetSpecVersion: 12,
      diffId: "diff-012",
      summary: "Checkout update finished.",
      workItemCount: 3,
      remainingBatchCount: 1,
      nextSourceVersion: 13,
      nextTargetSpecVersion: 13,
      versionLabel: "22.32",
      completedItems: [
        {
          diffItemId: "DIFF-012-BUG-001",
          feedbackItemId: "BUG-001",
          title: "Лишний скролл убран.",
          verification: "Откройте Mini App и проверьте экран Study.",
          coveredSummary: "Product Spec: убрать лишний скролл на экране Study.",
          versionLabel: "v22.32",
          rawRunnerState: "must-not-leak",
        },
      ],
      previewUrl: "https://preview-demo.arena.example.test",
      telegramMiniAppUrl: "https://telegram.me/sample_bot/sampleapp?startapp=batch-1",
      proofReviewId: "proof:TASK-BUG-006",
      proofReviewStatus: "ready",
      proofArtifactPath: ".ralph/evidence/task-1/after.png",
      rawProgress: "must-not-leak",
      totalTasks: 110,
    })).toEqual({
      outcome: "completed",
      sourceVersion: 12,
      targetSpecVersion: 12,
      diffId: "DIFF-012",
      summary: "Checkout update finished.",
      workItemCount: 3,
      remainingBatchCount: 1,
      nextSourceVersion: 13,
      nextTargetSpecVersion: 13,
      versionLabel: "v22.32",
      completedItems: [{
        diffItemId: "DIFF-012-BUG-001",
        feedbackItemId: "BUG-001",
        title: "Лишний скролл убран.",
        verification: "Откройте Mini App и проверьте экран Study.",
        coveredSummary: "Product Spec: убрать лишний скролл на экране Study.",
        versionLabel: "v22.32",
      }],
      previewUrl: "https://preview-demo.arena.example.test/",
      telegramMiniAppUrl: "https://telegram.me/sample_bot/sampleapp?startapp=batch-1",
    });
    expect(JSON.stringify(buildProjectUpdatePayload("change_batch.completed", {
      proofReviewId: "proof:TASK-BUG-006",
      proofReviewStatus: "ready",
      proofArtifactPath: ".ralph/evidence/task-1/after.png",
      rawProgress: "must-not-leak",
    }))).not.toContain("review_screenshots");
  });

  it("does not add legacy proof-review metadata to completed-work payloads", () => {
    expect(buildProjectUpdatePayload("work.completed", {
      previewUrl: "https://preview-demo.arena.example.test",
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
      proofReviewId: "proof:TASK-BUG-006",
      proofReviewStatus: "ready",
      proofArtifactPath: ".ralph/evidence/task-1/after.png",
      rawProof: "must-not-leak",
    })).toEqual({
      outcome: "completed",
      previewUrl: "https://preview-demo.arena.example.test/",
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
    });

    expect(buildProjectUpdatePayload("work.completed", {
      proofReviewId: "proof:TASK-BUG-006",
      proofReviewStatus: "blocked",
    })).toEqual({
      outcome: "completed",
    });
    expect(buildProjectUpdatePayload("work.completed", {
      proofReviewId: "proof:TASK-BUG-006",
      proofReviewStatus: "expected",
    })).toEqual({
      outcome: "completed",
    });
    expect(buildProjectUpdatePayload("change_batch.completed", {
      proofReviewId: "proof:TASK-BUG-006",
    })).toEqual({
      outcome: "completed",
    });
    expect(JSON.stringify(buildProjectUpdatePayload("work.completed", {
      proofReviewId: "../secret",
      proofReviewStatus: "ready",
      rawProof: "must-not-leak",
    }))).not.toContain("must-not-leak");
  });

  it("keeps action-required payloads safe and non-secret", () => {
    const payload = buildProjectUpdatePayload("action.required", {
      reasonCode: "secrets",
      summary: "Manager needs to fill project settings.",
      actionHref: "https://app.arena.example.test/my/projects/project-1",
      secretValue: "must-not-leak",
      rawLog: "must-not-leak",
    });

    expect(payload).toEqual({
      reasonCode: "SECRETS",
      summary: "Manager needs to fill project settings.",
      actionHref: "https://app.arena.example.test/my/projects/project-1",
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
  });

  it("keeps public assumption action-required payloads redacted", () => {
    const payload = buildProjectUpdatePayload("action.required", {
      reasonCode: "assumption",
      assumptionId: "ASM-RALPH-PROVIDER",
      assumptionTitle: "Provider choice",
      summary: "The spec does not name a production provider, so Ralph will use the configured provider.",
      rawJudgmentId: "judgment-001",
      options: ["private option"],
      reasoning: "private reasoning",
    });

    expect(payload).toEqual({
      reasonCode: "ASSUMPTION",
      summary: "The spec does not name a production provider, so Ralph will use the configured provider.",
      assumptionId: "ASM-RALPH-PROVIDER",
      assumptionTitle: "Provider choice",
    });
    expect(JSON.stringify(payload)).not.toContain("judgment-001");
    expect(JSON.stringify(payload)).not.toContain("private option");
    expect(JSON.stringify(payload)).not.toContain("private reasoning");
  });

  it("keeps only safe spec import correlation metadata", () => {
    const payload = buildProjectUpdatePayload("spec.imported", {
      sourceProjectId: "tg-proj-1",
      sourceVersion: 8,
      sourceUrl: "https://tg-spec.example/projects/tg-proj-1/specs/8",
      changeSummary: "BUG-001 reopened after production feedback.",
      specId: "spec-1",
      specVersionId: "spec-version-6",
      specVersion: 6,
      acceptedAt: "2026-05-15T08:30:00.000Z",
      importedAt: "2026-05-15T08:31:00.000Z",
      diffItemCount: 2,
      diffItemIds: ["BUG-001", "BUG-002", "BUG-001"],
      workItemCount: 1,
      workItemIds: ["BUG-001"],
      reopenedItemIds: ["BUG-001"],
      metadataHash: "sha256:abc123",
      metadataStatus: "present",
      evidence: [{ excerpt: "raw private Telegram text should not travel in outbox" }],
      sourceChannelId: "-100123",
    });

    expect(payload).toEqual({
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-proj-1",
      sourceVersion: 8,
      sourceUrl: "https://tg-spec.example/projects/tg-proj-1/specs/8",
      changeSummary: "BUG-001 reopened after production feedback.",
      specId: "spec-1",
      specVersionId: "spec-version-6",
      specVersion: 6,
      acceptedAt: "2026-05-15T08:30:00.000Z",
      importedAt: "2026-05-15T08:31:00.000Z",
      diffItemCount: 2,
      diffItemIds: ["BUG-001", "BUG-002"],
      workItemCount: 1,
      workItemIds: ["BUG-001"],
      reopenedItemIds: ["BUG-001"],
      metadataHash: "sha256:abc123",
      metadataStatus: "present",
    });
    expect(JSON.stringify(payload)).not.toContain("raw private Telegram text");
    expect(JSON.stringify(payload)).not.toContain("-100123");
  });

  it("separates contributor and manager audiences", () => {
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["planning.started"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["progress.updated"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["task.completed"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["change_batch.completed"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["action.required"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["work.completed"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["work.needs_evidence"]).toMatchObject({
      audience: "project_contributors",
      requiredCapability: "project.view",
    });
    expect(PROJECT_UPDATE_EVENT_DEFINITIONS["required_secret.missing"]).toMatchObject({
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
    });
  });

  it("enqueues only tg-spec eligible projects with event dedupe", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "event-1" });
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          tgSpecSourceProjectId: "tg-project-1",
        }),
      },
      projectUpdateOutbox: { upsert },
    } as any;

    await enqueueProjectUpdate(db, {
      projectId: "arena-project-1",
      eventType: "spec.imported",
      dedupeKey: "tg-project-1:v3",
      payload: {
        sourceProjectId: "tg-project-1",
        sourceVersion: 3,
        changeSummary: "Accepted checkout work",
      },
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        projectId_dedupeKey: {
          projectId: "arena-project-1",
          dedupeKey: "spec.imported:tg-project-1:v3",
        },
      },
      update: {},
      create: expect.objectContaining({
        projectId: "arena-project-1",
        eventType: "spec.imported",
        audience: "project_contributors",
        requiredCapability: "project.view",
        dedupeKey: "spec.imported:tg-project-1:v3",
        payload: expect.objectContaining({
          sourceProjectId: "tg-project-1",
          sourceVersion: 3,
        }),
      }),
    });
  });

  it("skips projects that are not tg-spec targets or bound sources", async () => {
    const upsert = vi.fn();
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          tgSpecSourceProjectId: null,
        }),
      },
      projectUpdateOutbox: { upsert },
    } as any;

    const result = await enqueueProjectUpdate(db, {
      projectId: "regular-project",
      eventType: "work.started",
      dedupeKey: "run-1",
    });

    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("claims only requested audiences and leases delivery", async () => {
    const createdAt = new Date("2026-05-10T08:00:00.000Z");
    const rows = [{
      id: "event-1",
      projectId: "project-1",
      eventType: "work.started",
      audience: "project_contributors",
      requiredCapability: "project.view",
      dedupeKey: "work.started:run-1",
      payload: {},
      leaseId: null,
      attempts: 0,
      createdAt,
    }];
    const tx = {
      projectUpdateOutbox: {
        findMany: vi.fn()
          .mockResolvedValueOnce(rows)
          .mockResolvedValueOnce([{ ...rows[0], attempts: 1 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      $transaction: vi.fn((callback) => callback(tx)),
    } as any;

    const claimed = await claimProjectUpdates(db, {
      audiences: ["project_contributors"],
      consumerId: "tg-spec-test",
      limit: 5,
      leaseSeconds: 30,
    });

    expect(claimed).toHaveLength(1);
    expect(tx.projectUpdateOutbox.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        audience: { in: ["project_contributors"] },
      }),
      take: 5,
    }));
    expect(tx.projectUpdateOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "DELIVERING",
        attempts: { increment: 1 },
        lockedBy: "tg-spec-test",
        leaseId: expect.any(String),
      }),
    }));
  });

  it("fails closed for invalid explicit audiences", async () => {
    const tx = {
      projectUpdateOutbox: {
        findMany: vi.fn().mockResolvedValueOnce([]),
        updateMany: vi.fn(),
      },
    };
    const db = {
      $transaction: vi.fn((callback) => callback(tx)),
    } as any;

    const claimed = await claimProjectUpdates(db, {
      audiences: ["project_managers_but_not_really"],
      allowedAudiences: ["project_contributors"],
    });

    expect(claimed).toEqual([]);
    expect(tx.projectUpdateOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        audience: { in: [] },
      }),
    }));
    expect(tx.projectUpdateOutbox.updateMany).not.toHaveBeenCalled();
  });

  it("requires and applies active targets for manager audience claims", async () => {
    await expect(claimProjectUpdates({
      $transaction: vi.fn(),
    } as any, {
      audiences: ["project_managers"],
      allowedAudiences: ["project_managers"],
    })).rejects.toThrow(/delivery target/);

    const createdAt = new Date("2026-05-10T08:30:00.000Z");
    const rows = [{
      id: "event-2",
      projectId: "project-1",
      eventType: "required_secret.missing",
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
      dedupeKey: "required_secret.missing:run-1",
      payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"], count: 1 },
      leaseId: null,
      attempts: 0,
      createdAt,
    }];
    const tx = {
      projectUpdateDeliveryTarget: {
        findFirst: vi.fn().mockResolvedValue({
          id: "target-1",
          projectId: "project-1",
          sourceSystem: "tg-spec",
          sourceTargetId: "telegram:42:topic:10",
          targetKind: "telegram_chat_topic",
          audience: "project_managers",
          requiredCapability: "project.secrets.manage",
          status: "ACTIVE",
        }),
      },
      projectUpdateOutbox: {
        findMany: vi.fn()
          .mockResolvedValueOnce(rows)
          .mockResolvedValueOnce([{ ...rows[0], attempts: 1 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      $transaction: vi.fn((callback) => callback(tx)),
    } as any;

    const claimed = await claimProjectUpdates(db, {
      audiences: ["project_managers"],
      allowedAudiences: ["project_managers"],
      targetId: "target-1",
      consumerId: "tg-spec-test",
    });

    expect(claimed).toHaveLength(1);
    expect(tx.projectUpdateDeliveryTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "target-1",
        status: "ACTIVE",
        audience: "project_managers",
        requiredCapability: "project.secrets.manage",
        sourceSystem: "tg-spec",
        targetKind: "telegram_chat_topic",
      }),
    }));
    expect(tx.projectUpdateOutbox.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        projectId: "project-1",
        audience: { in: ["project_managers"] },
        requiredCapability: "project.secrets.manage",
      }),
    }));
  });

  it("acks failures with retry metadata and delivered events with external ids", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ id: "event-1", attempts: 2 })
      .mockResolvedValueOnce({ id: "event-1", status: "FAILED" })
      .mockResolvedValueOnce({ id: "event-1", status: "DELIVERED" });
    const db = {
      projectUpdateOutbox: {
        findFirst: vi.fn().mockResolvedValue({ id: "event-1", attempts: 2 }),
        updateMany,
        findUnique,
      },
    } as any;

    await ackProjectUpdateDelivery(db, {
      id: "event-1",
      leaseId: "lease-1",
      status: "FAILED",
      error: "Telegram 429",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "event-1",
        leaseId: "lease-1",
        status: "DELIVERING",
      },
      data: expect.objectContaining({
        status: "FAILED",
        lockedBy: null,
        leaseId: null,
        lockedUntil: null,
        lastError: "Telegram 429",
        nextAttemptAt: expect.any(Date),
      }),
    });

    await ackProjectUpdateDelivery(db, {
      id: "event-1",
      leaseId: "lease-1",
      status: "DELIVERED",
      externalMessageId: "telegram:42:100",
    });

    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "event-1",
        leaseId: "lease-1",
        status: "DELIVERING",
      },
      data: expect.objectContaining({
        status: "DELIVERED",
        leaseId: null,
        externalMessageId: "telegram:42:100",
        deliveredAt: expect.any(Date),
      }),
    });
  });

  it("keeps skipped delivery reasons visible without retrying", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      projectUpdateOutbox: {
        findFirst: vi.fn().mockResolvedValue({ id: "event-1", attempts: 1 }),
        updateMany,
        findUnique: vi.fn().mockResolvedValue({ id: "event-1", status: "SKIPPED" }),
      },
    } as any;

    await ackProjectUpdateDelivery(db, {
      id: "event-1",
      leaseId: "lease-1",
      status: "SKIPPED",
      error: "Coalesced into newer Telegram status update event-2",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "event-1",
        leaseId: "lease-1",
        status: "DELIVERING",
      },
      data: expect.objectContaining({
        status: "SKIPPED",
        lockedBy: null,
        leaseId: null,
        lockedUntil: null,
        nextAttemptAt: null,
        deliveredAt: expect.any(Date),
        lastError: "Coalesced into newer Telegram status update event-2",
      }),
    });
  });
});

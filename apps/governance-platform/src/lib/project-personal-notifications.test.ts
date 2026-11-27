import { describe, expect, it, vi } from "vitest";
import {
  ackPersonalProjectNotificationDelivery,
  claimPersonalProjectNotifications,
  enqueuePersonalProjectNotifications,
  resolvePersonalProjectNotificationRecipients,
} from "./project-personal-notifications";
import { PROJECT_PERSONAL_NOTIFICATION_CHANNEL } from "./project-personal-notification-types";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "notification-1",
    projectId: "project-1",
    recipientUserId: "manager-1",
    channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
    telegramUserId: "777",
    eventType: "required_secret.missing",
    requiredCapability: "project.secrets.manage",
    dedupeKey: "required_secret.missing:run-1",
    payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"], count: 1 },
    status: "PENDING",
    attempts: 0,
    lockedBy: null,
    leaseId: null,
    createdAt: new Date("2026-05-13T10:00:00.000Z"),
    ...overrides,
  };
}

describe("project personal notifications", () => {
  it("resolves only owners and manager-capability users with one raw Telegram account", async () => {
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: "user",
          ownerScopeId: "owner-1",
        }),
      },
      accessGrant: {
        findMany: vi.fn().mockResolvedValue([
          { subjectUserId: "manager-1" },
        ]),
      },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "owner-1", providerAccountId: "111" },
          {
            userId: "owner-1",
            providerAccountId: "999999999999999999",
            scope: "openid profile",
            access_token: "oidc-token",
            id_token: "oidc-id-token",
          },
          { userId: "manager-1", providerAccountId: "777" },
          { userId: "contributor-1", providerAccountId: "888" },
          { userId: "legacy-1", providerAccountId: "telegram-oauth-subject" },
        ]),
      },
      notificationPreference: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any;

    const recipients = await resolvePersonalProjectNotificationRecipients(db, {
      projectId: "project-1",
      eventType: "required_secret.missing",
    });

    expect(db.accessGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { capabilities: { has: "project.secrets.manage" } },
        ]),
      }),
    }));
    expect(recipients).toEqual([
      {
        userId: "owner-1",
        telegramUserId: "111",
        requiredCapability: "project.secrets.manage",
        preferenceScope: "default",
      },
      {
        userId: "manager-1",
        telegramUserId: "777",
        requiredCapability: "project.secrets.manage",
        preferenceScope: "default",
      },
    ]);
  });

  it("does not infer recipients from public visibility or contributor-only access", async () => {
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: null,
          ownerScopeId: null,
        }),
      },
      accessGrant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "viewer-1", providerAccountId: "999" },
        ]),
      },
      notificationPreference: {
        findMany: vi.fn(),
      },
    } as any;

    const recipients = await resolvePersonalProjectNotificationRecipients(db, {
      projectId: "project-1",
      eventType: "work.completed",
    });

    expect(recipients).toEqual([]);
    expect(db.account.findMany).not.toHaveBeenCalled();
    expect(db.notificationPreference.findMany).not.toHaveBeenCalled();
  });

  it("rejects users with more than one WebApp raw Telegram id", async () => {
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: "user",
          ownerScopeId: "owner-1",
        }),
      },
      accessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "owner-1", providerAccountId: "111" },
          { userId: "owner-1", providerAccountId: "222" },
        ]),
      },
      notificationPreference: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as any;

    const recipients = await resolvePersonalProjectNotificationRecipients(db, {
      projectId: "project-1",
      eventType: "work.completed",
    });

    expect(recipients).toEqual([]);
  });

  it("honors project-scoped private Telegram opt-outs before enqueue", async () => {
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: "user",
          ownerScopeId: "owner-1",
        }),
      },
      accessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "owner-1", providerAccountId: "111" },
        ]),
      },
      notificationPreference: {
        findMany: vi.fn().mockResolvedValue([
          {
            userId: "owner-1",
            scopeType: "project",
            scopeId: "project-1",
            enabled: false,
          },
        ]),
      },
    } as any;

    const recipients = await resolvePersonalProjectNotificationRecipients(db, {
      projectId: "project-1",
      eventType: "required_secret.missing",
    });

    expect(recipients).toEqual([]);
  });

  it("enqueues one deduped private row per eligible recipient with safe payload", async () => {
    const upsert = vi.fn().mockImplementation((args: any) => Promise.resolve(row({
      recipientUserId: args.create.recipientUserId,
      telegramUserId: args.create.telegramUserId,
      payload: args.create.payload,
      dedupeKey: args.create.dedupeKey,
    })));
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: "user",
          ownerScopeId: "owner-1",
        }),
      },
      accessGrant: {
        findMany: vi.fn().mockResolvedValue([{ subjectUserId: "manager-1" }]),
      },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "owner-1", providerAccountId: "111" },
          { userId: "manager-1", providerAccountId: "777" },
        ]),
      },
      notificationPreference: { findMany: vi.fn().mockResolvedValue([]) },
      projectPersonalNotificationOutbox: { upsert },
    } as any;

    const rows = await enqueuePersonalProjectNotifications(db, {
      projectId: "project-1",
      eventType: "required_secret.missing",
      dedupeKey: "run-1",
      payload: {
        requiredSecretKeys: ["telegram_bot_token"],
        secretValue: "must-not-leak",
      },
    });

    expect(rows).toHaveLength(2);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId_recipientUserId_channel_dedupeKey: {
          projectId: "project-1",
          recipientUserId: "owner-1",
          channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
          dedupeKey: "required_secret.missing:missing-secrets:TELEGRAM_BOT_TOKEN",
        },
      },
      create: expect.objectContaining({
        payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"], count: 1 },
      }),
    }));
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("must-not-leak");
  });

  it("coalesces repeated noisy private events before enqueue", async () => {
    const upsert = vi.fn().mockImplementation((args: any) => Promise.resolve(row({
      eventType: args.create.eventType,
      dedupeKey: args.create.dedupeKey,
    })));
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: "user",
          ownerScopeId: "owner-1",
        }),
      },
      accessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "owner-1", providerAccountId: "111" },
        ]),
      },
      notificationPreference: { findMany: vi.fn().mockResolvedValue([]) },
      projectPersonalNotificationOutbox: { upsert },
    } as any;

    await enqueuePersonalProjectNotifications(db, {
      projectId: "project-1",
      eventType: "required_secret.missing",
      dedupeKey: "terminal-secrets:telegram_bot_token:2026-05-13T10:00:00.000Z",
      payload: { requiredSecretKeys: ["telegram_bot_token"] },
    });
    await enqueuePersonalProjectNotifications(db, {
      projectId: "project-1",
      eventType: "required_secret.missing",
      dedupeKey: "terminal-secrets:telegram_bot_token:2026-05-13T10:05:00.000Z",
      payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"] },
    });
    await enqueuePersonalProjectNotifications(db, {
      projectId: "project-1",
      eventType: "work.failed",
      dedupeKey: "terminal-failed:FAILED:SECRETS:2026-05-13T10:00:00.000Z",
      payload: { reasonCode: "SECRETS" },
    });
    await enqueuePersonalProjectNotifications(db, {
      projectId: "project-1",
      eventType: "work.failed",
      dedupeKey: "terminal-failed:FAILED:SECRETS:2026-05-13T10:30:00.000Z",
      payload: { reasonCode: "SECRETS" },
    });
    await enqueuePersonalProjectNotifications(db, {
      projectId: "project-1",
      eventType: "work.needs_evidence",
      dedupeKey: "terminal-manual-evidence:controller_escalated:2026-05-13T10:45:00.000Z",
      payload: { reasonCode: "MANUAL" },
    });

    const dedupeKeys = upsert.mock.calls.map((call) => (
      call[0].where.projectId_recipientUserId_channel_dedupeKey.dedupeKey
    ));
    expect(dedupeKeys).toEqual([
      "required_secret.missing:missing-secrets:TELEGRAM_BOT_TOKEN",
      "required_secret.missing:missing-secrets:TELEGRAM_BOT_TOKEN",
      "work.failed:terminal-failed:FAILED:SECRETS:2026-05-13T10:00:00.000Z",
      "work.failed:terminal-failed:FAILED:SECRETS:2026-05-13T10:30:00.000Z",
      "work.needs_evidence:work-needs-evidence:2026-05-13",
    ]);
  });

  it("skips stale recipients during claim instead of delivering old queued rows", async () => {
    const staleRow = row({ recipientUserId: "manager-1", telegramUserId: "777" });
    const outbox = {
      findMany: vi.fn().mockResolvedValue([staleRow]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = {
      projectPersonalNotificationOutbox: outbox,
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: null,
          ownerScopeId: null,
        }),
      },
      accessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      account: { findMany: vi.fn().mockResolvedValue([]) },
      notificationPreference: { findMany: vi.fn() },
    };
    const db = {
      $transaction: vi.fn((callback) => callback(tx)),
    } as any;

    const claimed = await claimPersonalProjectNotifications(db, {
      limit: 1,
      consumerId: "tg-spec-test",
    });

    expect(claimed).toEqual([]);
    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["notification-1"] } },
      data: expect.objectContaining({
        status: "SKIPPED",
        lastError: expect.stringContaining("Recipient no longer has current Arena access"),
      }),
    }));
  });

  it("leases only rows whose recipient still has current access and Telegram link", async () => {
    const pendingRow = row({ recipientUserId: "owner-1", telegramUserId: "111" });
    const leasedRow = row({
      recipientUserId: "owner-1",
      telegramUserId: "111",
      status: "DELIVERING",
      attempts: 1,
      lockedBy: "tg-spec-test",
      leaseId: "lease-1",
    });
    const outbox = {
      findMany: vi.fn()
        .mockResolvedValueOnce([pendingRow])
        .mockResolvedValueOnce([leasedRow]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const tx = {
      projectPersonalNotificationOutbox: outbox,
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "project-1",
          tgSpecSourceProjectId: "tg-project-1",
          ownerScopeType: "user",
          ownerScopeId: "owner-1",
        }),
      },
      accessGrant: { findMany: vi.fn().mockResolvedValue([]) },
      account: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "owner-1", providerAccountId: "111" },
        ]),
      },
      notificationPreference: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const db = {
      $transaction: vi.fn((callback) => callback(tx)),
    } as any;

    const claimed = await claimPersonalProjectNotifications(db, {
      limit: 1,
      consumerId: "tg-spec-test",
    });

    expect(claimed).toEqual([leasedRow]);
    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "DELIVERING",
        attempts: { increment: 1 },
        lockedBy: "tg-spec-test",
        leaseId: expect.any(String),
      }),
    }));
  });

  it("acks only the active lease and consumer", async () => {
    const outbox = {
      findUnique: vi.fn()
        .mockResolvedValueOnce(row({
          status: "DELIVERING",
          lockedBy: "tg-spec-test",
          leaseId: "lease-1",
          attempts: 1,
        }))
        .mockResolvedValueOnce(row({ status: "DELIVERED" })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const db = {
      projectPersonalNotificationOutbox: outbox,
    } as any;

    const updated = await ackPersonalProjectNotificationDelivery(db, {
      id: "notification-1",
      leaseId: "lease-1",
      consumerId: "tg-spec-test",
      status: "DELIVERED",
      externalMessageId: "telegram:777:100",
    });

    expect(updated).toMatchObject({ status: "DELIVERED" });
    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "notification-1",
        leaseId: "lease-1",
        status: "DELIVERING",
        lockedBy: "tg-spec-test",
      },
      data: expect.objectContaining({
        status: "DELIVERED",
        externalMessageId: "telegram:777:100",
      }),
    }));
  });
});

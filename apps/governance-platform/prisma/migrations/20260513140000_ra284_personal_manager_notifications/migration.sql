-- RA-284: project-scoped notification preferences and private Telegram recipient outbox.

ALTER TABLE "NotificationPreference"
  ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN "scopeId" TEXT NOT NULL DEFAULT 'global';

DROP INDEX "NotificationPreference_userId_eventType_channel_key";

CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_channel_scopeType_scopeId_key"
  ON "NotificationPreference"("userId", "eventType", "channel", "scopeType", "scopeId");

CREATE INDEX "NotificationPreference_scopeType_scopeId_idx"
  ON "NotificationPreference"("scopeType", "scopeId");

CREATE TABLE "ProjectPersonalNotificationOutbox" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'telegram_private',
  "telegramUserId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "requiredCapability" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedBy" TEXT,
  "leaseId" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "externalMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectPersonalNotificationOutbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProjectPersonalNotificationOutbox"
  ADD CONSTRAINT "ProjectPersonalNotificationOutbox_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectPersonalNotificationOutbox"
  ADD CONSTRAINT "ProjectPersonalNotificationOutbox_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProjectPersonalNotificationOutbox_projectId_recipientUserId_channel_dedupeKey_key"
  ON "ProjectPersonalNotificationOutbox"("projectId", "recipientUserId", "channel", "dedupeKey");

CREATE INDEX "ProjectPersonalNotificationOutbox_recipientUserId_status_createdAt_idx"
  ON "ProjectPersonalNotificationOutbox"("recipientUserId", "status", "createdAt");

CREATE INDEX "ProjectPersonalNotificationOutbox_projectId_status_createdAt_idx"
  ON "ProjectPersonalNotificationOutbox"("projectId", "status", "createdAt");

CREATE INDEX "ProjectPersonalNotificationOutbox_status_nextAttemptAt_createdAt_idx"
  ON "ProjectPersonalNotificationOutbox"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "ProjectPersonalNotificationOutbox_leaseId_idx"
  ON "ProjectPersonalNotificationOutbox"("leaseId");

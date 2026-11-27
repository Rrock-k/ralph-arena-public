-- RA-278: Arena-owned safe project updates for Telegram delivery.
CREATE TABLE "ProjectUpdateOutbox" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "requiredCapability" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedBy" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "externalMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectUpdateOutbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProjectUpdateOutbox"
  ADD CONSTRAINT "ProjectUpdateOutbox_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProjectUpdateOutbox_projectId_dedupeKey_key"
  ON "ProjectUpdateOutbox"("projectId", "dedupeKey");

CREATE INDEX "ProjectUpdateOutbox_projectId_status_createdAt_idx"
  ON "ProjectUpdateOutbox"("projectId", "status", "createdAt");

CREATE INDEX "ProjectUpdateOutbox_status_nextAttemptAt_createdAt_idx"
  ON "ProjectUpdateOutbox"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "ProjectUpdateOutbox_audience_status_createdAt_idx"
  ON "ProjectUpdateOutbox"("audience", "status", "createdAt");

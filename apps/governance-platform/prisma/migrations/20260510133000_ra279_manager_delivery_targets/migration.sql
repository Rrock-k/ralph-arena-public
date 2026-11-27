-- RA-279: Arena-owned Telegram delivery targets for manager-only project updates.
CREATE TABLE "ProjectUpdateDeliveryTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTargetId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL DEFAULT 'telegram_chat_topic',
    "audience" TEXT NOT NULL,
    "requiredCapability" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT,
    "createdByUserId" TEXT,
    "revokedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectUpdateDeliveryTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectUpdateDeliveryTarget_projectId_sourceSystem_sourceTargetId_audience_key"
    ON "ProjectUpdateDeliveryTarget"("projectId", "sourceSystem", "sourceTargetId", "audience");

CREATE INDEX "ProjectUpdateDeliveryTarget_projectId_audience_status_idx"
    ON "ProjectUpdateDeliveryTarget"("projectId", "audience", "status");

CREATE INDEX "ProjectUpdateDeliveryTarget_sourceSystem_sourceTargetId_idx"
    ON "ProjectUpdateDeliveryTarget"("sourceSystem", "sourceTargetId");

CREATE INDEX "ProjectUpdateDeliveryTarget_status_createdAt_idx"
    ON "ProjectUpdateDeliveryTarget"("status", "createdAt");

CREATE INDEX "ProjectUpdateDeliveryTarget_createdByUserId_createdAt_idx"
    ON "ProjectUpdateDeliveryTarget"("createdByUserId", "createdAt");

CREATE INDEX "ProjectUpdateDeliveryTarget_revokedByUserId_revokedAt_idx"
    ON "ProjectUpdateDeliveryTarget"("revokedByUserId", "revokedAt");

ALTER TABLE "ProjectUpdateDeliveryTarget"
    ADD CONSTRAINT "ProjectUpdateDeliveryTarget_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

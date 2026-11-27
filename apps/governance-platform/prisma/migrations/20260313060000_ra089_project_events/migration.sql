-- CreateTable
CREATE TABLE "ProjectEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_direction_type_createdAt_idx" ON "ProjectEvent"("projectId", "direction", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_createdAt_idx" ON "ProjectEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed community_qa feature flag (disabled by default)
INSERT INTO "FeatureFlag" ("key", "enabled", "createdAt", "updatedAt")
VALUES ('community_qa', false, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

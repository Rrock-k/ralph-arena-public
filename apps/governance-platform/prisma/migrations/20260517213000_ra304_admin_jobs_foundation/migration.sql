-- CreateTable
CREATE TABLE "MaintenanceItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT NOT NULL,
    "scheduleOwner" TEXT NOT NULL,
    "schedule" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowRunNow" BOOLEAN NOT NULL DEFAULT false,
    "executorType" TEXT NOT NULL,
    "executorKey" TEXT NOT NULL,
    "executorConfig" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRun" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "actorCapability" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" TEXT,
    "result" JSONB,
    "error" JSONB,

    CONSTRAINT "MaintenanceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceItem_key_key" ON "MaintenanceItem"("key");

-- CreateIndex
CREATE INDEX "MaintenanceItem_kind_enabled_idx" ON "MaintenanceItem"("kind", "enabled");

-- CreateIndex
CREATE INDEX "MaintenanceItem_executorType_executorKey_idx" ON "MaintenanceItem"("executorType", "executorKey");

-- CreateIndex
CREATE INDEX "MaintenanceRun_itemId_startedAt_idx" ON "MaintenanceRun"("itemId", "startedAt");

-- CreateIndex
CREATE INDEX "MaintenanceRun_status_startedAt_idx" ON "MaintenanceRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "MaintenanceRun" ADD CONSTRAINT "MaintenanceRun_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MaintenanceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CronJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "endpoint" TEXT NOT NULL,
    "intervalMin" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronJob_name_key" ON "CronJob"("name");

-- CreateIndex
CREATE INDEX "CronJob_enabled_idx" ON "CronJob"("enabled");

-- Seed: QA feedback cron (every 6 hours by default)
INSERT INTO "CronJob" (id, name, description, endpoint, "intervalMin", enabled, "updatedAt")
VALUES (
  'cron-qa-feedback',
  'qa-feedback',
  'Batch accumulated QA test results and deliver to DEPLOYED projects',
  '/api/cron/qa-feedback',
  360,
  true,
  now()
);

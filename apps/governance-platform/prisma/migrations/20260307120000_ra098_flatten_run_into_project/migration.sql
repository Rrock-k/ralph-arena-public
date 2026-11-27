-- RA-098: Flatten Run into Project
-- 1. Add runtime fields to Project
-- 2. Migrate data from latest Run per project
-- 3. Create RunLog table
-- 4. Re-link ApiUsage to Project
-- 5. Drop Run table

-- Step 1: Add new columns to Project
ALTER TABLE "Project" ADD COLUMN "specSnapshot" TEXT;
ALTER TABLE "Project" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "finishedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "commitSha" TEXT;
ALTER TABLE "Project" ADD COLUMN "log" TEXT;
ALTER TABLE "Project" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Project" ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "progressJson" TEXT;
ALTER TABLE "Project" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "Project" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "Project" ADD COLUMN "estimatedCostUsd" DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN "budgetDebitedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "lastHeartbeat" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "containerName" TEXT;
ALTER TABLE "Project" ADD COLUMN "workerHost" TEXT;
ALTER TABLE "Project" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- Step 2: Migrate data from the latest Run into Project
-- For each project, copy runtime state from the most recent run
UPDATE "Project" p SET
  "specSnapshot" = r."specSnapshot",
  "startedAt" = r."startedAt",
  "finishedAt" = r."finishedAt",
  "commitSha" = r."commitSha",
  "log" = r."log",
  "lastError" = r."lastError",
  "cancelRequested" = r."cancelRequested",
  "progressJson" = r."progressJson",
  "inputTokens" = r."inputTokens",
  "outputTokens" = r."outputTokens",
  "estimatedCostUsd" = r."estimatedCostUsd",
  "budgetDebitedUsd" = COALESCE(r."budgetDebitedUsd", 0),
  "lastHeartbeat" = r."lastHeartbeat",
  "containerName" = r."containerName",
  "workerHost" = r."workerHost",
  "status" = r."status"
FROM (
  SELECT DISTINCT ON ("projectId") *
  FROM "Run"
  ORDER BY "projectId", "createdAt" DESC
) r
WHERE p.id = r."projectId";

-- Map old Project statuses BUILDING -> pick from the run, CREATED stays
-- Projects that had no runs keep their original status

-- Step 3: Create RunLog table
CREATE TABLE "RunLog" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RunLog_projectId_createdAt_idx" ON "RunLog"("projectId", "createdAt");
ALTER TABLE "RunLog" ADD CONSTRAINT "RunLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Populate RunLog from existing Run history
INSERT INTO "RunLog" ("id", "projectId", "event", "detail", "createdAt")
SELECT
  gen_random_uuid()::text,
  "projectId",
  "status",
  json_build_object(
    'legacyRunId', id,
    'error', "lastError",
    'inputTokens', "inputTokens",
    'outputTokens', "outputTokens",
    'costUsd', "estimatedCostUsd",
    'containerName', "containerName"
  )::text,
  "updatedAt"
FROM "Run"
ORDER BY "createdAt" ASC;

-- Step 5: Re-link ApiUsage from Run to Project
ALTER TABLE "ApiUsage" ADD COLUMN "projectId" TEXT;

UPDATE "ApiUsage" a SET "projectId" = r."projectId"
FROM "Run" r WHERE a."runId" = r.id;

-- Set NOT NULL after backfill (drop rows with no matching run)
DELETE FROM "ApiUsage" WHERE "projectId" IS NULL;
ALTER TABLE "ApiUsage" ALTER COLUMN "projectId" SET NOT NULL;

-- Drop old foreign key and column
ALTER TABLE "ApiUsage" DROP CONSTRAINT IF EXISTS "ApiUsage_runId_fkey";
DROP INDEX IF EXISTS "ApiUsage_runId_idx";
ALTER TABLE "ApiUsage" DROP COLUMN "runId";

-- Add new foreign key and index
ALTER TABLE "ApiUsage" ADD CONSTRAINT "ApiUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ApiUsage_projectId_idx" ON "ApiUsage"("projectId");

-- Step 6: Drop Run table
DROP TABLE IF EXISTS "Run" CASCADE;

-- Step 7: Add index on Project status
CREATE INDEX "Project_status_createdAt_idx" ON "Project"("status", "createdAt");

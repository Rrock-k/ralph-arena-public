-- RA-192 Phase 2: add orthogonal state axes and runtime metadata to Project/ProjectComponent
-- Legacy lifecycle fields remain during cutover. This migration is additive + backfill only.

ALTER TABLE "Project"
ADD COLUMN "state" TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "ProjectComponent"
ADD COLUMN "desiredRuntime" TEXT NOT NULL DEFAULT 'STOPPED',
ADD COLUMN "actualRuntime" TEXT NOT NULL DEFAULT 'ABSENT',
ADD COLUMN "implState" TEXT,
ADD COLUMN "pauseReason" TEXT,
ADD COLUMN "containerName" TEXT,
ADD COLUMN "previewUrl" TEXT,
ADD COLUMN "workerHost" TEXT,
ADD COLUMN "vpsHostId" TEXT,
ADD COLUMN "lastHeartbeat" TIMESTAMP(3),
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Project_state_createdAt_idx" ON "Project"("state", "createdAt");
CREATE INDEX "ProjectComponent_projectId_desiredRuntime_actualRuntime_idx"
  ON "ProjectComponent"("projectId", "desiredRuntime", "actualRuntime");
CREATE INDEX "ProjectComponent_desiredRuntime_actualRuntime_workerHost_idx"
  ON "ProjectComponent"("desiredRuntime", "actualRuntime", "workerHost");

-- Coarse project state first: archived wins, then paused/failed/canceled, otherwise active.
UPDATE "Project"
SET "state" = CASE
  WHEN "containerRemoved" = TRUE OR "archivedAt" IS NOT NULL THEN 'ARCHIVED'
  WHEN "status" IN (
    'PAUSING',
    'PAUSED_BUDGET',
    'PAUSED_MANUAL',
    'PAUSED_SECRETS',
    'PAUSED_RATE_LIMIT',
    'PAUSED_INFRA',
    'PAUSED_API'
  ) THEN 'PAUSED'
  WHEN "status" = 'FAILED' THEN 'FAILED'
  WHEN "status" = 'CANCELED' THEN 'CANCELED'
  ELSE 'ACTIVE'
END;

-- Backfill runtime/impl state onto the first component (primary-by-createdAt during Phase 2).
WITH "PrimaryComponent" AS (
  SELECT DISTINCT ON ("projectId")
    "id",
    "projectId"
  FROM "ProjectComponent"
  ORDER BY "projectId", "createdAt" ASC, "id" ASC
)
UPDATE "ProjectComponent" AS pc
SET
  "desiredRuntime" = CASE
    WHEN p."containerRemoved" = TRUE OR p."archivedAt" IS NOT NULL THEN 'REMOVED'
    WHEN p."containerSleeping" = TRUE THEN 'STOPPED'
    WHEN p."status" IN (
      'PAUSING',
      'PAUSED_BUDGET',
      'PAUSED_MANUAL',
      'PAUSED_SECRETS',
      'PAUSED_RATE_LIMIT',
      'PAUSED_INFRA',
      'PAUSED_API',
      'FAILED',
      'CANCELED'
    ) THEN 'STOPPED'
    WHEN p."status" IN ('PROVISIONING', 'QUEUED', 'RUNNING', 'DEPLOYED') THEN 'RUNNING'
    ELSE 'STOPPED'
  END,
  "actualRuntime" = CASE
    WHEN p."containerRemoved" = TRUE OR p."archivedAt" IS NOT NULL THEN 'ABSENT'
    WHEN p."containerSleeping" = TRUE THEN 'STOPPED'
    WHEN p."status" = 'PAUSED_INFRA' THEN 'ERROR'
    WHEN p."status" IN ('RUNNING', 'DEPLOYED') AND p."containerName" IS NOT NULL THEN 'RUNNING'
    WHEN p."status" = 'PAUSING' AND p."containerName" IS NOT NULL THEN 'RUNNING'
    WHEN p."status" IN (
      'PAUSED_BUDGET',
      'PAUSED_MANUAL',
      'PAUSED_SECRETS',
      'PAUSED_RATE_LIMIT',
      'PAUSED_API',
      'FAILED',
      'CANCELED'
    ) AND p."containerName" IS NOT NULL THEN 'STOPPED'
    ELSE 'ABSENT'
  END,
  "implState" = CASE
    WHEN p."status" = 'DEPLOYED' THEN 'COMPLETED'
    WHEN p."status" = 'FAILED' THEN 'FAILED'
    WHEN p."status" IN (
      'PAUSING',
      'PAUSED_BUDGET',
      'PAUSED_MANUAL',
      'PAUSED_SECRETS',
      'PAUSED_RATE_LIMIT',
      'PAUSED_INFRA',
      'PAUSED_API'
    ) THEN 'PAUSED'
    WHEN p."status" = 'CANCELED' THEN 'IDLE'
    WHEN p."status" = 'RUNNING' AND p."containerName" IS NOT NULL THEN 'RUNNING'
    WHEN p."status" IN ('PROVISIONING', 'QUEUED', 'RUNNING', 'CREATED') THEN 'IDLE'
    ELSE 'IDLE'
  END,
  "pauseReason" = CASE
    WHEN p."status" = 'PAUSING' THEN 'MANUAL'
    WHEN p."status" = 'PAUSED_BUDGET' THEN 'BUDGET'
    WHEN p."status" = 'PAUSED_MANUAL' THEN 'MANUAL'
    WHEN p."status" = 'PAUSED_SECRETS' THEN 'SECRETS'
    WHEN p."status" = 'PAUSED_RATE_LIMIT' THEN 'RATE_LIMIT'
    WHEN p."status" = 'PAUSED_INFRA' THEN 'INFRA'
    WHEN p."status" = 'PAUSED_API' THEN 'API'
    ELSE NULL
  END,
  "containerName" = p."containerName",
  "previewUrl" = p."previewUrl",
  "workerHost" = p."workerHost",
  "vpsHostId" = vh."id",
  "lastHeartbeat" = p."lastHeartbeat",
  "retryCount" = p."retryCount"
FROM "PrimaryComponent" AS primary_pc
JOIN "Project" AS p
  ON p."id" = primary_pc."projectId"
LEFT JOIN "VpsHost" AS vh
  ON vh."projectId" = p."id"
WHERE pc."id" = primary_pc."id";

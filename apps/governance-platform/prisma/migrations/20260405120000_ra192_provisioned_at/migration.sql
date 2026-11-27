-- RA-192: Add provisionedAt to ProjectComponent for PROVISIONING/QUEUED distinction
ALTER TABLE "ProjectComponent" ADD COLUMN "provisionedAt" TIMESTAMP(3);

-- Backfill: components that are already past provisioning (QUEUED, RUNNING, DEPLOYED, etc.)
-- get provisionedAt set to their project's startedAt or NOW()
UPDATE "ProjectComponent" pc
SET "provisionedAt" = COALESCE(
  (SELECT p."startedAt" FROM "Project" p WHERE p.id = pc."projectId"),
  NOW()
)
WHERE pc."desiredRuntime" = 'RUNNING'
  AND pc."implState" IS NOT NULL
  AND pc."implState" != 'IDLE';

-- Also backfill for QUEUED projects (desired=RUNNING, actual=ABSENT, implState=IDLE, workerHost IS NOT NULL)
UPDATE "ProjectComponent" pc
SET "provisionedAt" = NOW()
WHERE pc."desiredRuntime" = 'RUNNING'
  AND pc."actualRuntime" = 'ABSENT'
  AND COALESCE(pc."implState", 'IDLE') = 'IDLE'
  AND pc."workerHost" IS NOT NULL
  AND pc."provisionedAt" IS NULL;

-- Index for provisioner (find unprovisioned) and claim (find provisioned)
CREATE INDEX "ProjectComponent_provisionedAt_claim_idx"
  ON "ProjectComponent" ("projectId", "desiredRuntime", "actualRuntime", "provisionedAt")
  WHERE "desiredRuntime" = 'RUNNING' AND "actualRuntime" = 'ABSENT';

-- RA-192: Drop legacy status fields
DROP INDEX IF EXISTS "Project_status_createdAt_idx";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "status";
ALTER TABLE "ProjectComponent" DROP COLUMN IF EXISTS "status";

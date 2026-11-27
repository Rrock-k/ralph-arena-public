-- RA-237: One-shot schema cut
-- Executed manually via psql. Prisma schema synced after.
-- All DB writers MUST be stopped before running this.

BEGIN;

-- =============================================================
-- STEP 1: Add new columns
-- =============================================================

ALTER TABLE "ProjectComponent" ADD COLUMN "powerIntent" TEXT NOT NULL DEFAULT 'OFF';
ALTER TABLE "ProjectComponent" ADD COLUMN "runtimeState" TEXT NOT NULL DEFAULT 'ABSENT';
ALTER TABLE "ProjectComponent" ADD COLUMN "agentState" TEXT;
ALTER TABLE "ProjectComponent" ADD COLUMN "blockers" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ProjectComponent" ADD COLUMN "lastOutcome" TEXT;
ALTER TABLE "ProjectComponent" ADD COLUMN "lastOutcomeAt" TIMESTAMP(3);
ALTER TABLE "ProjectComponent" ADD COLUMN "retryAt" TIMESTAMP(3);
ALTER TABLE "ProjectComponent" ADD COLUMN "previewHealth" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- =============================================================
-- STEP 2: Backfill new columns from old
-- =============================================================

-- powerIntent: RUNNING → ON, else → OFF
UPDATE "ProjectComponent"
SET "powerIntent" = CASE
  WHEN "desiredRuntime" = 'RUNNING' THEN 'ON'
  ELSE 'OFF'
END;

-- runtimeState: direct mapping
UPDATE "ProjectComponent"
SET "runtimeState" = "actualRuntime";

-- agentState + lastOutcome (lastOutcomeAt intentionally NULL — no reliable timestamp)
UPDATE "ProjectComponent"
SET
  "agentState" = CASE
    WHEN "implState" = 'COMPLETED' THEN 'IDLE'
    WHEN "implState" IS NULL THEN NULL
    ELSE "implState"
  END,
  "lastOutcome" = CASE
    WHEN "implState" = 'COMPLETED' THEN 'COMPLETED'
    WHEN "implState" = 'FAILED' THEN 'FAILED'
    ELSE NULL
  END,
  "lastOutcomeAt" = NULL;

-- blockers: singleton pauseReason → array
UPDATE "ProjectComponent"
SET "blockers" = CASE
  WHEN "pauseReason" IS NOT NULL THEN ARRAY["pauseReason"]
  ELSE ARRAY[]::text[]
END;

-- previewHealth: from previewActual
UPDATE "ProjectComponent"
SET "previewHealth" = CASE
  WHEN "previewActual" = 'SERVING' THEN 'HEALTHY'
  WHEN "previewActual" = 'ERROR' THEN 'UNHEALTHY'
  ELSE 'UNKNOWN'
END;

-- =============================================================
-- STEP 3: Project.state → archivedAt for CANCELED
-- =============================================================

UPDATE "Project"
SET "archivedAt" = "updatedAt"
WHERE state = 'CANCELED' AND "archivedAt" IS NULL;

-- Migration marker for legacy canceled projects
INSERT INTO "RunLog" (id, "projectId", event, detail, "createdAt")
SELECT
  gen_random_uuid()::text,
  id,
  'MIGRATION_ARCHIVED',
  '{"reason":"legacy_canceled","migration":"ra-237","source_state":"CANCELED"}',
  NOW()
FROM "Project"
WHERE state = 'CANCELED';

-- =============================================================
-- STEP 4: Verification (check before proceeding to drops)
-- =============================================================

-- All components have powerIntent
DO $$
BEGIN
  IF (SELECT count(*) FROM "ProjectComponent" WHERE "powerIntent" IS NULL) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: powerIntent has NULLs';
  END IF;
END $$;

-- All components have runtimeState
DO $$
BEGIN
  IF (SELECT count(*) FROM "ProjectComponent" WHERE "runtimeState" IS NULL) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: runtimeState has NULLs';
  END IF;
END $$;

-- Blockers consistency: non-empty blockers only with PAUSED
DO $$
BEGIN
  IF (SELECT count(*) FROM "ProjectComponent" WHERE array_length("blockers", 1) > 0 AND "agentState" != 'PAUSED') > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: blockers present but agentState != PAUSED';
  END IF;
END $$;

-- PAUSED always has blockers
DO $$
BEGIN
  IF (SELECT count(*) FROM "ProjectComponent" WHERE "agentState" = 'PAUSED' AND (array_length("blockers", 1) IS NULL OR array_length("blockers", 1) = 0)) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: PAUSED without blockers';
  END IF;
END $$;

-- All CANCELED projects archived
DO $$
BEGIN
  IF (SELECT count(*) FROM "Project" WHERE state = 'CANCELED' AND "archivedAt" IS NULL) > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: CANCELED projects not archived';
  END IF;
END $$;

-- =============================================================
-- STEP 5: Drop old columns
-- =============================================================

ALTER TABLE "ProjectComponent" DROP COLUMN "desiredRuntime";
ALTER TABLE "ProjectComponent" DROP COLUMN "actualRuntime";
ALTER TABLE "ProjectComponent" DROP COLUMN "implState";
ALTER TABLE "ProjectComponent" DROP COLUMN "pauseReason";
ALTER TABLE "ProjectComponent" DROP COLUMN "previewDesired";
ALTER TABLE "ProjectComponent" DROP COLUMN "previewActual";
ALTER TABLE "ProjectComponent" DROP COLUMN "previewLastError";

ALTER TABLE "Project" DROP COLUMN "state";

-- =============================================================
-- STEP 6: Drop old indexes, create new
-- =============================================================

DROP INDEX IF EXISTS "ProjectComponent_projectId_desiredRuntime_actualRuntime_idx";
DROP INDEX IF EXISTS "ProjectComponent_desiredRuntime_actualRuntime_workerHost_idx";
DROP INDEX IF EXISTS "ProjectComponent_projectId_previewActual_idx";
DROP INDEX IF EXISTS "Project_state_createdAt_idx";

CREATE INDEX "ProjectComponent_powerIntent_runtimeState_idx"
  ON "ProjectComponent" ("powerIntent", "runtimeState");

CREATE INDEX "ProjectComponent_powerIntent_agentState_idx"
  ON "ProjectComponent" ("powerIntent", "agentState");

CREATE INDEX "ProjectComponent_projectId_powerIntent_idx"
  ON "ProjectComponent" ("projectId", "powerIntent");

COMMIT;

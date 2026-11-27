-- RA-215: Add preview facet to ProjectComponent

ALTER TABLE "ProjectComponent"
  ADD COLUMN "previewDesired" TEXT NOT NULL DEFAULT 'OFF',
  ADD COLUMN "previewActual" TEXT NOT NULL DEFAULT 'ABSENT',
  ADD COLUMN "previewCheckedAt" TIMESTAMP(3),
  ADD COLUMN "previewLastError" TEXT;

-- Conservative backfill: existing live preview metadata implies a serving preview
-- until the new terminal/recovery contract starts writing explicit preview states.
UPDATE "ProjectComponent"
SET
  "previewDesired" = 'SERVING',
  "previewActual" = 'SERVING',
  "previewCheckedAt" = COALESCE("lastHeartbeat", NOW())
WHERE "previewUrl" IS NOT NULL
  AND "actualRuntime" = 'RUNNING';

CREATE INDEX "ProjectComponent_projectId_previewActual_idx"
ON "ProjectComponent"("projectId", "previewActual");

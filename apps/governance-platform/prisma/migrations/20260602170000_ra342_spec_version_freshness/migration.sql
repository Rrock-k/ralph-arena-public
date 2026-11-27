-- RA-342: accepted input freshness belongs to the accepted SpecVersion.
ALTER TABLE "SpecVersion"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

UPDATE "SpecVersion"
SET "updatedAt" = "createdAt"
WHERE "updatedAt" IS NULL;

ALTER TABLE "SpecVersion"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET NOT NULL;

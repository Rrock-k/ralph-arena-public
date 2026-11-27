-- RA-287: converge SpecVersion storage on the loop-neutral accepted artifact.
ALTER TABLE "SpecVersion"
  ADD COLUMN IF NOT EXISTS "acceptedArtifact" JSONB,
  DROP COLUMN IF EXISTS "acceptedDelta",
  DROP COLUMN IF EXISTS "externalProvenance";

-- RA-286: Store external accepted spec metadata at the SpecVersion boundary.
ALTER TABLE "SpecVersion"
  ADD COLUMN "externalSourceSystem" TEXT,
  ADD COLUMN "externalSourceProjectId" TEXT,
  ADD COLUMN "externalSourceVersion" INTEGER,
  ADD COLUMN "externalSourceUrl" TEXT,
  ADD COLUMN "externalAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "externalMetadataHash" TEXT,
  ADD COLUMN "acceptedDelta" JSONB,
  ADD COLUMN "externalProvenance" JSONB;

CREATE INDEX "SpecVersion_externalSourceSystem_externalSourceProjectId_externalSourceVersion_idx"
  ON "SpecVersion"("externalSourceSystem", "externalSourceProjectId", "externalSourceVersion");

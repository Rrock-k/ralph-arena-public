-- RA-365: user-facing release artifacts are separate from runner project assets.
CREATE TABLE "ProjectReleaseArtifact" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "appKind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "version" TEXT,
  "tag" TEXT,
  "commitSha" TEXT,
  "filename" TEXT,
  "contentType" TEXT,
  "sizeBytes" INTEGER,
  "sha256" TEXT,
  "storageKey" TEXT,
  "builderLabel" TEXT,
  "failureSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectReleaseArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectReleaseArtifact_projectId_platform_createdAt_idx"
  ON "ProjectReleaseArtifact"("projectId", "platform", "createdAt");

CREATE INDEX "ProjectReleaseArtifact_projectId_tag_idx"
  ON "ProjectReleaseArtifact"("projectId", "tag");

ALTER TABLE "ProjectReleaseArtifact"
  ADD CONSTRAINT "ProjectReleaseArtifact_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

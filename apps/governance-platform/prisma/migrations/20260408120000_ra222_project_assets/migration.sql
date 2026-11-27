-- RA-222: Project assets metadata. Asset bytes live outside Postgres.

CREATE TABLE "ProjectAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectAsset_projectId_createdAt_idx" ON "ProjectAsset"("projectId", "createdAt");

-- Active paths must be unique, but soft-deleted assets should not block re-uploading
-- the same workspace path.
CREATE UNIQUE INDEX "ProjectAsset_projectId_path_active_key"
  ON "ProjectAsset"("projectId", "path")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "ProjectAsset"
  ADD CONSTRAINT "ProjectAsset_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

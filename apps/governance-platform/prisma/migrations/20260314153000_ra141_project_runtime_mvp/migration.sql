-- RA-141: Project runtime MVP
-- 1. Project becomes the root runtime entity with its own identity
-- 2. Proposal becomes optional origin metadata
-- 3. ProjectComponent becomes the minimal runtime sub-entity

ALTER TABLE "Project" ADD COLUMN "name" TEXT;
ALTER TABLE "Project" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'community';
ALTER TABLE "Project" ADD COLUMN "ownerScopeType" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "Project" ADD COLUMN "ownerScopeId" TEXT;

UPDATE "Project" AS p
SET "name" = pr."title"
FROM "Proposal" AS pr
WHERE p."proposalId" = pr."id"
  AND p."name" IS NULL;

UPDATE "Project"
SET "name" = 'project-' || RIGHT("id", 6)
WHERE "name" IS NULL;

ALTER TABLE "Project" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "proposalId" DROP NOT NULL;

DROP INDEX IF EXISTS "Project_proposalId_idx";
CREATE INDEX "Project_proposalId_idx" ON "Project"("proposalId");
CREATE INDEX "Project_mode_createdAt_idx" ON "Project"("mode", "createdAt");

CREATE TABLE "ProjectComponent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "sourceType" TEXT NOT NULL,
    "sourceConfig" JSONB NOT NULL,
    "runtimeConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectComponent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectComponent_projectId_idx" ON "ProjectComponent"("projectId");
CREATE INDEX "ProjectComponent_projectId_kind_idx" ON "ProjectComponent"("projectId", "kind");

ALTER TABLE "ProjectComponent"
ADD CONSTRAINT "ProjectComponent_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProjectComponent" (
  "id",
  "projectId",
  "name",
  "kind",
  "status",
  "sourceType",
  "sourceConfig",
  "runtimeConfig",
  "createdAt",
  "updatedAt"
)
SELECT
  'pc_' || md5("id" || clock_timestamp()::text),
  "id",
  'main',
  'app',
  CASE
    WHEN "status" = 'DEPLOYED' THEN 'DEPLOYED'
    WHEN "status" = 'FAILED' THEN 'FAILED'
    WHEN "status" = 'CANCELED' THEN 'CANCELED'
    WHEN "status" LIKE 'PAUSED%' THEN 'PAUSED'
    WHEN "status" IN ('RUNNING', 'QUEUED', 'PROVISIONING') THEN 'RUNNING'
    ELSE 'CREATED'
  END,
  CASE
    WHEN "repoUrl" IS NOT NULL THEN 'git'
    ELSE 'managed'
  END,
  jsonb_build_object(
    'repoUrl', "repoUrl",
    'repoBranch', "repoBranch",
    'agent', "agent",
    'agentImpl', "agentImpl",
    'toolId', "toolId",
    'agentLoopVersionId', "agentLoopVersionId"
  ),
  jsonb_build_object(
    'runnerBackend', "runnerBackend",
    'cycleImage', "cycleImage",
    'model', "model",
    'envOverrides', "envOverrides",
    'claudeAuthMode', "claudeAuthMode",
    'codexAuthMode', "codexAuthMode",
    'requiredSecrets', "requiredSecrets",
    'vpsServerType', "vpsServerType"
  ),
  "createdAt",
  "updatedAt"
FROM "Project";

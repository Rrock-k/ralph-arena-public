-- RA-272 hardening: ordinary user-owned projects must not retain platform auth
-- or managed VPS runtime defaults after BYOK rollout.

WITH real_user_projects AS (
  SELECT id
  FROM "Project"
  WHERE "ownerScopeType" = 'user'
    AND NULLIF(TRIM(COALESCE("ownerScopeId", '')), '') IS NOT NULL
    AND "ownerScopeId" NOT IN ('arena-admin-api', 'e2e-admin-bypass', 'a2e-user')
)
UPDATE "Project"
SET "codexAuthMode" = 'api_key',
    "claudeAuthMode" = NULL
WHERE id IN (SELECT id FROM real_user_projects)
  AND agent = 'codex';

WITH real_user_projects AS (
  SELECT id
  FROM "Project"
  WHERE "ownerScopeType" = 'user'
    AND NULLIF(TRIM(COALESCE("ownerScopeId", '')), '') IS NOT NULL
    AND "ownerScopeId" NOT IN ('arena-admin-api', 'e2e-admin-bypass', 'a2e-user')
)
UPDATE "Project"
SET "claudeAuthMode" = 'api_key',
    "codexAuthMode" = NULL
WHERE id IN (SELECT id FROM real_user_projects)
  AND agent = 'claude-code';

WITH real_user_vps_projects AS (
  SELECT id
  FROM "Project"
  WHERE "ownerScopeType" = 'user'
    AND NULLIF(TRIM(COALESCE("ownerScopeId", '')), '') IS NOT NULL
    AND "ownerScopeId" NOT IN ('arena-admin-api', 'e2e-admin-bypass', 'a2e-user')
    AND "runnerBackend" = 'vps'
)
UPDATE "ProjectComponent" pc
SET "vpsHostId" = NULL,
    "workerHost" = NULL,
    "provisionedAt" = NULL,
    "runtimeConfig" = CASE
      WHEN jsonb_typeof(pc."runtimeConfig"::jsonb) = 'object'
        THEN jsonb_set(pc."runtimeConfig"::jsonb, '{runnerBackend}', '"local"', true)
      ELSE jsonb_build_object('runnerBackend', 'local')
    END
WHERE pc."projectId" IN (SELECT id FROM real_user_vps_projects);

WITH real_user_vps_projects AS (
  SELECT id
  FROM "Project"
  WHERE "ownerScopeType" = 'user'
    AND NULLIF(TRIM(COALESCE("ownerScopeId", '')), '') IS NOT NULL
    AND "ownerScopeId" NOT IN ('arena-admin-api', 'e2e-admin-bypass', 'a2e-user')
    AND "runnerBackend" = 'vps'
)
UPDATE "Project"
SET "runnerBackend" = 'local',
    "vpsServerType" = NULL
WHERE id IN (SELECT id FROM real_user_vps_projects);

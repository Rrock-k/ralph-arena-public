-- RA-192: service-like recipe projects (simple_web, openclaw) should use the
-- runtime state machine only. Drop impl-layer state on existing components and
-- preserve pause semantics through lastError for UI/control-plane fallbacks.

WITH primary_components AS (
  SELECT DISTINCT ON (pc."projectId")
    pc.id,
    pc."projectId",
    pc."pauseReason"
  FROM "ProjectComponent" pc
  ORDER BY pc."projectId", pc."createdAt" ASC
)
UPDATE "Project" p
SET "lastError" = CASE
  WHEN p."lastError" IS NOT NULL THEN p."lastError"
  WHEN pc."pauseReason" = 'SECRETS' THEN 'Initial setup required: provide required secrets'
  WHEN pc."pauseReason" = 'BUDGET' THEN 'Budget threshold reached — stopping run'
  WHEN pc."pauseReason" = 'RATE_LIMIT' THEN 'Paused due to RATE_LIMIT: retryable provider rate limit'
  WHEN pc."pauseReason" = 'INFRA' THEN 'Paused due to INFRA: transient runtime failure'
  WHEN pc."pauseReason" = 'API' THEN 'Paused due to API: transient platform API failure'
  WHEN pc."pauseReason" = 'MANUAL' THEN 'Paused by user'
  ELSE p."lastError"
END
FROM primary_components pc
WHERE p.id = pc."projectId"
  AND p.agent IN ('service', 'openclaw');

WITH primary_components AS (
  SELECT DISTINCT ON (pc."projectId")
    pc.id,
    pc."projectId"
  FROM "ProjectComponent" pc
  ORDER BY pc."projectId", pc."createdAt" ASC
)
UPDATE "ProjectComponent" pc
SET "implState" = NULL,
    "pauseReason" = NULL
FROM primary_components primary_pc
JOIN "Project" p ON p.id = primary_pc."projectId"
WHERE pc.id = primary_pc.id
  AND p.agent IN ('service', 'openclaw');

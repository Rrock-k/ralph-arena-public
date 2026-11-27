-- RA-192 / RA-216 / RA-231: bring fresh migrate-deploy databases in line with
-- current schema fields that drifted into the dev DB via manual pushes.
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

ALTER TABLE "AgentLoop"
  ADD COLUMN IF NOT EXISTS "label" TEXT;

ALTER TABLE "Tool"
  ADD COLUMN IF NOT EXISTS "label" TEXT;

UPDATE "AgentLoop"
SET "label" = INITCAP(REPLACE("name", '-', ' '))
WHERE "label" IS NULL;

UPDATE "Tool"
SET "label" = CASE
  WHEN "name" = 'claude-code' THEN 'Claude Code'
  WHEN "name" = 'codex' THEN 'Codex'
  ELSE INITCAP(REPLACE("name", '-', ' '))
END
WHERE "label" IS NULL;

UPDATE "Project"
SET "slug" = CONCAT(
  COALESCE(
    NULLIF(
      LEFT(
        TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(COALESCE("name", '')), '[^a-z0-9]+', '-', 'g')),
        48
      ),
      ''
    ),
    'project'
  ),
  '-',
  COALESCE(
    NULLIF(RIGHT(REGEXP_REPLACE(LOWER("id"), '[^a-z0-9]+', '', 'g'), 6), ''),
    'local'
  )
)
WHERE "slug" IS NULL;

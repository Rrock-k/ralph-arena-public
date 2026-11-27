-- RA-377: expose Claude Opus 5 in the Claude Code launch matrix and make it the default.
-- Append-only + idempotent so live registry edits are not overwritten by this migration.
-- Existing `opus` (claude-opus-4-8) stays selectable; only the default pointer moves.

-- Tool.claude-code ------------------------------------------------------------
UPDATE "Tool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"opus-5","label":"Claude Opus 5","model":"claude-opus-5"}]'::jsonb)::text,
    "updatedAt" = now()
WHERE id = 'claude-code' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"opus-5"}]'::jsonb;

UPDATE "Tool"
SET "defaultModelId" = 'opus-5',
    "updatedAt" = now()
WHERE id = 'claude-code'
  AND COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"opus-5"}]'::jsonb
  AND "defaultModelId" IS DISTINCT FROM 'opus-5';

-- AgentLoopTool ralph/claude-code ---------------------------------------------
UPDATE "AgentLoopTool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"opus-5","label":"Claude Opus 5","model":"claude-opus-5"}]'::jsonb)::text
WHERE "loopId" = 'ralph' AND "toolId" = 'claude-code' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"opus-5"}]'::jsonb;

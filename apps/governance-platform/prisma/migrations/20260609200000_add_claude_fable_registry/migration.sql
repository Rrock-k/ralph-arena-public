-- Expose Claude Fable 5 in the Claude Code launch matrix.
-- Append-only so live registry edits are not overwritten by this migration.

UPDATE "Tool"
SET
  models = (
    COALESCE(models::jsonb, '[]'::jsonb)
    || '[{"id":"fable","label":"Claude Fable 5","model":"claude-fable-5"}]'::jsonb
  )::text,
  "updatedAt" = now()
WHERE
  id = 'claude-code'
  AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"fable"}]'::jsonb;

UPDATE "AgentLoopTool"
SET models = (
  COALESCE(models::jsonb, '[]'::jsonb)
  || '[{"id":"fable","label":"Claude Fable 5","model":"claude-fable-5"}]'::jsonb
)::text
WHERE
  "loopId" = 'ralph'
  AND "toolId" = 'claude-code'
  AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"fable"}]'::jsonb;

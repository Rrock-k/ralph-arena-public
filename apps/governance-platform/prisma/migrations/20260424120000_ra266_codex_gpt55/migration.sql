-- RA-266: expose GPT-5.5 in the Codex launch matrix.
-- Append-only so live registry edits are not overwritten by this migration.

UPDATE "Tool"
SET
  models = (
    COALESCE(models::jsonb, '[]'::jsonb)
    || '[{"id":"gpt-55","label":"GPT-5.5 (subscription)","model":"gpt-5.5"}]'::jsonb
  )::text,
  "updatedAt" = now()
WHERE
  id = 'codex'
  AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-55"}]'::jsonb;

UPDATE "AgentLoopTool"
SET models = (
  COALESCE(models::jsonb, '[]'::jsonb)
  || '[{"id":"gpt-55","label":"GPT-5.5 (subscription)","model":"gpt-5.5"}]'::jsonb
)::text
WHERE
  "loopId" = 'ralph'
  AND "toolId" = 'codex'
  AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-55"}]'::jsonb;

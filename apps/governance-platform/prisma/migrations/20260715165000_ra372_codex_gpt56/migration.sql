-- RA-372: expose the GPT-5.6 agentic-coding family (sol / terra / luna) in the Codex launch matrix.
-- These require Codex CLI >= 0.144.0 (minimal_client_version); the fleet CLI pin was bumped to 0.144.4.
-- Append-only + idempotent so live registry edits are not overwritten by this migration.

-- Tool.codex ------------------------------------------------------------------
UPDATE "Tool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"gpt-56-sol","label":"GPT-5.6 Sol","model":"gpt-5.6-sol"}]'::jsonb)::text,
    "updatedAt" = now()
WHERE id = 'codex' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-56-sol"}]'::jsonb;

UPDATE "Tool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"gpt-56-terra","label":"GPT-5.6 Terra","model":"gpt-5.6-terra"}]'::jsonb)::text,
    "updatedAt" = now()
WHERE id = 'codex' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-56-terra"}]'::jsonb;

UPDATE "Tool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"gpt-56-luna","label":"GPT-5.6 Luna","model":"gpt-5.6-luna"}]'::jsonb)::text,
    "updatedAt" = now()
WHERE id = 'codex' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-56-luna"}]'::jsonb;

-- AgentLoopTool ralph/codex ---------------------------------------------------
UPDATE "AgentLoopTool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"gpt-56-sol","label":"GPT-5.6 Sol","model":"gpt-5.6-sol"}]'::jsonb)::text
WHERE "loopId" = 'ralph' AND "toolId" = 'codex' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-56-sol"}]'::jsonb;

UPDATE "AgentLoopTool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"gpt-56-terra","label":"GPT-5.6 Terra","model":"gpt-5.6-terra"}]'::jsonb)::text
WHERE "loopId" = 'ralph' AND "toolId" = 'codex' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-56-terra"}]'::jsonb;

UPDATE "AgentLoopTool"
SET models = (COALESCE(models::jsonb, '[]'::jsonb) || '[{"id":"gpt-56-luna","label":"GPT-5.6 Luna","model":"gpt-5.6-luna"}]'::jsonb)::text
WHERE "loopId" = 'ralph' AND "toolId" = 'codex' AND NOT COALESCE(models::jsonb, '[]'::jsonb) @> '[{"id":"gpt-56-luna"}]'::jsonb;

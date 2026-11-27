-- Refresh the Claude launch matrix to Opus 4.8.
-- Keep non-Claude/custom rows such as GLM presets intact.

WITH canonical_models AS (
  SELECT jsonb_build_array(
    jsonb_build_object('id', 'default', 'label', 'Claude Haiku 4.5', 'model', 'claude-haiku-4-5-20251001'),
    jsonb_build_object('id', 'sonnet', 'label', 'Claude Sonnet 4.6', 'model', 'claude-sonnet-4-6'),
    jsonb_build_object('id', 'opus', 'label', 'Claude Opus 4.8', 'model', 'claude-opus-4-8')
  ) AS models
),
preserved_tool_models AS (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) AS models
  FROM "Tool" tool
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tool.models::jsonb, '[]'::jsonb)) entry
  WHERE tool.id = 'claude-code'
    AND entry->>'id' NOT IN ('default', 'sonnet', 'opus', 'sonnet-37', 'opus-4', 'opus-4-7', 'opus-4-8')
)
UPDATE "Tool" tool
SET
  models = (
    SELECT (canonical_models.models || preserved_tool_models.models)::text
    FROM canonical_models, preserved_tool_models
  ),
  "defaultModelId" = 'opus',
  "updatedAt" = now()
WHERE tool.id = 'claude-code';

WITH canonical_models AS (
  SELECT jsonb_build_array(
    jsonb_build_object('id', 'default', 'label', 'Claude Haiku 4.5', 'model', 'claude-haiku-4-5-20251001'),
    jsonb_build_object('id', 'sonnet', 'label', 'Claude Sonnet 4.6', 'model', 'claude-sonnet-4-6'),
    jsonb_build_object('id', 'opus', 'label', 'Claude Opus 4.8', 'model', 'claude-opus-4-8')
  ) AS models
),
preserved_ralph_models AS (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) AS models
  FROM "AgentLoopTool" mapping
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mapping.models::jsonb, '[]'::jsonb)) entry
  WHERE mapping.id = 'lt-ralph-claude'
    AND entry->>'id' NOT IN ('default', 'sonnet', 'opus', 'sonnet-37', 'opus-4', 'opus-4-7', 'opus-4-8')
)
UPDATE "AgentLoopTool" mapping
SET models = (
  SELECT (canonical_models.models || preserved_ralph_models.models)::text
  FROM canonical_models, preserved_ralph_models
)
WHERE mapping.id = 'lt-ralph-claude';

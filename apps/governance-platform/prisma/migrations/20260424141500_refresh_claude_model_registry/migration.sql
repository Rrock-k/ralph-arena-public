-- Refresh the live Claude model registry to current Anthropic snapshot IDs.
-- Preserve non-Anthropic/custom entries by only replacing the canonical Claude ids.

WITH canonical_models AS (
  SELECT jsonb_build_array(
    jsonb_build_object('id', 'default', 'label', 'Claude Haiku 3.5', 'model', 'claude-3-5-haiku-20241022'),
    jsonb_build_object('id', 'sonnet', 'label', 'Claude Sonnet 4', 'model', 'claude-sonnet-4-20250514'),
    jsonb_build_object('id', 'sonnet-37', 'label', 'Claude Sonnet 3.7', 'model', 'claude-3-7-sonnet-20250219'),
    jsonb_build_object('id', 'opus', 'label', 'Claude Opus 4.1', 'model', 'claude-opus-4-1-20250805'),
    jsonb_build_object('id', 'opus-4', 'label', 'Claude Opus 4', 'model', 'claude-opus-4-20250514')
  ) AS models
),
preserved_tool_models AS (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) AS models
  FROM "Tool" tool
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tool.models::jsonb, '[]'::jsonb)) entry
  WHERE tool.id = 'claude-code'
    AND entry->>'id' NOT IN ('default', 'sonnet', 'sonnet-37', 'opus', 'opus-4')
),
preserved_ralph_models AS (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) AS models
  FROM "AgentLoopTool" mapping
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mapping.models::jsonb, '[]'::jsonb)) entry
  WHERE mapping.id = 'lt-ralph-claude'
    AND entry->>'id' NOT IN ('default', 'sonnet', 'sonnet-37', 'opus', 'opus-4')
)
UPDATE "Tool" tool
SET
  models = (
    SELECT (canonical_models.models || preserved_tool_models.models)::text
    FROM canonical_models, preserved_tool_models
  ),
  "updatedAt" = now()
WHERE tool.id = 'claude-code';

WITH canonical_models AS (
  SELECT jsonb_build_array(
    jsonb_build_object('id', 'default', 'label', 'Claude Haiku 3.5', 'model', 'claude-3-5-haiku-20241022'),
    jsonb_build_object('id', 'sonnet', 'label', 'Claude Sonnet 4', 'model', 'claude-sonnet-4-20250514'),
    jsonb_build_object('id', 'sonnet-37', 'label', 'Claude Sonnet 3.7', 'model', 'claude-3-7-sonnet-20250219'),
    jsonb_build_object('id', 'opus', 'label', 'Claude Opus 4.1', 'model', 'claude-opus-4-1-20250805'),
    jsonb_build_object('id', 'opus-4', 'label', 'Claude Opus 4', 'model', 'claude-opus-4-20250514')
  ) AS models
),
preserved_ralph_models AS (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) AS models
  FROM "AgentLoopTool" mapping
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mapping.models::jsonb, '[]'::jsonb)) entry
  WHERE mapping.id = 'lt-ralph-claude'
    AND entry->>'id' NOT IN ('default', 'sonnet', 'sonnet-37', 'opus', 'opus-4')
)
UPDATE "AgentLoopTool" mapping
SET models = (
  SELECT (canonical_models.models || preserved_ralph_models.models)::text
  FROM canonical_models, preserved_ralph_models
)
WHERE mapping.id = 'lt-ralph-claude';

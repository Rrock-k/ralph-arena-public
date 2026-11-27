-- RA-272 follow-up: user launch defaults are Ralph + Codex.
-- Keep model labels provider-neutral; billing mode is selected separately.

UPDATE "AgentLoopTool"
SET "isDefault" = CASE WHEN "toolId" = 'codex' THEN true ELSE false END
WHERE "loopId" = 'ralph'
  AND "toolId" IN ('codex', 'claude-code');

UPDATE "Tool" tool
SET
  models = normalized.models::text,
  "updatedAt" = now()
FROM (
  SELECT
    id,
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(model) = 'object' AND model ? 'label'
          THEN jsonb_set(model, '{label}', to_jsonb(replace(model->>'label', ' (subscription)', '')))
        ELSE model
      END
      ORDER BY ordinality
    ) AS models
  FROM "Tool"
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(models::jsonb, '[]'::jsonb)) WITH ORDINALITY AS entries(model, ordinality)
  WHERE models LIKE '%(subscription)%'
  GROUP BY id
) normalized
WHERE tool.id = normalized.id;

UPDATE "AgentLoopTool" mapping
SET models = normalized.models::text
FROM (
  SELECT
    id,
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(model) = 'object' AND model ? 'label'
          THEN jsonb_set(model, '{label}', to_jsonb(replace(model->>'label', ' (subscription)', '')))
        ELSE model
      END
      ORDER BY ordinality
    ) AS models
  FROM "AgentLoopTool"
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(models::jsonb, '[]'::jsonb)) WITH ORDINALITY AS entries(model, ordinality)
  WHERE models LIKE '%(subscription)%'
  GROUP BY id
) normalized
WHERE mapping.id = normalized.id;

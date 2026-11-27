-- RA-317: expose OpenCode as a Ralph-loop tool for free OpenCode Zen models.
-- Launch policy keeps auth explicit through OPENCODE_API_KEY and blocks
-- platform_credits until api-proxy owns OpenCode debit.

INSERT INTO "Tool" (id, name, label, description, models, "defaultModelId", "isActive", "createdAt", "updatedAt")
VALUES (
  'opencode',
  'opencode',
  'OpenCode',
  'OpenCode CLI with OpenCode Zen free models',
  $$[
    {"id":"deepseek-v4-flash-free","label":"DeepSeek V4 Flash Free","model":"opencode/deepseek-v4-flash-free"},
    {"id":"big-pickle","label":"Big Pickle Free","model":"opencode/big-pickle"},
    {"id":"nemotron-3-super-free","label":"Nemotron 3 Super Free","model":"opencode/nemotron-3-super-free"}
  ]$$,
  'deepseek-v4-flash-free',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  models = EXCLUDED.models,
  "defaultModelId" = EXCLUDED."defaultModelId",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = now();

INSERT INTO "AgentLoopTool" (id, "loopId", "toolId", models, "isDefault")
VALUES ('lt-ralph-opencode', 'ralph', 'opencode', NULL, false)
ON CONFLICT ("loopId", "toolId") DO UPDATE SET
  models = EXCLUDED.models,
  "isDefault" = false;

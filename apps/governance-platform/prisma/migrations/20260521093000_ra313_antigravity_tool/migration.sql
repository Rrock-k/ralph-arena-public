-- RA-313: expose Antigravity only as a Ralph-loop tool.
-- Launch policy keeps this operator/local/platform_credentials-only until smoke.

INSERT INTO "Tool" (id, name, label, description, models, "defaultModelId", "isActive", "createdAt", "updatedAt")
VALUES (
  'antigravity',
  'antigravity',
  'Antigravity',
  'Google Antigravity CLI with authd-owned keyring auth',
  '[]',
  NULL,
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
VALUES ('lt-ralph-antigravity', 'ralph', 'antigravity', NULL, false)
ON CONFLICT ("loopId", "toolId") DO UPDATE SET
  models = EXCLUDED.models,
  "isDefault" = false;

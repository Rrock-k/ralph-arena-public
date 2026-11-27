-- RA-200: expose GPT-5.4 in the Ralph + Codex launch matrix

INSERT INTO "AgentLoopTool" (id, "loopId", "toolId", models, "isDefault")
VALUES (
  'lt-ralph-codex',
  'ralph',
  'codex',
  '[{"id":"default","label":"GPT-5.1 Codex Mini","model":"gpt-5.1-codex-mini"},{"id":"codex-53","label":"GPT-5.3 Codex (subscription)","model":"gpt-5.3-codex"},{"id":"gpt-54","label":"GPT-5.4 (subscription)","model":"gpt-5.4"}]',
  false
)
ON CONFLICT ("loopId", "toolId") DO UPDATE
SET
  models = EXCLUDED.models,
  "isDefault" = EXCLUDED."isDefault";

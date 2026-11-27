-- RA-131: Seed AgentLoop, AgentLoopVersion, and Tool tables
-- Uses ON CONFLICT DO NOTHING to be safe for existing data

-- Tools
INSERT INTO "Tool" (id, name, description, models, "defaultModelId", "isActive", "createdAt", "updatedAt")
VALUES
  ('claude-code', 'claude-code', 'Claude Code CLI (Anthropic)', '[{"id":"default","label":"Claude Haiku 4.5","model":"haiku"},{"id":"sonnet","label":"Claude Sonnet 4.5","model":"claude-sonnet-4-5-20250929"},{"id":"opus","label":"Claude Opus 4.6","model":"claude-opus-4-6"},{"id":"glm-flash","label":"GLM-4.7 Flash (Z.AI, free)","model":"glm-4.7-flash"},{"id":"glm","label":"GLM-4.7 (Z.AI)","model":"glm-4.7"}]', 'default', true, now(), now()),
  ('codex', 'codex', 'OpenAI Codex CLI', '[{"id":"default","label":"GPT-5.1 Codex Mini","model":"gpt-5.1-codex-mini"},{"id":"codex-53","label":"GPT-5.3 Codex (subscription)","model":"gpt-5.3-codex"},{"id":"gpt-54","label":"GPT-5.4 (subscription)","model":"gpt-5.4"},{"id":"codex-53-mini","label":"GPT-5.3 Codex Mini (subscription)","model":"gpt-5.3-codex-mini"},{"id":"codex","label":"GPT-5 Codex","model":"gpt-5-codex"},{"id":"codex-51","label":"GPT-5.1 Codex","model":"gpt-5.1-codex"},{"id":"codex-52","label":"GPT-5.2 Codex","model":"gpt-5.2-codex"},{"id":"gpt5-mini","label":"GPT-5 Mini","model":"gpt-5-mini"}]', 'default', true, now(), now())
ON CONFLICT (name) DO NOTHING;

-- AgentLoops
INSERT INTO "AgentLoop" (id, name, description, "isActive", "createdAt", "updatedAt")
VALUES
  ('direct', 'direct', 'Direct agent execution (single tool invocation)', true, now(), now()),
  ('ralph', 'ralph', 'Ralph orchestration (plan -> code -> verify -> deploy)', true, now(), now()),
  ('dummy', 'dummy', 'Test adapter, no AI', true, now(), now())
ON CONFLICT (name) DO NOTHING;

-- AgentLoopVersions
INSERT INTO "AgentLoopVersion" (id, "agentLoopId", version, "commandTemplate", capabilities, "createdAt")
VALUES
  ('direct-v1', 'direct', '1.0.0', 'node /arena/cycles/direct.js --agent {agent} --model {model} --spec-dir {specdir} --work-dir {workdir}', '{"specs"}', now()),
  ('ralph-v1', 'ralph', '1.0.0', 'node /ralph/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}', '{"specs"}', now()),
  ('dummy-v1', 'dummy', '1.0.0', 'node /arena/cycles/dummy.js --work-dir {workdir}', '{}', now())
ON CONFLICT ("agentLoopId", version) DO NOTHING;

-- Set currentVersionId on loops (only if not already set)
UPDATE "AgentLoop" SET "currentVersionId" = 'direct-v1' WHERE id = 'direct' AND "currentVersionId" IS NULL;
UPDATE "AgentLoop" SET "currentVersionId" = 'ralph-v1' WHERE id = 'ralph' AND "currentVersionId" IS NULL;
UPDATE "AgentLoop" SET "currentVersionId" = 'dummy-v1' WHERE id = 'dummy' AND "currentVersionId" IS NULL;

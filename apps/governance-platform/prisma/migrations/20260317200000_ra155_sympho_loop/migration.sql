-- RA-155: Add installCommand to AgentLoop + seed Sympho loop

-- Add installCommand column
ALTER TABLE "AgentLoop" ADD COLUMN "installCommand" TEXT;

-- Sympho loop
INSERT INTO "AgentLoop" (id, name, description, "isActive", "sourceUrl", "installCommand", "createdAt", "updatedAt")
VALUES (
  'sympho',
  'sympho',
  'Sympho orchestrator — multi-turn agent loop with session continuity, retry, stall detection',
  true,
  'https://github.com/Rrock-k/sympho.git',
  'npm ci && npm run build',
  now(),
  now()
)
ON CONFLICT (name) DO NOTHING;

-- Sympho v1.0.0
INSERT INTO "AgentLoopVersion" (id, "agentLoopId", version, "commandTemplate", capabilities, changelog, "createdAt")
VALUES (
  'sympho-v1',
  'sympho',
  '1.0.0',
  'node {loopdir}/dist/arena/entry.js --agent {agent} --model {model} --spec-dir {specdir} --work-dir {workdir}',
  '{"specs","progress","log_streaming"}',
  'Initial release: multi-turn with --resume, WORKFLOW.md support, retry with exponential backoff, stall detection, live spec change detection',
  now()
)
ON CONFLICT ("agentLoopId", version) DO NOTHING;

-- Set current version
UPDATE "AgentLoop" SET "currentVersionId" = 'sympho-v1' WHERE id = 'sympho' AND "currentVersionId" IS NULL;

-- Tool mapping: sympho + claude-code (default)
INSERT INTO "AgentLoopTool" (id, "loopId", "toolId", models, "isDefault") VALUES
  ('lt-sympho-claude', 'sympho', 'claude-code', NULL, true)
ON CONFLICT ("loopId", "toolId") DO NOTHING;

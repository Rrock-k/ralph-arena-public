-- RA-131: AgentLoopTool join table — valid loop+tool combinations

CREATE TABLE "AgentLoopTool" (
    "id" TEXT NOT NULL,
    "loopId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "models" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AgentLoopTool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentLoopTool_loopId_toolId_key" ON "AgentLoopTool"("loopId", "toolId");
CREATE INDEX "AgentLoopTool_loopId_idx" ON "AgentLoopTool"("loopId");

ALTER TABLE "AgentLoopTool" ADD CONSTRAINT "AgentLoopTool_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "AgentLoop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentLoopTool" ADD CONSTRAINT "AgentLoopTool_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed valid combinations from agent-presets.ts
-- direct: claude-code (all models), codex (all models)
INSERT INTO "AgentLoopTool" (id, "loopId", "toolId", models, "isDefault") VALUES
  ('lt-direct-claude', 'direct', 'claude-code', NULL, true),
  ('lt-direct-codex', 'direct', 'codex', NULL, false),
  ('lt-ralph-claude', 'ralph', 'claude-code', '[{"id":"default","label":"Claude Haiku 4.5","model":"haiku"},{"id":"sonnet","label":"Claude Sonnet 4.5","model":"claude-sonnet-4-5-20250929"},{"id":"opus","label":"Claude Opus 4.6","model":"claude-opus-4-6"}]', true),
  ('lt-ralph-codex', 'ralph', 'codex', '[{"id":"default","label":"GPT-5.1 Codex Mini","model":"gpt-5.1-codex-mini"},{"id":"codex-53","label":"GPT-5.3 Codex (subscription)","model":"gpt-5.3-codex"}]', false),
  ('lt-dummy-codex', 'dummy', 'codex', '[{"id":"default","label":"GPT-5.1 Codex Mini","model":"gpt-5.1-codex-mini"}]', true)
ON CONFLICT ("loopId", "toolId") DO NOTHING;

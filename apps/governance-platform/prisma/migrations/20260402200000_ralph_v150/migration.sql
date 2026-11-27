-- Ralph v1.5.0: deferred planning, circuit breaker, e2e enforcer, rate-limit resilience

INSERT INTO "AgentLoopVersion" (id, "agentLoopId", version, "commandTemplate", capabilities, changelog, "createdAt")
VALUES (
  'ralph-v150',
  'ralph',
  '1.5.0',
  'node {loopdir}/dist/index.js run --work-dir {workdir} --spec-dir {specdir} --agent {agent} --model {model}',
  '{"specs","progress","community_qa","log_streaming"}',
  'Deferred phase planning + NEEDS_REPLAN signal, e2e enforcer gated by LLM decision, circuit breaker for task churn on systemic failures, rate-limit sleeps in-process, build verification timeout + custom buildCommand, JSONL buffer flush fix',
  now()
)
ON CONFLICT ("agentLoopId", version) DO NOTHING;

-- Set as current version
UPDATE "AgentLoop"
SET "currentVersionId" = 'ralph-v150', "updatedAt" = now()
WHERE id = 'ralph';

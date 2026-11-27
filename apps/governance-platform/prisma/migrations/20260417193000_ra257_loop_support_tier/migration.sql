ALTER TABLE "AgentLoopVersion"
ADD COLUMN "supportTier" TEXT NOT NULL DEFAULT 'unsupported';

UPDATE "AgentLoopVersion"
SET "supportTier" = CASE
  WHEN id = 'ralph-v150' THEN 'resident-supported'
  WHEN id = 'ralph-v1.4.0' THEN 'preview-only-supported'
  WHEN id IN ('direct-v1', 'direct-v110', 'ralph-v130', 'sympho-v1') THEN 'legacy-limited'
  WHEN id = 'dummy-v1' THEN 'unsupported'
  ELSE "supportTier"
END;

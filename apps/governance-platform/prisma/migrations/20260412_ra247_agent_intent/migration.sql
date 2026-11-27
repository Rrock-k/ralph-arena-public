-- RA-247: Add agentIntent to ProjectComponent
ALTER TABLE "ProjectComponent" ADD COLUMN IF NOT EXISTS "agentIntent" TEXT NOT NULL DEFAULT 'ON';

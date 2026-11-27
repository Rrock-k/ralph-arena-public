-- Add isPinned to Project (pin projects to top of admin list)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;

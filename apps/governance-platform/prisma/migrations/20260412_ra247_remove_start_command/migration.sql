-- RA-247: Remove startCommand (already applied via ALTER TABLE)
ALTER TABLE "Project" DROP COLUMN IF EXISTS "startCommand";

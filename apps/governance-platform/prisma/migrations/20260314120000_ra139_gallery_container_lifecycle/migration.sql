-- RA-139: Gallery container lifecycle — remove + revive containers
ALTER TABLE "Project" ADD COLUMN "containerRemoved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "startCommand" TEXT;

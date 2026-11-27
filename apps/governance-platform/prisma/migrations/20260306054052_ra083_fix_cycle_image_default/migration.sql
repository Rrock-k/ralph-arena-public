-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "cycleImage" SET DEFAULT 'arena-public-worker:local';

-- Fix existing projects that got the wrong default
UPDATE "Project" SET "cycleImage" = 'arena-public-worker:local' WHERE "cycleImage" = 'arena-worker:latest';

-- AlterTable
ALTER TABLE "Run" ALTER COLUMN "status" SET DEFAULT 'PROVISIONING';

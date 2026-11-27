-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cycleImage" TEXT NOT NULL DEFAULT 'arena-worker:latest',
ALTER COLUMN "agentImpl" SET DEFAULT 'direct';

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "containerName" TEXT,
ADD COLUMN     "lastHeartbeat" TIMESTAMP(3),
ADD COLUMN     "workerHost" TEXT,
ALTER COLUMN "agentImpl" SET DEFAULT 'direct';

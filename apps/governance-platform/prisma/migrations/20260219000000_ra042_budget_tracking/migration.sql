-- RA-042: Cost tracking and project budgets

-- AlterTable: Add cost tracking fields to Run
ALTER TABLE "Run" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "Run" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "Run" ADD COLUMN "estimatedCostUsd" DOUBLE PRECISION;

-- AlterTable: Add runnerBackend to Project (RA-037)
ALTER TABLE "Project" ADD COLUMN "runnerBackend" TEXT NOT NULL DEFAULT 'local';

-- CreateTable: ProjectBudget
CREATE TABLE "ProjectBudget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "totalCreditsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usedCreditsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ApiUsage
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudget_projectId_key" ON "ProjectBudget"("projectId");

-- CreateIndex
CREATE INDEX "ApiUsage_runId_idx" ON "ApiUsage"("runId");

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsage" ADD CONSTRAINT "ApiUsage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

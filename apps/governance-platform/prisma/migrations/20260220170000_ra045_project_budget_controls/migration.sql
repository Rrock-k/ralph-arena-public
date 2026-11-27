-- RA-045: Project budget controls and adjustment audit trail

-- AlterTable: ProjectBudget
ALTER TABLE "ProjectBudget"
ADD COLUMN "isEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: ProjectBudgetAdjustment
CREATE TABLE "ProjectBudgetAdjustment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBudgetAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBudgetAdjustment_projectId_createdAt_idx"
ON "ProjectBudgetAdjustment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectBudgetAdjustment_createdById_createdAt_idx"
ON "ProjectBudgetAdjustment"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectBudgetAdjustment"
ADD CONSTRAINT "ProjectBudgetAdjustment_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetAdjustment"
ADD CONSTRAINT "ProjectBudgetAdjustment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

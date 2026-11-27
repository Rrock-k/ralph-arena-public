ALTER TABLE "AgentLoopVersion"
ADD COLUMN     "complianceStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "complianceResult" JSONB,
ADD COLUMN     "complianceCheckedAt" TIMESTAMP(3);

CREATE INDEX "AgentLoopVersion_complianceStatus_idx" ON "AgentLoopVersion"("complianceStatus");

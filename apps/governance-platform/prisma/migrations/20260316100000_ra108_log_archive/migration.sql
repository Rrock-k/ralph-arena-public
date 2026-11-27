-- RA-108: Log Archive — snapshot of project log before relaunch
CREATE TABLE "LogArchive" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "log" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "agentImpl" TEXT NOT NULL,
    "model" TEXT,
    "terminalState" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LogArchive_projectId_createdAt_idx" ON "LogArchive"("projectId", "createdAt");

ALTER TABLE "LogArchive" ADD CONSTRAINT "LogArchive_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RA-048: Link resumed runs to paused parent run

ALTER TABLE "Run"
ADD COLUMN "resumedFromRunId" TEXT;

ALTER TABLE "Run"
ADD CONSTRAINT "Run_resumedFromRunId_fkey"
FOREIGN KEY ("resumedFromRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Run_resumedFromRunId_createdAt_idx" ON "Run"("resumedFromRunId", "createdAt");

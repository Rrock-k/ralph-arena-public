-- RA-192 Phase 4: DB-backed runtime reconciler leases.
CREATE TABLE "RuntimeIntent" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "runnerMode" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'CLAIMED',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "lockedUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RuntimeIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RuntimeIntent_projectId_state_createdAt_idx" ON "RuntimeIntent"("projectId", "state", "createdAt");
CREATE INDEX "RuntimeIntent_componentId_state_lockedUntil_idx" ON "RuntimeIntent"("componentId", "state", "lockedUntil");
CREATE INDEX "RuntimeIntent_host_state_nextAttemptAt_idx" ON "RuntimeIntent"("host", "state", "nextAttemptAt");

-- A component may have at most one live worker lease. Expired leases are marked FAILED
-- by the claim endpoint before a new lease is inserted.
CREATE UNIQUE INDEX "RuntimeIntent_component_claimed_unique"
  ON "RuntimeIntent"("componentId")
  WHERE "state" = 'CLAIMED';

ALTER TABLE "RuntimeIntent" ADD CONSTRAINT "RuntimeIntent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RuntimeIntent" ADD CONSTRAINT "RuntimeIntent_componentId_fkey"
  FOREIGN KEY ("componentId") REFERENCES "ProjectComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

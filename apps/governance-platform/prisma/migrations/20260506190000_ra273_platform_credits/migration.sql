-- RA-273: Platform Credits managed provider runs for users.
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "providerBillingMode" TEXT NOT NULL DEFAULT 'byok';

CREATE TABLE IF NOT EXISTS "UserCreditAdjustment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "amountUsd" DOUBLE PRECISION NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserCreditAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserCreditAdjustment_userId_createdAt_idx"
  ON "UserCreditAdjustment"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "UserCreditAdjustment_projectId_createdAt_idx"
  ON "UserCreditAdjustment"("projectId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserCreditAdjustment_userId_fkey'
  ) THEN
    ALTER TABLE "UserCreditAdjustment"
      ADD CONSTRAINT "UserCreditAdjustment_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserCreditAdjustment_projectId_fkey'
  ) THEN
    ALTER TABLE "UserCreditAdjustment"
      ADD CONSTRAINT "UserCreditAdjustment_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "FeatureFlag" ("key", "enabled", "createdAt", "updatedAt")
VALUES ('managed_provider_credits', false, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

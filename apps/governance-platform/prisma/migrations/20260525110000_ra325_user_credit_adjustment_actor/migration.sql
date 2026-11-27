-- RA-325: Store finance-admin actor for account credit adjustments.
ALTER TABLE "UserCreditAdjustment" ADD COLUMN "createdById" TEXT;

ALTER TABLE "UserCreditAdjustment"
  ADD CONSTRAINT "UserCreditAdjustment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "UserCreditAdjustment_createdById_createdAt_idx"
  ON "UserCreditAdjustment"("createdById", "createdAt");

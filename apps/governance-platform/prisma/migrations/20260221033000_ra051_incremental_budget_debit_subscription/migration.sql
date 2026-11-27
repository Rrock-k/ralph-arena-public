-- RA-051: Track per-run budget debits to support live incremental charging without double-charging on terminal updates.
ALTER TABLE "Run"
ADD COLUMN "budgetDebitedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

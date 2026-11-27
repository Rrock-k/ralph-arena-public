-- RA-005: Simplify season phases — merge Submission + Voting into single Open phase
-- Remove submissionEnd, votingStart, votingEnd columns (data is no longer needed)

ALTER TABLE "Season" DROP COLUMN IF EXISTS "submissionEnd";
ALTER TABLE "Season" DROP COLUMN IF EXISTS "votingStart";
ALTER TABLE "Season" DROP COLUMN IF EXISTS "votingEnd";

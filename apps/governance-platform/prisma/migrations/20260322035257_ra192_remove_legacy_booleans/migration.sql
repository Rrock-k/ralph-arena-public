-- RA-192 Phase 3D: Remove legacy boolean fields
-- These fields are replaced by component-level state (desiredRuntime, actualRuntime, implState)
-- containerSleeping → desiredRuntime=STOPPED + actualRuntime=ABSENT
-- containerRemoved → state=ARCHIVED + desiredRuntime=REMOVED
-- cancelRequested → derived from component state transitions

ALTER TABLE "Project" DROP COLUMN "cancelRequested",
DROP COLUMN "containerRemoved",
DROP COLUMN "containerSleeping";

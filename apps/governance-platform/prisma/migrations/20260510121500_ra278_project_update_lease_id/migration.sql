-- RA-278: bind project update delivery acks to the active claim lease.
ALTER TABLE "ProjectUpdateOutbox" ADD COLUMN "leaseId" TEXT;

CREATE INDEX "ProjectUpdateOutbox_leaseId_idx"
  ON "ProjectUpdateOutbox"("leaseId");

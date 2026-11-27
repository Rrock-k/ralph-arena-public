ALTER TABLE "AccessGrant" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "AccessGrant" ADD COLUMN "sourceSyncedAt" TIMESTAMP(3);
ALTER TABLE "AccessAuditLog" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'manual';

-- RA-223: Access control foundation with scoped grants and audit log

CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "sourcePresetKey" TEXT,
    "customLabel" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grantedById" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccessAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "subjectUserId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "sourcePresetKey" TEXT,
    "previousCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessGrant_subjectUserId_scopeType_createdAt_idx"
  ON "AccessGrant"("subjectUserId", "scopeType", "createdAt");

CREATE INDEX "AccessGrant_scopeType_scopeId_createdAt_idx"
  ON "AccessGrant"("scopeType", "scopeId", "createdAt");

CREATE INDEX "AccessGrant_revokedAt_expiresAt_idx"
  ON "AccessGrant"("revokedAt", "expiresAt");

CREATE INDEX "AccessGrant_grantedById_createdAt_idx"
  ON "AccessGrant"("grantedById", "createdAt");

CREATE INDEX "AccessAuditLog_subjectUserId_createdAt_idx"
  ON "AccessAuditLog"("subjectUserId", "createdAt");

CREATE INDEX "AccessAuditLog_actorUserId_createdAt_idx"
  ON "AccessAuditLog"("actorUserId", "createdAt");

CREATE INDEX "AccessAuditLog_scopeType_scopeId_createdAt_idx"
  ON "AccessAuditLog"("scopeType", "scopeId", "createdAt");

CREATE INDEX "AccessAuditLog_action_createdAt_idx"
  ON "AccessAuditLog"("action", "createdAt");

ALTER TABLE "AccessGrant"
  ADD CONSTRAINT "AccessGrant_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccessGrant"
  ADD CONSTRAINT "AccessGrant_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccessAuditLog"
  ADD CONSTRAINT "AccessAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccessAuditLog"
  ADD CONSTRAINT "AccessAuditLog_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RA-047: Feature flags configurable from admin panel

CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "FeatureFlag_updatedAt_idx" ON "FeatureFlag"("updatedAt");

ALTER TABLE "FeatureFlag"
ADD CONSTRAINT "FeatureFlag_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

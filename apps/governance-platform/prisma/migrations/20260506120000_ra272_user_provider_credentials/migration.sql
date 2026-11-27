-- RA-272: User-scoped provider credentials for BYOK launches.
CREATE TABLE "UserProviderCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "last4" TEXT NOT NULL,
  "validationStatus" TEXT,
  "validatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProviderCredential_userId_provider_key" ON "UserProviderCredential"("userId", "provider");
CREATE INDEX "UserProviderCredential_provider_idx" ON "UserProviderCredential"("provider");

ALTER TABLE "UserProviderCredential"
  ADD CONSTRAINT "UserProviderCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

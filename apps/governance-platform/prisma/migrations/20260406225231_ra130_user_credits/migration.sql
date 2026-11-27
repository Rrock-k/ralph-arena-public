-- RA-130: User credit balance and purchase history

CREATE TABLE "UserCreditBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserCreditBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planTitle" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "creditsGranted" DOUBLE PRECISION NOT NULL,
    "freemiusLicenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCreditBalance_userId_key" ON "UserCreditBalance"("userId");
CREATE UNIQUE INDEX "CreditPurchase_freemiusLicenseId_key" ON "CreditPurchase"("freemiusLicenseId");
CREATE INDEX "CreditPurchase_userId_createdAt_idx" ON "CreditPurchase"("userId", "createdAt");

ALTER TABLE "UserCreditBalance" ADD CONSTRAINT "UserCreditBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

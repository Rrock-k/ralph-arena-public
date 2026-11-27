-- CreateTable
CREATE TABLE "VpsHost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "providerServerId" TEXT NOT NULL,
    "providerKeyId" TEXT,
    "ip" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "region" TEXT NOT NULL DEFAULT 'fsn1',
    "serverType" TEXT NOT NULL DEFAULT 'cx22',
    "sshPrivateKey" TEXT NOT NULL,
    "sshPrivateKeyIv" TEXT NOT NULL,
    "sshPrivateKeyTag" TEXT NOT NULL,
    "sshPublicKey" TEXT NOT NULL,
    "previewDomain" TEXT,
    "errorMessage" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsHost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VpsHost_projectId_key" ON "VpsHost"("projectId");

-- CreateIndex
CREATE INDEX "VpsHost_status_idx" ON "VpsHost"("status");

-- AddForeignKey
ALTER TABLE "VpsHost" ADD CONSTRAINT "VpsHost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

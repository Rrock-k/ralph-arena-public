-- CreateTable
CREATE TABLE "ProjectSecret" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectSecret_projectId_idx" ON "ProjectSecret"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSecret_projectId_key_key" ON "ProjectSecret"("projectId", "key");

-- AddForeignKey
ALTER TABLE "ProjectSecret" ADD CONSTRAINT "ProjectSecret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

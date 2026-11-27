-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "agentLoopVersionId" TEXT,
ADD COLUMN     "toolId" TEXT;

-- CreateTable
CREATE TABLE "AgentLoop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "sourceUrl" TEXT,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLoopVersion" (
    "id" TEXT NOT NULL,
    "agentLoopId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "commandTemplate" TEXT NOT NULL,
    "capabilities" TEXT[],
    "changelog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLoopVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "models" TEXT,
    "defaultModelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentLoop_name_key" ON "AgentLoop"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AgentLoop_currentVersionId_key" ON "AgentLoop"("currentVersionId");

-- CreateIndex
CREATE INDEX "AgentLoopVersion_agentLoopId_idx" ON "AgentLoopVersion"("agentLoopId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentLoopVersion_agentLoopId_version_key" ON "AgentLoopVersion"("agentLoopId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_name_key" ON "Tool"("name");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_agentLoopVersionId_fkey" FOREIGN KEY ("agentLoopVersionId") REFERENCES "AgentLoopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLoop" ADD CONSTRAINT "AgentLoop_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLoop" ADD CONSTRAINT "AgentLoop_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "AgentLoopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLoopVersion" ADD CONSTRAINT "AgentLoopVersion_agentLoopId_fkey" FOREIGN KEY ("agentLoopId") REFERENCES "AgentLoop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

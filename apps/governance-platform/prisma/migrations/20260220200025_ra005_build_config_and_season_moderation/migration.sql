-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "buildTransitionedAt" TIMESTAMP(3),
ADD COLUMN     "requiresModeration" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BuildConfig" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "agentImpl" TEXT NOT NULL,
    "model" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildConfig_seasonId_idx" ON "BuildConfig"("seasonId");

-- AddForeignKey
ALTER TABLE "BuildConfig" ADD CONSTRAINT "BuildConfig_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

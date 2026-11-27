-- RA-225: In-app notifications — bell icon, read/unread

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InAppNotification_userId_read_createdAt_idx" ON "InAppNotification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_createdAt_idx" ON "InAppNotification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

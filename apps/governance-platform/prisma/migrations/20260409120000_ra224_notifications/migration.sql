-- RA-224: Notification system — preferences, audit log, newsletter subscribers

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resendEmailId" TEXT,
    "error" TEXT,
    "projectId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'landing',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "unsubscribeToken" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_channel_key" ON "NotificationPreference"("userId", "eventType", "channel");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_projectId_createdAt_idx" ON "NotificationLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_resendEmailId_idx" ON "NotificationLog"("resendEmailId");

-- CreateIndex
CREATE INDEX "NotificationLog_eventType_createdAt_idx" ON "NotificationLog"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_unsubscribeToken_key" ON "NewsletterSubscriber"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_status_idx" ON "NewsletterSubscriber"("status");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_email_idx" ON "NewsletterSubscriber"("email");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

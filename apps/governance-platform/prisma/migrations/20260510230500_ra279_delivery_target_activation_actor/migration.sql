ALTER TABLE "ProjectUpdateDeliveryTarget"
    ADD COLUMN "activatedByUserId" TEXT;

CREATE INDEX "ProjectUpdateDeliveryTarget_activatedByUserId_activatedAt_idx"
    ON "ProjectUpdateDeliveryTarget"("activatedByUserId", "activatedAt");

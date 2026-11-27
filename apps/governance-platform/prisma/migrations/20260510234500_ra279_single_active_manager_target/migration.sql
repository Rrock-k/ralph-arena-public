WITH ranked AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "projectId", "sourceSystem", "audience"
            ORDER BY "activatedAt" DESC, "createdAt" DESC, "id" DESC
        ) AS row_number
    FROM "ProjectUpdateDeliveryTarget"
    WHERE "status" = 'ACTIVE'
      AND "audience" = 'project_managers'
)
UPDATE "ProjectUpdateDeliveryTarget" AS target
SET
    "status" = 'REVOKED',
    "revokedAt" = NOW()
FROM ranked
WHERE target."id" = ranked."id"
  AND ranked.row_number > 1;

UPDATE "ProjectUpdateDeliveryTarget" AS target
SET "createdByUserId" = NULL
WHERE target."createdByUserId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "User" AS user_row WHERE user_row."id" = target."createdByUserId"
  );

UPDATE "ProjectUpdateDeliveryTarget" AS target
SET "activatedByUserId" = NULL
WHERE target."activatedByUserId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "User" AS user_row WHERE user_row."id" = target."activatedByUserId"
  );

UPDATE "ProjectUpdateDeliveryTarget" AS target
SET "revokedByUserId" = NULL
WHERE target."revokedByUserId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "User" AS user_row WHERE user_row."id" = target."revokedByUserId"
  );

ALTER TABLE "ProjectUpdateDeliveryTarget"
    ADD CONSTRAINT "ProjectUpdateDeliveryTarget_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectUpdateDeliveryTarget"
    ADD CONSTRAINT "ProjectUpdateDeliveryTarget_activatedByUserId_fkey"
    FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectUpdateDeliveryTarget"
    ADD CONSTRAINT "ProjectUpdateDeliveryTarget_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProjectUpdateDeliveryTarget_one_active_manager_target_idx"
    ON "ProjectUpdateDeliveryTarget"("projectId", "sourceSystem", "audience")
    WHERE "status" = 'ACTIVE' AND "audience" = 'project_managers';

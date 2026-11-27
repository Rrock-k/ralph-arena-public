-- RA-223 follow-up: backfill scoped superadmin grants from legacy User.role=ADMIN

INSERT INTO "AccessGrant" (
  "id",
  "subjectUserId",
  "scopeType",
  "scopeId",
  "sourcePresetKey",
  "customLabel",
  "capabilities",
  "grantedById",
  "reason",
  "expiresAt",
  "revokedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'bootstrap-superadmin-' || u."id",
  u."id",
  'platform',
  NULL,
  'superadmin',
  NULL,
  ARRAY[
    'project.view',
    'project.runtime.manage',
    'project.specs.write',
    'project.assets.manage',
    'project.secrets.manage',
    'project.secrets.reveal',
    'project.required_secrets.manage',
    'project.budget.view',
    'project.budget.manage',
    'project.settings.manage',
    'project.access.manage',
    'project.delete',
    'platform.ops.view',
    'platform.projects.view',
    'platform.projects.manage',
    'platform.registry.manage',
    'platform.governance.manage',
    'platform.finance.manage',
    'platform.flags.manage',
    'platform.runtime.manage',
    'platform.access.manage'
  ]::TEXT[],
  NULL,
  'Backfilled from legacy User.role = ADMIN',
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1
    FROM "AccessGrant" g
    WHERE g."subjectUserId" = u."id"
      AND g."scopeType" = 'platform'
      AND g."sourcePresetKey" = 'superadmin'
      AND g."revokedAt" IS NULL
      AND (g."expiresAt" IS NULL OR g."expiresAt" > CURRENT_TIMESTAMP)
  );

INSERT INTO "AccessAuditLog" (
  "id",
  "action",
  "actorUserId",
  "subjectUserId",
  "scopeType",
  "scopeId",
  "sourcePresetKey",
  "previousCapabilities",
  "nextCapabilities",
  "note",
  "createdAt"
)
SELECT
  'bootstrap-superadmin-audit-' || u."id",
  'grant_created',
  NULL,
  u."id",
  'platform',
  NULL,
  'superadmin',
  ARRAY[]::TEXT[],
  ARRAY[
    'project.view',
    'project.runtime.manage',
    'project.specs.write',
    'project.assets.manage',
    'project.secrets.manage',
    'project.secrets.reveal',
    'project.required_secrets.manage',
    'project.budget.view',
    'project.budget.manage',
    'project.settings.manage',
    'project.access.manage',
    'project.delete',
    'platform.ops.view',
    'platform.projects.view',
    'platform.projects.manage',
    'platform.registry.manage',
    'platform.governance.manage',
    'platform.finance.manage',
    'platform.flags.manage',
    'platform.runtime.manage',
    'platform.access.manage'
  ]::TEXT[],
  'Backfilled from legacy User.role = ADMIN',
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1
    FROM "AccessAuditLog" a
    WHERE a."subjectUserId" = u."id"
      AND a."scopeType" = 'platform'
      AND a."sourcePresetKey" = 'superadmin'
      AND a."note" = 'Backfilled from legacy User.role = ADMIN'
  );

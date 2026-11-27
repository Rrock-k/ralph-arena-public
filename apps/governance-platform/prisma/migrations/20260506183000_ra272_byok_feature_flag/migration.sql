-- RA-272: Admin kill switch for user BYOK provider keys.
INSERT INTO "FeatureFlag" ("key", "enabled", "createdAt", "updatedAt")
VALUES ('byok_provider_keys', true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

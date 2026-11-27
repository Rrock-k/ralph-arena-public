-- RA-210: Replace publicPreview boolean with visibility enum string
-- Values: "featured" | "public" | "private"

-- Step 1: Add new column
ALTER TABLE "Project" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';

-- Step 2: Backfill from publicPreview
UPDATE "Project" SET "visibility" = CASE WHEN "publicPreview" = true THEN 'public' ELSE 'private' END;

-- Step 3: Drop old column
ALTER TABLE "Project" DROP COLUMN "publicPreview";

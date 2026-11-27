-- RA-153: Gallery cleanup — remove unused title/description/screenshot fields, add index

ALTER TABLE "Project" DROP COLUMN IF EXISTS "galleryTitle";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "galleryDescription";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "galleryScreenshotUrl";

CREATE INDEX IF NOT EXISTS "Project_galleryFeatured_galleryFeaturedAt_idx" ON "Project"("galleryFeatured", "galleryFeaturedAt");

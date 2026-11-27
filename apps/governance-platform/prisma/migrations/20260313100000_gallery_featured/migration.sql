-- Gallery feature fields
ALTER TABLE "Project" ADD COLUMN "galleryFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "galleryTitle" TEXT;
ALTER TABLE "Project" ADD COLUMN "galleryDescription" TEXT;
ALTER TABLE "Project" ADD COLUMN "galleryScreenshotUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN "galleryFeaturedAt" TIMESTAMP(3);

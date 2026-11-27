-- Explore ordering: explicit admin-controlled rank for project cards.
ALTER TABLE "Project" ADD COLUMN "exploreRank" INTEGER;

CREATE INDEX "Project_exploreRank_createdAt_idx" ON "Project"("exploreRank", "createdAt");

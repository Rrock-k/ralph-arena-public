CREATE INDEX CONCURRENTLY IF NOT EXISTS "RunLog_event_createdAt_idx"
  ON "RunLog"("event", "createdAt");

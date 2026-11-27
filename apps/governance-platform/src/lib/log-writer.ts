/**
 * RA-116 + RA-120: Append JSONL log lines and lifecycle events to Project.log.
 * Used by governance endpoints to inject timestamped logs and lifecycle markers.
 */

import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";

/**
 * Append raw JSONL text to Project.log and notify SSE subscribers.
 */
export async function appendJsonl(projectId: string, jsonl: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Project" SET
       log = COALESCE(log, '') || $1,
       "updatedAt" = NOW()
     WHERE id = $2`,
    jsonl,
    projectId,
  );

  progressBus.notifyChanged({
    type: "log_chunk",
    projectId,
    text: jsonl,
  });
}

/**
 * Append a lifecycle milestone to the project log stream.
 * Shows up as a styled marker in the UI (e.g. ── CONTAINER_STARTED ──).
 */
export async function appendLifecycle(projectId: string, event: string): Promise<void> {
  const line = JSON.stringify({ ts: Date.now(), lc: event }) + "\n";
  await appendJsonl(projectId, line);
}

import { progressBus } from "@/lib/progress-bus";
import { resolveAdminOpsViewer } from "@/lib/admin-ops-shell";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 30_000;

export async function GET() {
  const viewer = await resolveAdminOpsViewer();
  if (!viewer.authorized) {
    return new Response(JSON.stringify({ error: viewer.error }), {
      status: viewer.status,
      headers: { "content-type": "application/json" },
    });
  }

  const visibleProjectIds = viewer.visibleProjectIds
    ? new Set(viewer.visibleProjectIds)
    : null;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":keepalive\n\n"));
        } catch {
          // stream closed
        }
      }, KEEPALIVE_MS);

      unsubscribe = progressBus.onDataChanged((event) => {
        const payload = event.projectId
          ? visibleProjectIds && !visibleProjectIds.has(event.projectId)
            ? null
            : { type: event.type, projectId: event.projectId, scope: "project" as const }
          : { type: event.type, scope: "all" as const };

        if (!payload) return;

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // stream closed
        }
      });
    },
    cancel() {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

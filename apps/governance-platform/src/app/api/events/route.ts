import { progressBus } from "@/lib/progress-bus";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 30_000;

/**
 * RA-033: Global SSE endpoint. Sends "changed" event whenever data mutates.
 * LiveRefresh component subscribes and calls router.refresh().
 */
export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:keepalive\n\n`));
        } catch {
          // Stream closed
        }
      }, KEEPALIVE_MS);

      unsubscribe = progressBus.onDataChanged((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed
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

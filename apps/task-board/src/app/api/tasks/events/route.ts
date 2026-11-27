import { backlogWatcher } from "@/lib/file-watcher";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      console.log("[SSE] Client connected");
      controller.enqueue(encoder.encode("data: connected\n\n"));

      unsubscribe = backlogWatcher.subscribe(() => {
        console.log("[SSE] Sending changed event to client");
        try {
          controller.enqueue(encoder.encode("data: changed\n\n"));
        } catch {
          // stream already closed
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // stream already closed
        }
      }, 30_000);
    },
    cancel() {
      // Called when client disconnects
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

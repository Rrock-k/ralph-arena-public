import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessTextResponse } from "@/lib/project-access-response";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 30_000;

/**
 * GET /api/projects/:id/logs/stream
 *
 * SSE endpoint for real-time project logs.
 * Sends a "catchup" event with existing log text, then streams
 * "log_chunk" events as the runner pushes new chunks.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await context.params;
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return projectAccessTextResponse(access.error);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { log: true },
  });

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send existing log as catchup
      if (project.log) {
        controller.enqueue(
          encoder.encode(
            `event: catchup\ndata: ${JSON.stringify({ text: project.log })}\n\n`,
          ),
        );
      }

      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:keepalive\n\n`));
        } catch {
          // Stream closed
        }
      }, KEEPALIVE_MS);

      unsubscribe = progressBus.onDataChanged((event) => {
        if (event.type !== "log_chunk" || event.projectId !== projectId) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: log_chunk\ndata: ${JSON.stringify({ text: event.text })}\n\n`,
            ),
          );
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

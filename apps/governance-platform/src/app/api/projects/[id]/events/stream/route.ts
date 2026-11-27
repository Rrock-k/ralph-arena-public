import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import { isCommunityQaEnabled } from "@/lib/feature-flags";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessTextResponse } from "@/lib/project-access-response";

export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 30_000;

/**
 * GET /api/projects/:id/events/stream
 *
 * RA-089: SSE endpoint for real-time project events.
 * Sends a "catchup" event with existing events, then streams
 * "project_event" notifications as new events arrive.
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

  if (!(await isCommunityQaEnabled())) {
    return new Response("Feature not enabled", { status: 404 });
  }

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  // Fetch existing events for catchup
  const existingEvents = await (prisma as any).projectEvent.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  // Track cursor to avoid sending duplicates
  let lastSeenId: string | null =
    existingEvents.length > 0
      ? existingEvents[existingEvents.length - 1].id
      : null;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send existing events as catchup
      if (existingEvents.length > 0) {
        const serialized = existingEvents.map((e: any) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
        }));
        controller.enqueue(
          encoder.encode(
            `event: catchup\ndata: ${JSON.stringify({ events: serialized })}\n\n`,
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

      unsubscribe = progressBus.onDataChanged(async (event) => {
        if (event.type !== "project_event" || event.projectId !== projectId) return;
        try {
          // Fetch only events newer than our cursor
          const where: Record<string, unknown> = { projectId };
          if (lastSeenId) {
            const lastSeen = await (prisma as any).projectEvent.findUnique({
              where: { id: lastSeenId },
              select: { createdAt: true },
            });
            if (lastSeen) {
              where.createdAt = { gt: lastSeen.createdAt };
            }
          }

          const newEvents = await (prisma as any).projectEvent.findMany({
            where,
            orderBy: { createdAt: "asc" },
          });

          if (newEvents.length === 0) return;

          // Update cursor
          lastSeenId = newEvents[newEvents.length - 1].id;

          const serialized = newEvents.map((e: any) => ({
            ...e,
            createdAt: e.createdAt.toISOString(),
          }));
          controller.enqueue(
            encoder.encode(
              `event: project_event\ndata: ${JSON.stringify({ events: serialized })}\n\n`,
            ),
          );
        } catch {
          // Stream closed or DB error
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

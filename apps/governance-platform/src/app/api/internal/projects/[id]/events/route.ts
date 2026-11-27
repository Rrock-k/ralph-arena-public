import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import {
  PushEventsRequestSchema,
  EVENT_PAYLOAD_SCHEMAS,
  WorkspaceEventTypeSchema,
} from "@arena/contracts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/internal/projects/:id/events
 *
 * RA-089: Runner pushes outgoing events from agent (direction="out").
 */
export async function POST(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  if (!isRunnerAuthorized(request, { projectId })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = PushEventsRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const created = [];
  for (const evt of parsed.data.events) {
    // Validate per-type payload — reject unknown event types
    const payloadSchema = EVENT_PAYLOAD_SCHEMAS[evt.type];
    if (!payloadSchema) {
      return NextResponse.json(
        { error: `Unknown event type "${evt.type}". Known types: ${Object.keys(EVENT_PAYLOAD_SCHEMAS).join(", ")}` },
        { status: 400 },
      );
    }
    const payloadResult = payloadSchema.safeParse(evt.payload);
    if (!payloadResult.success) {
      return NextResponse.json(
        { error: `Invalid payload for event type "${evt.type}"`, details: payloadResult.error.flatten() },
        { status: 400 },
      );
    }

    const event = await (prisma as any).projectEvent.create({
      data: {
        projectId,
        direction: "out",
        type: evt.type,
        payload: evt.payload,
      },
    });
    created.push(event);
  }

  progressBus.notifyChanged({
    type: "project_event",
    projectId,
  });

  return NextResponse.json({ ok: true, count: created.length });
}

/**
 * GET /api/internal/projects/:id/events
 *
 * RA-089: Runner polls incoming events for agent (direction="in").
 * Query: ?since=ISO_timestamp&type=test_result
 */
export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  if (!isRunnerAuthorized(request, { projectId })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const type = url.searchParams.get("type");

  const where: Record<string, unknown> = {
    projectId,
    direction: "in",
  };
  if (since) {
    where.createdAt = { gt: new Date(since) };
  }
  if (type) {
    const parsedType = WorkspaceEventTypeSchema.safeParse(type);
    if (!parsedType.success) {
      return NextResponse.json({ events: [] });
    }
    where.type = parsedType.data;
  } else {
    where.type = { in: WorkspaceEventTypeSchema.options };
  }

  const events = await (prisma as any).projectEvent.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    events: events.map((e: any) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

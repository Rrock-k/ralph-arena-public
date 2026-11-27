import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { progressBus } from "@/lib/progress-bus";
import { isCommunityQaEnabled } from "@/lib/feature-flags";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { TestResultPayloadSchema } from "@arena/contracts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/projects/:id/events
 *
 * RA-089: UI reads all events (both directions) for a project.
 * Query: ?since=ISO_timestamp&type=test_request
 */
export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  if (!(await isCommunityQaEnabled())) {
    return NextResponse.json({ events: [] });
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const type = url.searchParams.get("type");

  const where: Record<string, unknown> = { projectId };
  if (since) {
    where.createdAt = { gt: new Date(since) };
  }
  if (type) {
    where.type = type;
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

/**
 * POST /api/projects/:id/events
 *
 * RA-089: UI sends test_result (logged-in users only).
 */
export async function POST(request: Request, context: RouteContext) {
  if (!(await isCommunityQaEnabled())) {
    return NextResponse.json({ error: "Feature not enabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await context.params;
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  const body = await request.json();

  // Only test_result allowed from UI
  if (body.type !== "test_result") {
    return NextResponse.json({ error: "Only test_result events can be submitted" }, { status: 400 });
  }

  const payloadResult = TestResultPayloadSchema.safeParse(body.payload);
  if (!payloadResult.success) {
    return NextResponse.json(
      { error: "Invalid test result payload", details: payloadResult.error.flatten() },
      { status: 400 },
    );
  }

  // Verify testRequestEventId exists for this project
  const testRequest = await (prisma as any).projectEvent.findFirst({
    where: {
      id: payloadResult.data.testRequestEventId,
      projectId,
      direction: "out",
      type: "test_request",
    },
  });

  if (!testRequest) {
    return NextResponse.json({ error: "Test request not found" }, { status: 404 });
  }

  const event = await (prisma as any).projectEvent.create({
    data: {
      projectId,
      direction: "in",
      type: "test_result",
      payload: body.payload,
      userId: session.user.id,
    },
  });

  progressBus.notifyChanged({
    type: "project_event",
    projectId,
  });

  return NextResponse.json({
    ok: true,
    id: event.id,
  });
}

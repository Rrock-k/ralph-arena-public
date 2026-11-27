import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { LogsRequestSchema } from "@arena/contracts";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/internal/projects/:id/logs
 *
 * RA-116: Runner pushes log chunks and/or lifecycle events.
 * Stores as JSONL in Project.log (each line: {"ts":...,"text":"..."} or {"ts":...,"lc":"EVENT"}).
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ ok: true }); // truncated/empty body → noop
  }
  const parsed = LogsRequestSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json({ ok: true }); // empty/invalid → noop
  }

  const body = parsed.data;
  const jsonlParts: string[] = [];

  // Convert log chunks to JSONL lines
  if (body.chunks?.length) {
    for (const chunk of body.chunks) {
      jsonlParts.push(JSON.stringify({ ts: chunk.ts, text: chunk.text }));
    }
  }

  // Convert lifecycle events to JSONL lines
  if (body.lifecycle?.length) {
    for (const lc of body.lifecycle) {
      jsonlParts.push(JSON.stringify({ ts: lc.ts, lc: lc.event }));
    }
  }

  if (!jsonlParts.length) {
    return NextResponse.json({ ok: true });
  }

  const jsonl = jsonlParts.join("\n") + "\n";

  await prisma.$executeRawUnsafe(
    `UPDATE "Project" SET
       log = COALESCE(log, '') || $1,
       "updatedAt" = NOW()
     WHERE id = $2`,
    jsonl,
    id,
  );

  progressBus.notifyChanged({
    type: "log_chunk",
    projectId: id,
    text: jsonl,
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { ackProjectUpdateDelivery } from "@/lib/project-update-outbox";

const AckRequestSchema = z.object({
  status: z.enum(["DELIVERED", "FAILED", "SKIPPED"]),
  leaseId: z.string().trim().min(1).max(120),
  consumerId: z.string().trim().min(1).max(120).optional(),
  externalMessageId: z.string().trim().min(1).max(120).optional(),
  error: z.string().trim().min(1).max(500).optional(),
});

type RouteParams = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const parsed = AckRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await ackProjectUpdateDelivery(prisma, {
    id: eventId,
    leaseId: parsed.data.leaseId,
    status: parsed.data.status,
    consumerId: parsed.data.consumerId,
    externalMessageId: parsed.data.externalMessageId,
    error: parsed.data.error,
  });

  if (!updated) {
    return NextResponse.json({ error: "Project update event lease not found" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    status: updated.status,
  });
}

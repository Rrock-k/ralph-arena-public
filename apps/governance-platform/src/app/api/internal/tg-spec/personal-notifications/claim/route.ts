import { NextResponse } from "next/server";
import { z } from "zod";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import {
  claimPersonalProjectNotifications,
  serializePersonalProjectNotification,
} from "@/lib/project-personal-notifications";

const ClaimRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  consumerId: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ClaimRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const notifications = await claimPersonalProjectNotifications(prisma, {
    limit: parsed.data.limit,
    consumerId: parsed.data.consumerId,
  });

  return NextResponse.json({
    notifications: notifications.map(serializePersonalProjectNotification),
  });
}

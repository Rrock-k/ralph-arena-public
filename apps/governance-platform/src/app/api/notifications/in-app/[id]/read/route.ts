/**
 * RA-225: Mark a single in-app notification as read.
 *
 * POST /api/notifications/in-app/:id/read
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const notification = await prisma.inAppNotification.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!notification || notification.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.inAppNotification.update({
    where: { id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}

/**
 * RA-225: Mark all in-app notifications as read.
 *
 * POST /api/notifications/in-app/read-all
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.inAppNotification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}

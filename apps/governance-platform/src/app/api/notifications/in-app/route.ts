/**
 * RA-225: In-app notifications API.
 *
 * GET /api/notifications/in-app — list notifications + unread count
 * Query params: limit (default 30), unreadOnly (default false)
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 100);
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";

  const [notifications, unreadCount] = await Promise.all([
    prisma.inAppNotification.findMany({
      where: {
        userId: session.user.id,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.inAppNotification.count({
      where: { userId: session.user.id, read: false },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

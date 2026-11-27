/**
 * GET /api/notifications/subscribe/status
 * Returns { subscribed: boolean } for the current user's email.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ subscribed: false });
  }

  const sub = await prisma.newsletterSubscriber.findUnique({
    where: { email: session.user.email },
    select: { status: true },
  });

  return NextResponse.json({ subscribed: sub?.status === "ACTIVE" });
}

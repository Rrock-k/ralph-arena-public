/**
 * RA-224: Newsletter subscription endpoint.
 *
 * POST /api/notifications/subscribe
 * Body: { email: string, source?: "landing" | "platform" }
 *
 * - Creates or reactivates a NewsletterSubscriber record
 * - Returns 200 on success (idempotent — re-subscribing is fine)
 * - No auth required (public endpoint for landing page)
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/errors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANDING_SUBSCRIBE_ORIGINS = new Set([
  "https://arena.example.test",
  "https://www.arena.example.test",
]);

function readAllowedLandingOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && LANDING_SUBSCRIBE_ORIGINS.has(origin) ? origin : null;
}

function setLandingCorsHeaders(headers: Headers, request: Request, preflight = false) {
  const origin = readAllowedLandingOrigin(request);
  if (!origin) return;

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");

  if (preflight) {
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
}

function subscribeJson(request: Request, body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  setLandingCorsHeaders(response.headers, request);
  return response;
}

export function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !readAllowedLandingOrigin(request)) {
    return new Response(null, { status: 403 });
  }

  const headers = new Headers();
  setLandingCorsHeaders(headers, request, true);
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request) {
  let body: { email?: string; source?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Auto-detect email from session if not provided (e.g. from settings toggle)
  let email = body.email?.trim().toLowerCase();
  if (!email) {
    const session = await auth();
    email = session?.user?.email?.toLowerCase();
  }

  if (!email || !EMAIL_REGEX.test(email)) {
    return subscribeJson(request, { error: "Valid email is required" }, { status: 400 });
  }

  const source = body.source === "platform" ? "platform" : "landing";

  try {
    // Upsert: create if new, reactivate if previously unsubscribed
    const existing = await prisma.newsletterSubscriber.findUnique({
      where: { email },
    });

    if (existing) {
      if (existing.status === "ACTIVE") {
        // Already subscribed — idempotent success
        return subscribeJson(request, { ok: true, status: "already_subscribed" });
      }

      // Reactivate (was UNSUBSCRIBED, BOUNCED, or COMPLAINED)
      await prisma.newsletterSubscriber.update({
        where: { email },
        data: {
          status: "ACTIVE",
          source,
          unsubscribedAt: null,
        },
      });

      return subscribeJson(request, { ok: true, status: "reactivated" });
    }

    // New subscriber
    await prisma.newsletterSubscriber.create({
      data: { email, source },
    });

    return subscribeJson(request, { ok: true, status: "subscribed" });
  } catch (err) {
    logError("E-NOTIF-004", { email, source }, err);
    return subscribeJson(
      request,
      { error: "Failed to subscribe. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/notifications/subscribe
 * Unsubscribe the current user from newsletter.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.newsletterSubscriber.updateMany({
    where: { email: session.user.email, status: "ACTIVE" },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

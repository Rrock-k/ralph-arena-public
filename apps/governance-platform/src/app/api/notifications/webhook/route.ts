/**
 * RA-224: Resend webhook handler for email analytics.
 *
 * Receives events from Resend: delivered, opened, clicked, bounced, complained.
 * Updates NotificationLog status for correlation.
 * Verifies payload signature via Svix (Resend's webhook infrastructure).
 *
 * Setup:
 * 1. In Resend dashboard → Webhooks → Add endpoint
 * 2. URL: https://arena.example.test/api/notifications/webhook
 * 3. Events: email.delivered, email.opened, email.clicked, email.bounced, email.complained
 * 4. Copy signing secret to RESEND_WEBHOOK_SECRET env var
 */

import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/errors";

// ── Resend webhook event types ──────────────────────────────────

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    // Bounce-specific
    bounce?: {
      message: string;
    };
    // Click-specific
    click?: {
      ipAddress: string;
      link: string;
      timestamp: string;
      userAgent: string;
    };
    // Open-specific
    open?: {
      ipAddress: string;
      timestamp: string;
      userAgent: string;
    };
  };
}

// Map Resend event types to our NotificationLog statuses
const STATUS_MAP: Record<string, string> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.opened": "OPENED",
  "email.clicked": "CLICKED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.delivery_delayed": "SENT", // keep as SENT, not a terminal state
};

export async function POST(request: Request) {
  const body = await request.text();

  // ── Verify signature ────────────────────────────────────────
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      logError("E-NOTIF-003", { reason: "Missing svix headers" });
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    try {
      const wh = new Webhook(secret);
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (err) {
      logError("E-NOTIF-003", {
        reason: "Signature verification failed",
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // ── Parse event ─────────────────────────────────────────────
  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ error: "No email_id" }, { status: 400 });
  }

  const newStatus = STATUS_MAP[event.type];
  if (!newStatus) {
    // Unknown event type — acknowledge but don't process
    return NextResponse.json({ ok: true });
  }

  // ── Update notification log ─────────────────────────────────
  // Find the log entry by resendEmailId, update status if it's a "higher" state
  try {
    const existing = await prisma.notificationLog.findFirst({
      where: { resendEmailId: emailId },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      // Only upgrade status (SENT → DELIVERED → OPENED → CLICKED)
      // Bounced/Complained always overwrite
      const shouldUpdate =
        newStatus === "BOUNCED" ||
        newStatus === "COMPLAINED" ||
        STATUS_PRIORITY[newStatus] > STATUS_PRIORITY[existing.status];

      if (shouldUpdate) {
        await prisma.notificationLog.update({
          where: { id: existing.id },
          data: {
            status: newStatus,
            ...(event.data.bounce
              ? { error: event.data.bounce.message }
              : {}),
            metadata: JSON.stringify({
              ...safeParseJson(existing.metadata),
              [`${event.type}_at`]: event.created_at,
              ...(event.data.click ? { lastClickedLink: event.data.click.link } : {}),
              ...(event.data.open ? { lastOpenedAt: event.data.open.timestamp } : {}),
            }),
          },
        });
      }
    }

    // Handle bounced emails — mark newsletter subscriber if applicable
    if (newStatus === "BOUNCED" && event.data.to?.[0]) {
      await prisma.newsletterSubscriber.updateMany({
        where: { email: event.data.to[0], status: "ACTIVE" },
        data: { status: "BOUNCED" },
      });
    }

    // Handle complaints — auto-unsubscribe
    if (newStatus === "COMPLAINED" && event.data.to?.[0]) {
      await prisma.newsletterSubscriber.updateMany({
        where: { email: event.data.to[0], status: "ACTIVE" },
        data: { status: "COMPLAINED", unsubscribedAt: new Date() },
      });
    }
  } catch (err) {
    console.error("[notifications:webhook] Error processing event:", err);
    // Return 200 anyway to prevent retries for transient DB errors
  }

  return NextResponse.json({ ok: true });
}

// ── Helpers ─────────────────────────────────────────────────────

const STATUS_PRIORITY: Record<string, number> = {
  SKIPPED: 0,
  FAILED: 0,
  SENT: 1,
  DELIVERED: 2,
  OPENED: 3,
  CLICKED: 4,
  BOUNCED: 5,
  COMPLAINED: 5,
};

function safeParseJson(str: string | null): Record<string, unknown> {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

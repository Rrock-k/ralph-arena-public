/**
 * RA-224: Unsubscribe endpoint.
 *
 * Supports two flows:
 *
 * 1. RFC 8058 one-click: email client sends POST with body "List-Unsubscribe=One-Click"
 *    → Returns 200 with blank body. No cookies, no auth, no redirects.
 *
 * 2. Browser click: user clicks unsubscribe link in email footer
 *    → GET returns a simple confirmation page, then POST from the page does the actual unsub.
 *
 * Query params: unsubscribeToken
 * For newsletter: token (unsubscribeToken from NewsletterSubscriber)
 */

import { prisma } from "@/lib/prisma";
import { EVENT_LABELS, NOTIFICATION_PREFERENCE_GLOBAL_SCOPE } from "@/lib/notifications/types";
import { verifyTransactionalUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

// ── POST: one-click unsubscribe (RFC 8058) ──────────────────────

export async function POST(request: Request) {
  const url = new URL(request.url);

  // Newsletter unsubscribe by token
  const token = url.searchParams.get("token");
  if (token) {
    return handleNewsletterUnsubscribe(token);
  }

  const transactionalToken = verifyTransactionalUnsubscribeToken(url.searchParams.get("unsubscribeToken"));
  if (!transactionalToken.ok) {
    return new Response("", { status: 400 });
  }

  await prisma.notificationPreference.upsert({
    where: {
      userId_eventType_channel_scopeType_scopeId: {
        userId: transactionalToken.userId,
        eventType: transactionalToken.eventType,
        channel: transactionalToken.channel,
        ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      },
    },
    create: {
      userId: transactionalToken.userId,
      eventType: transactionalToken.eventType,
      channel: transactionalToken.channel,
      ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      enabled: false,
    },
    update: { enabled: false },
  });

  // RFC 8058: return 200 with blank body
  return new Response("", { status: 200 });
}

// ── GET: browser confirmation page ──────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Newsletter unsubscribe by token
  const token = url.searchParams.get("token");
  if (token) {
    const sub = await prisma.newsletterSubscriber.findUnique({
      where: { unsubscribeToken: token },
      select: { email: true, status: true },
    });

    if (!sub) {
      return new Response(renderPage("Not Found", "This unsubscribe link is invalid or expired."), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (sub.status === "UNSUBSCRIBED") {
      return new Response(renderPage("Already Unsubscribed", `${sub.email} has already been unsubscribed.`), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Auto-unsubscribe on page visit for newsletter (simpler UX)
    await prisma.newsletterSubscriber.update({
      where: { unsubscribeToken: token },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    });

    return new Response(
      renderPage("Unsubscribed", `${sub.email} has been removed from our mailing list.`),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const transactionalToken = verifyTransactionalUnsubscribeToken(url.searchParams.get("unsubscribeToken"));
  if (!transactionalToken.ok) {
    const message = transactionalToken.error === "expired"
      ? "This unsubscribe link has expired."
      : "Invalid unsubscribe link.";
    return new Response(renderPage("Error", message), {
      status: transactionalToken.error === "expired" ? 410 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Check if already unsubscribed
  const pref = await prisma.notificationPreference.findUnique({
    where: {
      userId_eventType_channel_scopeType_scopeId: {
        userId: transactionalToken.userId,
        eventType: transactionalToken.eventType,
        channel: transactionalToken.channel,
        ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      },
    },
  });

  if (pref && !pref.enabled) {
    const label = EVENT_LABELS[transactionalToken.eventType] || transactionalToken.eventType;
    return new Response(
      renderPage("Already Unsubscribed", `You are already unsubscribed from "${label}" notifications.`),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Do the unsubscribe
  await prisma.notificationPreference.upsert({
    where: {
      userId_eventType_channel_scopeType_scopeId: {
        userId: transactionalToken.userId,
        eventType: transactionalToken.eventType,
        channel: transactionalToken.channel,
        ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      },
    },
    create: {
      userId: transactionalToken.userId,
      eventType: transactionalToken.eventType,
      channel: transactionalToken.channel,
      ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      enabled: false,
    },
    update: { enabled: false },
  });

  const label = EVENT_LABELS[transactionalToken.eventType] || transactionalToken.eventType;
  return new Response(
    renderPage("Unsubscribed", `You have been unsubscribed from "${label}" notifications.`),
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// ── Newsletter helper ───────────────────────────────────────────

async function handleNewsletterUnsubscribe(token: string) {
  const sub = await prisma.newsletterSubscriber.findUnique({
    where: { unsubscribeToken: token },
  });

  if (!sub) {
    return new Response("", { status: 404 });
  }

  if (sub.status !== "UNSUBSCRIBED") {
    await prisma.newsletterSubscriber.update({
      where: { unsubscribeToken: token },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
    });
  }

  return new Response("", { status: 200 });
}

// ── HTML renderer ───────────────────────────────────────────────

function renderPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Ralph Arena</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0b0f19;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e2e8f0;
    }
    .card {
      max-width: 420px;
      text-align: center;
      padding: 48px 32px;
      background: #131827;
      border: 1px solid #1e293b;
      border-radius: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px;
    }
    p {
      font-size: 15px;
      color: #94a3b8;
      line-height: 1.6;
      margin: 0 0 24px;
    }
    a {
      color: #38bdf8;
      text-decoration: none;
      font-size: 14px;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${process.env.NEXTAUTH_URL || "https://arena.example.test"}">Back to Ralph Arena</a>
  </div>
</body>
</html>`;
}

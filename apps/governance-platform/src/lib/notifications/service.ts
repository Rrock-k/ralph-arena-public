/**
 * RA-224: Core notification dispatch service.
 *
 * Single entry point: `notify(event)`.
 * Flow: feature flag → resolve recipient → check preferences → send via channels → log.
 *
 * All calls are fire-and-forget from the caller's perspective:
 *   notify(event).catch(console.error)
 *
 * Notifications are always dispatched AFTER the DB transaction commits
 * to avoid sending for rolled-back state changes.
 */

import { prisma } from "@/lib/prisma";
import { isNotificationsEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/errors";
import { resolveRecipient } from "./recipients";
import { emailChannel } from "./channels/email";
import { inAppChannel } from "./channels/in-app";
import { NOTIFICATION_PREFERENCE_GLOBAL_SCOPE } from "./types";
import type {
  NotificationEvent,
  NotificationChannel,
  NotificationRecipient,
  ChannelSender,
} from "./types";
import { createTransactionalUnsubscribeToken } from "./unsubscribe-token";

// ── Channel registry ────────────────────────────────────────────
// Add new channels here as they become available (telegram, push, etc.)
const channels: ChannelSender[] = [emailChannel, inAppChannel];

// ── Public API ──────────────────────────────────────────────────

/**
 * Dispatch a notification for the given event.
 * Checks feature flag, resolves recipient, respects preferences, sends, logs.
 */
export async function notify(event: NotificationEvent): Promise<void> {
  // 1. Global kill switch
  const enabled = await isNotificationsEnabled();
  if (!enabled) return;

  // 2. Resolve who should receive this
  const recipient = await resolveRecipient(event);
  if (!recipient) {
    logError("E-NOTIF-002", { eventType: event.type, event });
    return;
  }

  // 3. Send via each registered channel
  for (const channel of channels) {
    await dispatchToChannel(channel, recipient, event);
  }
}

// ── Internal ────────────────────────────────────────────────────

async function dispatchToChannel(
  channel: ChannelSender,
  recipient: NotificationRecipient,
  event: NotificationEvent,
): Promise<void> {
  const { userId, email } = recipient;

  // Check per-user opt-out
  const pref = await prisma.notificationPreference.findUnique({
    where: {
      userId_eventType_channel_scopeType_scopeId: {
        userId,
        eventType: event.type,
        channel: channel.channel,
        ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      },
    },
  });

  if (pref && !pref.enabled) {
    await writeLog(userId, event, channel.channel, email, "SKIPPED");
    return;
  }

  const unsubscribeUrl = buildUnsubscribeUrl(userId, event.type, channel.channel);

  try {
    const result = await channel.send(recipient, event, { unsubscribeUrl });

    await writeLog(
      userId,
      event,
      channel.channel,
      email,
      "SENT",
      undefined,
      result.externalId,
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError("E-NOTIF-001", {
      channel: channel.channel,
      email,
      eventType: event.type,
      error: errorMsg,
    });

    await writeLog(userId, event, channel.channel, email, "FAILED", errorMsg);
  }
}

function buildUnsubscribeUrl(
  userId: string,
  eventType: NotificationEvent["type"],
  channel: NotificationChannel,
): string {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const unsubscribeToken = createTransactionalUnsubscribeToken({
    userId,
    eventType,
    channel,
  });
  const params = new URLSearchParams({ unsubscribeToken });
  return `${base}/api/notifications/unsubscribe?${params}`;
}

async function writeLog(
  userId: string,
  event: NotificationEvent,
  channel: NotificationChannel,
  recipientEmail: string,
  status: string,
  error?: string,
  resendEmailId?: string,
): Promise<void> {
  try {
    await prisma.notificationLog.create({
      data: {
        userId,
        eventType: event.type,
        channel,
        recipientEmail,
        status,
        resendEmailId,
        error,
        projectId: "projectId" in event ? event.projectId : undefined,
        metadata: JSON.stringify({
          ...(event.type === "proposal.approved"
            ? { proposalId: event.proposalId, proposalTitle: event.proposalTitle }
            : {}),
          ...(event.type === "project.deployed" && "previewUrl" in event
            ? { previewUrl: event.previewUrl }
            : {}),
        }),
      },
    });
  } catch (logErr) {
    // Don't let log failure propagate — the notification itself succeeded
    console.error("[notifications] Failed to write log:", logErr);
  }
}

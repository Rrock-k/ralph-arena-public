/**
 * RA-225: In-app notification channel.
 *
 * Writes to InAppNotification table instead of sending externally.
 * Bell icon + dropdown reads from this table.
 */

import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import type {
  ChannelSender,
  ChannelSendResult,
  NotificationEvent,
  NotificationRecipient,
} from "../types";

const STICKY_PROJECT_EVENTS = new Set<NotificationEvent["type"]>([
  "project.deployed",
  "project.failed",
  "project.paused_budget",
]);

function buildNotificationContent(event: NotificationEvent): {
  title: string;
  body: string;
  link: string | null;
} {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

  switch (event.type) {
    case "project.deployed":
      return {
        title: "Project deployed",
        body: `${event.projectName} is live!`,
        link: `${base}/projects/${event.projectId}`,
      };
    case "project.failed":
      return {
        title: "Build failed",
        body: `${event.projectName} encountered an error.`,
        link: `${base}/projects/${event.projectId}`,
      };
    case "project.paused_budget":
      return {
        title: "Budget exhausted",
        body: `${event.projectName} has been paused.`,
        link: `${base}/projects/${event.projectId}`,
      };
    case "proposal.approved":
      return {
        title: "Proposal approved!",
        body: `"${event.proposalTitle}" is now being built.`,
        link: `${base}/proposals/${event.proposalId}`,
      };
  }
}

export const inAppChannel: ChannelSender = {
  channel: "in_app",

  async send(
    recipient: NotificationRecipient,
    event: NotificationEvent,
  ): Promise<ChannelSendResult> {
    const { title, body, link } = buildNotificationContent(event);
    const stickyProjectId = "projectId" in event && STICKY_PROJECT_EVENTS.has(event.type)
      ? event.projectId
      : null;

    if (stickyProjectId) {
      const existingUnread = await prisma.inAppNotification.findFirst({
        where: {
          userId: recipient.userId,
          eventType: event.type,
          projectId: stickyProjectId,
          read: false,
        },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });

      if (existingUnread) {
        return { externalId: existingUnread.id };
      }
    }

    const notification = await prisma.inAppNotification.create({
      data: {
        userId: recipient.userId,
        eventType: event.type,
        title,
        body,
        link,
        projectId: "projectId" in event ? event.projectId : undefined,
      },
    });

    // Notify SSE clients so the bell updates in real-time
    progressBus.notifyChanged({
      type: "in_app_notification",
    });

    return { externalId: notification.id };
  },
};

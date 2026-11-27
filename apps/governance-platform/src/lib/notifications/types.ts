/**
 * RA-224: Notification system types.
 *
 * Channel-agnostic event model. Each event carries the context
 * needed to render a notification — recipients are resolved separately.
 */

// ── Event types ─────────────────────────────────────────────────

export const NOTIFICATION_EVENTS = [
  "project.deployed",
  "project.failed",
  "project.paused_budget",
  "proposal.approved",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENTS)[number];

export type NotificationEvent =
  | {
      type: "project.deployed";
      projectId: string;
      projectName: string;
      previewUrl?: string;
    }
  | {
      type: "project.failed";
      projectId: string;
      projectName: string;
      error?: string;
    }
  | {
      type: "project.paused_budget";
      projectId: string;
      projectName: string;
    }
  | {
      type: "proposal.approved";
      proposalId: string;
      proposalTitle: string;
    };

// ── Channel abstraction ─────────────────────────────────────────

export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const; // future: "telegram", "push"

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_PREFERENCE_GLOBAL_SCOPE = {
  scopeType: "global",
  scopeId: "global",
} as const;

export interface ChannelSendResult {
  /** Provider-specific message ID (e.g. Resend email ID) */
  externalId?: string;
}

export interface ChannelSender {
  channel: NotificationChannel;
  send(
    recipient: NotificationRecipient,
    event: NotificationEvent,
    opts: { unsubscribeUrl: string },
  ): Promise<ChannelSendResult>;
}

// ── Recipient ───────────────────────────────────────────────────

export interface NotificationRecipient {
  userId: string;
  email: string;
}

// ── Human-readable labels for admin UI / emails ─────────────────

export const EVENT_LABELS: Record<NotificationEventType, string> = {
  "project.deployed": "Project Deployed",
  "project.failed": "Project Failed",
  "project.paused_budget": "Budget Exhausted",
  "proposal.approved": "Proposal Approved",
};

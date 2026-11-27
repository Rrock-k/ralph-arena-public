/**
 * RA-224: Email channel — sends via Resend with React Email templates.
 *
 * Features:
 * - RFC 8058 one-click unsubscribe headers (List-Unsubscribe + List-Unsubscribe-Post)
 * - Open/click tracking (enabled at domain level in Resend dashboard)
 * - Idempotency via Resend's built-in support
 * - Graceful degradation: no RESEND_API_KEY → console.log (dev mode)
 */

import { Resend } from "resend";
import type { ChannelSender, ChannelSendResult, NotificationEvent, NotificationRecipient } from "../types";
import { renderEmail } from "../templates";

// Singleton — reuse across requests
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM =
  process.env.RESEND_FROM_EMAIL || "Arena <noreply@mail.arena.example.test>";

export const emailChannel: ChannelSender = {
  channel: "email",

  async send(
    recipient: NotificationRecipient,
    event: NotificationEvent,
    opts: { unsubscribeUrl: string },
  ): Promise<ChannelSendResult> {
    const { subject, react } = renderEmail(event, opts.unsubscribeUrl);

    // Dev mode — no API key, just log
    if (!resend) {
      console.log(
        `[notifications:email] DEV — would send "${subject}" to ${recipient.email}`,
      );
      return { externalId: `dev-${Date.now()}` };
    }

    const { data, error } = await resend.emails.send({
      from: FROM,
      to: recipient.email,
      subject,
      react,
      headers: {
        // RFC 8058: one-click unsubscribe
        "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "event_type", value: event.type },
        ...("projectId" in event
          ? [{ name: "project_id", value: event.projectId }]
          : []),
        ...("proposalId" in event
          ? [{ name: "proposal_id", value: event.proposalId }]
          : []),
      ],
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    return { externalId: data?.id };
  },
};

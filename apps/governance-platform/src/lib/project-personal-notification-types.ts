import type { ProjectUpdateEventType } from "@/lib/project-update-outbox";

export { isRawTelegramUserId } from "@/lib/telegram-account-identity";

export const PROJECT_PERSONAL_NOTIFICATION_CHANNEL = "telegram_private";

export const PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES = [
  "required_secret.missing",
  "work.completed",
  "work.failed",
  "work.needs_evidence",
] as const satisfies readonly ProjectUpdateEventType[];

export type ProjectPersonalNotificationEventType =
  (typeof PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES)[number];

export const PROJECT_PERSONAL_NOTIFICATION_EVENT_LABELS:
  Record<ProjectPersonalNotificationEventType, string> = {
    "required_secret.missing": "Missing secrets",
    "work.completed": "Work completed",
    "work.failed": "Work failed",
    "work.needs_evidence": "Evidence needed",
  };

export const PROJECT_PERSONAL_NOTIFICATION_EVENT_DESCRIPTIONS:
  Record<ProjectPersonalNotificationEventType, string> = {
    "required_secret.missing": "A project needs a manager to provide secrets.",
    "work.completed": "An agent finished a project work cycle.",
    "work.failed": "An agent work cycle failed and needs attention.",
    "work.needs_evidence": "An agent needs user or production evidence before it can continue.",
  };

/**
 * RA-224: Notification system — public API.
 *
 * Usage:
 *   import { notify } from "@/lib/notifications";
 *   notify({ type: "project.deployed", projectId, projectName }).catch(console.error);
 */

export { notify } from "./service";
export type {
  NotificationEvent,
  NotificationEventType,
  NotificationChannel,
} from "./types";
export { NOTIFICATION_EVENTS, EVENT_LABELS } from "./types";

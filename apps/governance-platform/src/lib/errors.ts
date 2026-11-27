/**
 * Centralized error codes for the governance platform.
 *
 * Convention:
 *   E{domain}{number}
 *   - domain: AUTH, VOTE, SEASON, PROJ, RUN
 *   - number: 3 digits, sequential within domain
 *
 * The user sees only "Something went wrong (E-VOTE-001)".
 * The full description is logged server-side and listed here for debugging.
 */

export const ErrorCodes = {
  // ── Auth ──────────────────────────────────────────
  "E-AUTH-001": "Not authenticated",
  "E-AUTH-002": "Admin access required",
  "E-AUTH-003": "Session user not found in database (stale JWT — re-login required)",

  // ── Vote ──────────────────────────────────────────
  "E-VOTE-001": "Proposal not found",
  "E-VOTE-002": "Voting closed: project is already live",
  "E-VOTE-003": "Voting closed: season is not active",
  "E-VOTE-004": "Voting closed: season is in build phase",
  "E-VOTE-005": "Database error during vote toggle",

  // ── Season ────────────────────────────────────────
  "E-SEASON-001": "Season not found",
  "E-SEASON-002": "Invalid status transition",
  "E-SEASON-003": "Only DRAFT seasons can be deleted",
  "E-SEASON-004": "Cannot delete season with proposals",
  "E-SEASON-005": "Failed to create/update season",

  // ── Project ───────────────────────────────────────
  "E-PROJ-001": "Project not found",
  "E-PROJ-002": "Failed to launch project",

  // ── Proposal ──────────────────────────────────────
  "E-PROP-001": "Title is required",
  "E-PROP-002": "Failed to create proposal",
  "E-PROP-003": "Proposal not found",
  "E-PROP-004": "Invalid proposal status",
  "E-PROP-005": "Failed to update proposal",
  "E-PROP-006": "Referenced season not found",

  // ── Credits ────────────────────────────────────────
  "E-CRED-001": "Credit plan not found",
  "E-CRED-002": "Duplicate purchase (already granted)",
  "E-CRED-003": "User not found",

  // ── Notifications (RA-224) ────────────────────────
  "E-NOTIF-001": "Failed to send notification email",
  "E-NOTIF-002": "Notification recipient not found or has no email",
  "E-NOTIF-003": "Resend webhook verification failed",
  "E-NOTIF-004": "Newsletter subscription failed",
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/** Build user-facing error message: "Something went wrong (E-VOTE-001)" */
export function userError(code: ErrorCode): string {
  return `Something went wrong (${code})`;
}

/** Log detailed error to server console */
export function logError(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown) {
  const desc = ErrorCodes[code];
  console.error(`[${code}] ${desc}`, context ?? "", cause ?? "");
}

/** Convenience: log + return { success: false, error: userError(code) } */
export function fail(code: ErrorCode, context?: Record<string, unknown>, cause?: unknown) {
  logError(code, context, cause);
  return { success: false as const, error: userError(code) };
}

/** Shared constants for OG image generation */

export const OG_SIZE = { width: 1200, height: 630 };

export function getStatusColor(status: string): string {
  if (status === "DEPLOYED") return "#34d399"; // emerald
  if (status === "RUNNING" || status === "BUILDING") return "#fbbf24"; // amber
  if (status === "FAILED") return "#fb7185"; // rose
  if (status === "PAUSED") return "#fb923c"; // orange
  if (status === "PROPOSED" || status === "APPROVED" || status === "WINNER") return "#22d3ee"; // cyan
  if (status === "QUEUED" || status === "PROVISIONING" || status === "STARTING") return "#60a5fa"; // blue
  return "#94a3b8"; // slate
}

export function getStatusLabel(status: string): string {
  if (status === "DEPLOYED") return "DEPLOYED";
  if (status === "RUNNING" || status === "BUILDING") return "BUILDING";
  if (status === "FAILED") return "FAILED";
  if (status === "PAUSED") return "PAUSED";
  if (status === "PROPOSED" || status === "APPROVED" || status === "WINNER") return status;
  if (status === "QUEUED" || status === "PROVISIONING" || status === "STARTING") return "STARTING";
  if (status === "CANCELED") return "CANCELED";
  if (status === "ARCHIVED") return "ARCHIVED";
  return status;
}

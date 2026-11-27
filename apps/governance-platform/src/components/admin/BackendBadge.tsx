"use client";

/**
 * RA-037: Badge showing runner backend type (local Docker vs VPS).
 * Extracted from storybook drafts (VpsDrafts.stories.tsx).
 */

const STYLES = {
  local: { border: "border-gray-200 dark:border-slate-700", bg: "bg-gray-50 dark:bg-slate-800", text: "text-gray-600 dark:text-slate-300" },
  vps: { border: "border-violet-200 dark:border-violet-500/30", bg: "bg-violet-50 dark:bg-violet-500/10", text: "text-violet-600 dark:text-violet-300" },
} as const;

const ICONS = {
  local: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
    </svg>
  ),
  vps: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
  ),
} as const;

type Backend = "local" | "vps";

function normalize(value: string | null | undefined): Backend {
  return value === "vps" ? "vps" : "local";
}

/** Full badge: icon + text label. */
export function BackendBadge({ backend }: { backend: string | null | undefined }) {
  const b = normalize(backend);
  const s = STYLES[b];
  return (
    <span className={`mono inline-flex items-center gap-1 rounded-full border ${s.border} ${s.bg} px-2 py-0.5 text-[11px] font-semibold ${s.text}`}>
      {ICONS[b]}
      {b}
    </span>
  );
}

/** Compact badge: icon only + tooltip. For tight table layouts. */
export function BackendBadgeCompact({ backend }: { backend: string | null | undefined }) {
  const b = normalize(backend);
  const s = STYLES[b];
  return (
    <span
      title={b === "vps" ? "VPS (remote)" : "Local Docker"}
      className={`inline-flex items-center justify-center rounded-full border ${s.border} ${s.bg} ${s.text} h-5 w-5 cursor-default`}
    >
      {ICONS[b]}
    </span>
  );
}

function normalizeRetryAt(retryAt: string | Date | null | undefined): Date | null {
  if (!retryAt) return null;
  const date = retryAt instanceof Date ? retryAt : new Date(retryAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date: Date, mode: "local" | "utc"): string {
  const year = mode === "utc" ? date.getUTCFullYear() : date.getFullYear();
  const month = mode === "utc" ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = mode === "utc" ? date.getUTCDate() : date.getDate();
  const hour = mode === "utc" ? date.getUTCHours() : date.getHours();
  const minute = mode === "utc" ? date.getUTCMinutes() : date.getMinutes();
  const second = mode === "utc" ? date.getUTCSeconds() : date.getSeconds();

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(day)}/${pad(month)}/${year}, ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export type RetryHint = {
  label: string;
  utcTooltip: string;
};

export function getRetryHint(retryAt: string | Date | null | undefined): RetryHint | null {
  const normalized = normalizeRetryAt(retryAt);
  if (!normalized) return null;

  return {
    label: `Next auto-retry: ${formatDateTime(normalized, "local")}`,
    utcTooltip: `UTC: ${formatDateTime(normalized, "utc")} UTC`,
  };
}

export function formatRetryHint(retryAt: string | Date | null | undefined): string | null {
  return getRetryHint(retryAt)?.label ?? null;
}

export function formatRetryHintTooltip(retryAt: string | Date | null | undefined): string | null {
  return getRetryHint(retryAt)?.utcTooltip ?? null;
}

export type RetryableBlocker = "RATE_LIMIT" | "INFRA" | "API";

const MAX_RETRIES: Record<RetryableBlocker, number> = {
  RATE_LIMIT: 4,
  INFRA: 5,
  API: 10,
};

const BACKOFF_MINUTES: Record<RetryableBlocker, number[]> = {
  RATE_LIMIT: [5, 15, 30, 60],
  INFRA: [2, 5, 10, 20, 40],
  API: [1, 2, 3, 5, 5, 10, 10, 15, 15, 30],
};

export function isRetryableBlocker(blocker: string): blocker is RetryableBlocker {
  return blocker === "RATE_LIMIT" || blocker === "INFRA" || blocker === "API";
}

export function getRetryableBlocker(blockers: string[]): RetryableBlocker | null {
  for (const blocker of blockers) {
    if (isRetryableBlocker(blocker)) return blocker;
  }
  return null;
}

export function getMaxRetries(blocker: RetryableBlocker): number {
  return MAX_RETRIES[blocker];
}

export function getRetryBackoffMs(blocker: RetryableBlocker, retryCount: number): number {
  const schedule = BACKOFF_MINUTES[blocker];
  const minutes = schedule[Math.min(Math.max(retryCount, 0), schedule.length - 1)];
  return minutes * 60_000;
}

export function computeRetryAt(
  blocker: RetryableBlocker,
  retryCount: number,
  now = new Date(),
): Date {
  return new Date(now.getTime() + getRetryBackoffMs(blocker, retryCount));
}

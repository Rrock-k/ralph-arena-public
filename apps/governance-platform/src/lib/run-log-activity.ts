export type RunLogActivityInput = {
  id: string;
  event: string;
  detail?: string | null;
  createdAt: string | Date;
};

export type RunLogActivityEntry = {
  id: string;
  event: string;
  createdAt: string | Date;
  error: string | null;
};

export type RunLogActivityGroup = {
  id: string;
  event: string;
  count: number;
  latestAt: string | Date;
  oldestAt: string | Date;
  error: string | null;
  entries: RunLogActivityEntry[];
};

export type RunLogActivity = {
  groups: RunLogActivityGroup[];
  fetchedEventCount: number;
  visibleEventCount: number;
  visibleGroupCount: number;
  windowLimit: number | null;
  hasMore: boolean;
};

export function buildRunLogActivity(
  logs: RunLogActivityInput[],
  options: {
    maxGroups?: number;
    windowLimit?: number | null;
    hasMore?: boolean;
  } = {},
): RunLogActivity {
  const maxGroups = Math.max(1, options.maxGroups ?? 10);
  const groups: RunLogActivityGroup[] = [];
  let consumedCount = 0;

  for (const log of logs) {
    const entry = normalizeRunLogEntry(log);
    const previous = groups[groups.length - 1];
    if (previous?.event === entry.event) {
      previous.count += 1;
      previous.oldestAt = entry.createdAt;
      previous.error ??= entry.error;
      previous.entries.push(entry);
      consumedCount += 1;
      continue;
    }

    if (groups.length >= maxGroups) break;

    groups.push({
      id: entry.id,
      event: entry.event,
      count: 1,
      latestAt: entry.createdAt,
      oldestAt: entry.createdAt,
      error: entry.error,
      entries: [entry],
    });
    consumedCount += 1;
  }

  return {
    groups,
    fetchedEventCount: logs.length,
    visibleEventCount: consumedCount,
    visibleGroupCount: groups.length,
    windowLimit: options.windowLimit ?? null,
    hasMore: Boolean(options.hasMore) || consumedCount < logs.length,
  };
}

export function formatRunLogGroupTitle(group: RunLogActivityGroup): string | undefined {
  if (group.count <= 1) return undefined;
  return `${new Date(group.oldestAt).toLocaleString()} - ${new Date(group.latestAt).toLocaleString()}`;
}

function normalizeRunLogEntry(log: RunLogActivityInput): RunLogActivityEntry {
  return {
    id: log.id,
    event: log.event,
    createdAt: log.createdAt,
    error: parseRunLogError(log.detail),
  };
}

function parseRunLogError(detail: string | null | undefined): string | null {
  if (!detail) return null;

  try {
    const parsed = JSON.parse(detail) as { error?: unknown };
    return typeof parsed.error === "string" && parsed.error.trim()
      ? parsed.error
      : null;
  } catch {
    return null;
  }
}

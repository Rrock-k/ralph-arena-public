import "server-only";

import { prisma } from "@/lib/prisma";
import { buildRunLogActivity, type RunLogActivity } from "@/lib/run-log-activity";

const DEFAULT_RUN_LOG_ACTIVITY_WINDOW = 160;
const MAX_RUN_LOG_ACTIVITY_WINDOW = 500;
const DEFAULT_RUN_LOG_ACTIVITY_GROUPS = 12;
const MAX_RUN_LOG_ACTIVITY_GROUPS = 80;

const RUN_LOG_SELECT = {
  id: true,
  event: true,
  detail: true,
  createdAt: true,
} as const;

export async function getProjectRunLogActivity(
  projectId: string,
  options: {
    windowLimit?: number;
    maxGroups?: number;
  } = {},
): Promise<RunLogActivity | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return null;

  const windowLimit = clampPositiveInteger(
    options.windowLimit,
    DEFAULT_RUN_LOG_ACTIVITY_WINDOW,
    MAX_RUN_LOG_ACTIVITY_WINDOW,
  );
  const maxGroups = clampPositiveInteger(
    options.maxGroups,
    DEFAULT_RUN_LOG_ACTIVITY_GROUPS,
    MAX_RUN_LOG_ACTIVITY_GROUPS,
  );
  const logs = await prisma.runLog.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: windowLimit + 1,
    select: RUN_LOG_SELECT,
  });

  return buildRunLogActivity(logs.slice(0, windowLimit), {
    maxGroups,
    windowLimit,
    hasMore: logs.length > windowLimit,
  });
}

export function parseRunLogActivityLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampPositiveInteger(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

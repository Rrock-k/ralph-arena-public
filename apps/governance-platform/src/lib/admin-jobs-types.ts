export type AdminJobLane = "cron" | "maintenance";

export type AdminJobStatus =
  | "scheduled"
  | "manual"
  | "disabled"
  | "unwired"
  | "unknown";

export type AdminJobScheduleOwner =
  | "code"
  | "db"
  | "external"
  | "manual"
  | "disabled";

export type AdminJobRunStatus =
  | "succeeded"
  | "failed"
  | "running"
  | "unknown";

export interface AdminJobRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  actor: string;
  status: AdminJobRunStatus;
  durationMs: number | null;
  summary: string;
  details: unknown;
}

export interface AdminJobItem {
  id: string;
  lane: AdminJobLane;
  status: AdminJobStatus;
  name: string;
  description: string | null;
  type: string;
  owner: string;
  schedule: string;
  scheduleOwner: AdminJobScheduleOwner;
  lastRun: AdminJobRun | null;
  runs: AdminJobRun[];
  executor: {
    type: string;
    target: string;
    legacyCronJobId?: string | null;
    canRunNow: boolean;
  };
  rawConfig: unknown;
}

export interface AdminJobsData {
  cron: AdminJobItem[];
  maintenance: AdminJobItem[];
}

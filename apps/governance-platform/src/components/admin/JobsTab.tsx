"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { runMaintenanceJobNow } from "@/app/actions/maintenance-jobs";
import type {
  AdminJobItem,
  AdminJobsData,
  AdminJobLane,
  AdminJobRunStatus,
  AdminJobStatus,
} from "@/lib/admin-jobs-types";

const LANES: { id: AdminJobLane; label: string }[] = [
  { id: "cron", label: "Cron" },
  { id: "maintenance", label: "Maintenance" },
];

const JOB_STATUS_COPY: Record<AdminJobStatus, string> = {
  scheduled: "Scheduled",
  manual: "Manual",
  disabled: "Disabled",
  unwired: "Unwired",
  unknown: "Unknown",
};

const RUN_STATUS_COPY: Record<AdminJobRunStatus, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  unknown: "Unknown",
};

export function JobsTab({ jobs: initialJobs }: { jobs: AdminJobsData }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [lane, setLane] = useState<AdminJobLane>("cron");
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialJobs.cron[0]?.id ?? initialJobs.maintenance[0]?.id ?? null,
  );

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  const visibleJobs = jobs[lane];
  const selectedJob = useMemo(() => {
    return (
      visibleJobs.find((job) => job.id === selectedId) ??
      visibleJobs[0] ??
      null
    );
  }, [selectedId, visibleJobs]);

  useEffect(() => {
    if (selectedJob) {
      setSelectedId(selectedJob.id);
      return;
    }
    setSelectedId(visibleJobs[0]?.id ?? null);
  }, [selectedJob, visibleJobs]);

  const refreshJobs = async () => {
    const response = await fetch("/api/admin/ops-data?tab=jobs", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Jobs refresh failed with HTTP ${response.status}`);
    }
    setJobs(await response.json());
  };

  const runJob = (job: AdminJobItem) => {
    setPendingJobId(job.id);
    startTransition(async () => {
      try {
        const result = await runMaintenanceJobNow(job.id);
        await refreshJobs();
        if (result.success) {
          toast.success(result.summary || `${job.name} completed`);
        } else {
          toast.error(result.error ?? `${job.name} failed`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `${job.name} failed`);
      } finally {
        setPendingJobId(null);
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Jobs
          </h2>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-500">
            {visibleJobs.length} {lane === "cron" ? "cron" : "maintenance"} rows
          </div>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-gray-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-950">
          {LANES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLane(item.id)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                lane === item.id
                  ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-950"
                  : "text-gray-600 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full border-collapse text-left text-xs">
              <thead className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-normal text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
                <tr>
                  <th className="w-[96px] px-3 py-2 font-medium">Status</th>
                  <th className="min-w-[180px] px-3 py-2 font-medium">Name</th>
                  <th className="w-[120px] px-3 py-2 font-medium">Type</th>
                  <th className="w-[150px] px-3 py-2 font-medium">Owner</th>
                  <th className="w-[130px] px-3 py-2 font-medium">Schedule owner</th>
                  <th className="w-[150px] px-3 py-2 font-medium">Schedule</th>
                  <th className="w-[130px] px-3 py-2 font-medium">Last recorded</th>
                  <th className="min-w-[180px] px-3 py-2 font-medium">Result</th>
                  <th className="w-[96px] px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`border-b border-gray-100 transition-colors last:border-b-0 dark:border-slate-900 ${
                      selectedJob?.id === job.id
                        ? "bg-emerald-50/70 dark:bg-emerald-500/10"
                        : "hover:bg-gray-50 dark:hover:bg-slate-900/70"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(job.id)}
                        className="block max-w-[260px] truncate font-mono text-[12px] font-medium text-gray-900 hover:text-emerald-700 dark:text-slate-100 dark:hover:text-emerald-300"
                        title={job.name}
                      >
                        {job.name}
                      </button>
                      {job.description && (
                        <div className="mt-0.5 max-w-[300px] truncate text-[11px] text-gray-500 dark:text-slate-500">
                          {job.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      {job.type}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      {job.owner}
                    </td>
                    <td className="px-3 py-2">
                      <ScheduleOwnerPill owner={job.scheduleOwner} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-gray-700 dark:text-slate-300">
                        {job.schedule}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      {job.lastRun
                        ? formatAge(job.lastRun.finishedAt ?? job.lastRun.startedAt)
                        : "Never recorded"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[260px] truncate text-gray-700 dark:text-slate-300">
                        {job.lastRun?.summary ?? "Not instrumented"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {job.executor.canRunNow ? (
                        <button
                          type="button"
                          onClick={() => runJob(job)}
                          disabled={pendingJobId !== null}
                          className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                        >
                          {pendingJobId === job.id ? "Running" : "Run"}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400 dark:text-slate-600">
                          Not wired
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleJobs.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-500 dark:text-slate-500">
              No jobs
            </div>
          )}
        </div>

        <JobDetailPane job={selectedJob} />
      </div>
    </div>
  );
}

function JobDetailPane({ job }: { job: AdminJobItem | null }) {
  if (!job) {
    return (
      <aside className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500">
        No job selected
      </aside>
    );
  }

  return (
    <aside className="min-h-0 rounded-lg border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-gray-200 p-4 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-semibold text-gray-900 dark:text-slate-100">
              {job.name}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-slate-500">
              {job.type} · {job.owner}
            </div>
          </div>
          <StatusPill status={job.status} />
        </div>
        {job.description && (
          <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-slate-400">
            {job.description}
          </p>
        )}
      </div>

      <div className="space-y-4 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <DetailTerm label="Executor" value={job.executor.type} />
          <DetailTerm label="Target" value={job.executor.target} mono />
          <DetailTerm label="Schedule" value={job.schedule} />
          <DetailTerm label="Schedule owner" value={job.scheduleOwner} />
        </dl>

        <div>
          <div className="mb-2 text-xs font-semibold text-gray-900 dark:text-slate-100">
            Runs
          </div>
          <div className="max-h-[360px] overflow-auto rounded-md border border-gray-200 dark:border-slate-800">
            <table className="min-w-[720px] w-full text-left text-[11px]">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Started</th>
                  <th className="px-2 py-2 font-medium">Trigger</th>
                  <th className="px-2 py-2 font-medium">Actor</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Duration</th>
                  <th className="px-2 py-2 font-medium">Summary</th>
                  <th className="px-2 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {job.runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-gray-100 last:border-b-0 dark:border-slate-900"
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-gray-600 dark:text-slate-400">
                      {formatDate(run.startedAt)}
                    </td>
                    <td className="px-2 py-2 text-gray-600 dark:text-slate-400">
                      {run.trigger}
                    </td>
                    <td className="px-2 py-2 text-gray-600 dark:text-slate-400">
                      {run.actor}
                    </td>
                    <td className="px-2 py-2">
                      <RunStatusPill status={run.status} />
                    </td>
                    <td className="px-2 py-2 text-gray-600 dark:text-slate-400">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="max-w-[220px] px-2 py-2 text-gray-700 dark:text-slate-300">
                      <div className="truncate" title={run.summary}>
                        {run.summary}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <RawDisclosure label="raw" value={run.details} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {job.runs.length === 0 && (
              <div className="p-4 text-center text-xs text-gray-500 dark:text-slate-500">
                No reliable run history recorded
              </div>
            )}
          </div>
        </div>

        <RawDisclosure label="config" value={job.rawConfig} block />
      </div>
    </aside>
  );
}

function DetailTerm({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-normal text-gray-400 dark:text-slate-600">
        {label}
      </dt>
      <dd
        className={`mt-0.5 truncate text-gray-700 dark:text-slate-300 ${
          mono ? "font-mono" : ""
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusPill({ status }: { status: AdminJobStatus }) {
  const className =
    status === "scheduled"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "manual"
        ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300"
        : status === "disabled"
          ? "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500"
          : status === "unwired"
            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            : "border-gray-200 bg-white text-gray-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {JOB_STATUS_COPY[status]}
    </span>
  );
}

function ScheduleOwnerPill({
  owner,
}: {
  owner: AdminJobItem["scheduleOwner"];
}) {
  const className =
    owner === "code"
      ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300"
      : owner === "db"
        ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300"
        : owner === "external"
          ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300"
          : owner === "manual"
            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            : "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium ${className}`}
    >
      {owner}
    </span>
  );
}

function RunStatusPill({ status }: { status: AdminJobRunStatus }) {
  const className =
    status === "succeeded"
      ? "text-emerald-700 dark:text-emerald-300"
      : status === "failed"
        ? "text-red-700 dark:text-red-300"
        : status === "running"
          ? "text-sky-700 dark:text-sky-300"
          : "text-gray-500 dark:text-slate-500";

  return (
    <span className={`whitespace-nowrap font-medium ${className}`}>
      {RUN_STATUS_COPY[status]}
    </span>
  );
}

function RawDisclosure({
  label,
  value,
  block,
}: {
  label: string;
  value: unknown;
  block?: boolean;
}) {
  if (value == null) {
    return <span className="text-gray-400 dark:text-slate-600">-</span>;
  }

  return (
    <details className={block ? "rounded-md border border-gray-200 dark:border-slate-800" : ""}>
      <summary className="cursor-pointer text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-slate-500 dark:hover:text-slate-200">
        {label}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-5 text-gray-700 dark:bg-slate-900 dark:text-slate-300">
        {formatRaw(value)}
      </pre>
    </details>
  );
}

function formatRaw(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatAge(value: string | null): string {
  if (!value) return "never";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "unknown";
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(value: number | null): string {
  if (value == null) return "-";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

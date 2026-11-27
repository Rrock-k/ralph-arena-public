"use client";

import { Fragment } from "react";
import { type LogLine, isLifecycleEntry } from "@/hooks/useLogStream";

interface LogViewProps {
  lines: LogLine[];
  legacyText: string;
  isLegacy: boolean;
  searchQuery?: string;
}

/**
 * Normalize epoch timestamp — auto-detect seconds vs milliseconds.
 * Values below 1e12 are treated as seconds (before ~2001 in millis, but valid as seconds until ~2286).
 */
function normalizeTs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/**
 * Format timestamp as HH:MM:SS in user-local timezone.
 * Uses Intl API for consistent locale-aware formatting.
 */
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

function formatTime(ts: number): string {
  return timeFormatter.format(normalizeTs(ts));
}

function timestampDate(ts: number): Date {
  return new Date(normalizeTs(ts));
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function formatDayLabel(ts: number): string {
  const date = timestampDate(ts);
  const diffDays = localDayNumber(new Date()) - localDayNumber(date);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays === -1) return "Tomorrow";
  return dayFormatter.format(date);
}

function formatFullTimestamp(ts: number): string {
  return fullTimestampFormatter.format(timestampDate(ts));
}

const LIFECYCLE_LABELS: Record<string, string> = {
  LAUNCHED: "Project launched",
  REPO_CREATED: "Repository created",
  VPS_PROVISIONED: "VPS provisioned",
  QUEUED: "Queued for worker",
  CLAIMED: "Worker claimed project",
  CONTAINER_STARTED: "Container started",
  RUNNER_INIT: "Runner initializing",
  REPO_CLONED: "Repository cloned",
  SPECS_WRITTEN: "Specs written",
  AGENT_STARTED: "Agent started",
  CONTAINER_SLEPT: "App power turned off",
  CONTAINER_WOKEN: "App power turned on",
};

/** Highlight search matches in text */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-500/40 text-amber-200">{text.slice(idx, idx + query.length)}</mark>
      <HighlightText text={text.slice(idx + query.length)} query={query} />
    </>
  );
}

/** Width of the timestamp prefix `[HH:MM:SS] ` in monospace characters */
const TS_PREFIX_WIDTH = "11ch";

function DateDivider({ ts }: { ts: number }) {
  const label = formatDayLabel(ts);
  return (
    <div
      className="sticky top-0 z-20 flex justify-center py-1"
      title={formatFullTimestamp(ts)}
      aria-label={`Log date: ${label}`}
    >
      <span className="min-w-[8.5rem] select-none rounded border border-sky-500/50 bg-slate-900 px-2 py-0.5 text-center text-[11px] font-medium text-sky-100 shadow-sm shadow-sky-950/20">
        {label}
      </span>
    </div>
  );
}

export function LogView({ lines, legacyText, isLegacy, searchQuery = "" }: LogViewProps) {
  const q = searchQuery.trim();

  if (isLegacy) {
    const text = legacyText || "(no output yet)";
    if (q) {
      const filteredLines = text.split("\n").filter((l) => l.toLowerCase().includes(q.toLowerCase()));
      return (
        <pre className="mono whitespace-pre-wrap break-words text-xs leading-5 text-gray-200">
          {filteredLines.length ? filteredLines.map((l, i) => (
            <span key={i}><HighlightText text={l} query={q} />{"\n"}</span>
          )) : "(no matches)"}
        </pre>
      );
    }
    return (
      <pre className="mono whitespace-pre-wrap break-words text-xs leading-5 text-gray-200">
        {text}
      </pre>
    );
  }

  if (!lines.length) {
    return (
      <pre className="mono whitespace-pre-wrap break-words text-xs leading-5 text-gray-200">
        (no output yet)
      </pre>
    );
  }

  const filtered = q
    ? lines.filter((line) => {
        if (isLifecycleEntry(line)) return false;
        return line.text.toLowerCase().includes(q.toLowerCase());
      })
    : lines;

  if (q && !filtered.length) {
    return (
      <pre className="mono whitespace-pre-wrap break-words text-xs leading-5 text-gray-200">
        (no matches)
      </pre>
    );
  }

  return (
    <div className="space-y-0">
      {filtered.map((line, i) => {
        const date = timestampDate(line.ts);
        const dayKey = localDayKey(date);
        const previous = i > 0 ? filtered[i - 1] : null;
        const previousDayKey = previous ? localDayKey(timestampDate(previous.ts)) : null;
        const showDateDivider = dayKey !== previousDayKey;

        if (isLifecycleEntry(line)) {
          const label = LIFECYCLE_LABELS[line.lc] || line.lc;
          return (
            <Fragment key={i}>
              {showDateDivider && <DateDivider ts={line.ts} />}
              <div
                className="flex items-center gap-2 py-1 text-[11px] text-slate-500"
              >
                <span className="shrink-0 border-t border-dashed border-slate-700 flex-1" />
                <span className="shrink-0 font-medium uppercase tracking-wide text-slate-400">
                  {label}
                </span>
                <span
                  className="mono shrink-0 text-slate-600"
                  title={formatFullTimestamp(line.ts)}
                  suppressHydrationWarning
                >
                  {formatTime(line.ts)}
                </span>
                <span className="shrink-0 border-t border-dashed border-slate-700 flex-1" />
              </div>
            </Fragment>
          );
        }

        return (
          <Fragment key={i}>
            {showDateDivider && <DateDivider ts={line.ts} />}
            <pre className="mono whitespace-pre-wrap break-words text-xs leading-5 text-gray-200" style={{ paddingLeft: TS_PREFIX_WIDTH, textIndent: `-${TS_PREFIX_WIDTH}` }}>
              <span
                className="select-none text-slate-600"
                title={formatFullTimestamp(line.ts)}
                suppressHydrationWarning
              >
                [{formatTime(line.ts)}]{" "}
              </span>
              {q ? <HighlightText text={line.text} query={q} /> : line.text}
            </pre>
          </Fragment>
        );
      })}
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";

// ── Types ───────────────────────────────────────────────────────

interface NotificationLogEntry {
  id: string;
  userId: string | null;
  eventType: string;
  channel: string;
  recipientEmail: string;
  status: string;
  resendEmailId: string | null;
  error: string | null;
  projectId: string | null;
  metadata: string | null;
  createdAt: string;
  user?: { email: string | null; name: string | null } | null;
}

interface SubscriberStat {
  status: string;
  count: number;
}

interface AnalyticsBucket {
  status: string;
  eventType: string;
  count: number;
}

interface Subscriber {
  id: string;
  email: string;
  source: string;
  status: string;
  createdAt: string;
  unsubscribedAt: string | null;
}

interface UserOptOut {
  id: string;
  userId: string;
  eventType: string;
  channel: string;
  enabled: boolean;
  updatedAt: string;
  user?: { email: string | null; name: string | null } | null;
}

interface NotificationsTabProps {
  logs: NotificationLogEntry[];
  subscriberStats: SubscriberStat[];
  analytics: AnalyticsBucket[];
  subscribers: Subscriber[];
  userPreferences: UserOptOut[];
}

// ── Status badge colors ─────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  SENT: "bg-blue-500/10 text-blue-400 border-blue-400/25",
  DELIVERED: "bg-emerald-500/10 text-emerald-400 border-emerald-400/25",
  OPENED: "bg-sky-500/10 text-sky-400 border-sky-400/25",
  CLICKED: "bg-violet-500/10 text-violet-400 border-violet-400/25",
  BOUNCED: "bg-rose-500/10 text-rose-400 border-rose-400/25",
  COMPLAINED: "bg-rose-500/10 text-rose-400 border-rose-400/25",
  FAILED: "bg-rose-500/10 text-rose-400 border-rose-400/25",
  SKIPPED: "bg-slate-500/10 text-slate-400 border-slate-400/25",
  ACTIVE: "bg-emerald-500/10 text-emerald-400 border-emerald-400/25",
  UNSUBSCRIBED: "bg-slate-500/10 text-slate-400 border-slate-400/25",
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || "bg-gray-500/10 text-gray-400 border-gray-400/25";
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${colors}`}>
      {status}
    </span>
  );
}

// ── Event labels ────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  "project.deployed": "Deployed",
  "project.failed": "Failed",
  "project.paused_budget": "Budget Paused",
  "proposal.approved": "Approved",
};

// ── Main Component ──────────────────────────────────────────────

export function NotificationsTab({ logs, subscriberStats, analytics, subscribers = [], userPreferences = [] }: NotificationsTabProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (eventFilter !== "all" && log.eventType !== eventFilter) return false;
      return true;
    });
  }, [logs, statusFilter, eventFilter]);

  // Aggregate stats
  const totalSubscribers = subscriberStats.reduce((sum, s) => sum + s.count, 0);
  const activeSubscribers = subscriberStats.find((s) => s.status === "ACTIVE")?.count || 0;

  // Analytics summary
  const totalSent = analytics.filter((a) => a.status === "SENT" || a.status === "DELIVERED").reduce((sum, a) => sum + a.count, 0);
  const totalOpened = analytics.filter((a) => a.status === "OPENED").reduce((sum, a) => sum + a.count, 0);
  const totalClicked = analytics.filter((a) => a.status === "CLICKED").reduce((sum, a) => sum + a.count, 0);
  const totalBounced = analytics.filter((a) => a.status === "BOUNCED").reduce((sum, a) => sum + a.count, 0);
  const totalFailed = analytics.filter((a) => a.status === "FAILED").reduce((sum, a) => sum + a.count, 0);
  const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : "—";
  const clickRate = totalSent > 0 ? ((totalClicked / totalSent) * 100).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Notifications</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Email delivery log, analytics, and newsletter subscribers.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Subscribers" value={activeSubscribers} sublabel={`${totalSubscribers} total`} />
        <StatCard label="Sent (30d)" value={totalSent} />
        <StatCard label="Open Rate" value={`${openRate}%`} />
        <StatCard label="Click Rate" value={`${clickRate}%`} />
        <StatCard label="Bounced" value={totalBounced} warn={totalBounced > 0} />
        <StatCard label="Failed" value={totalFailed} warn={totalFailed > 0} />
      </div>

      {/* Subscriber breakdown */}
      {subscriberStats.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
            Newsletter Subscribers
          </h3>
          <div className="flex flex-wrap gap-2">
            {subscriberStats.map((stat) => (
              <div
                key={stat.status}
                className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
              >
                <StatusBadge status={stat.status} />
                <span className="text-sm font-medium text-slate-200">{stat.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscribers list */}
      {subscribers.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
            Newsletter Subscribers ({subscribers.length})
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Subscribed</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((sub) => (
                  <tr key={sub.id} className="border-t border-slate-800/50 hover:bg-slate-900/50">
                    <td className="px-3 py-2 text-slate-300">{sub.email}</td>
                    <td className="px-3 py-2 text-slate-400">{sub.source}</td>
                    <td className="px-3 py-2"><StatusBadge status={sub.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-400">
                      {new Date(sub.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User opt-outs */}
      {userPreferences.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
            User Opt-Outs ({userPreferences.length})
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {userPreferences.map((pref) => (
                  <tr key={pref.id} className="border-t border-slate-800/50 hover:bg-slate-900/50">
                    <td className="px-3 py-2 text-slate-300">
                      {pref.user?.name || pref.user?.email || pref.userId}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {EVENT_LABELS[pref.eventType] || pref.eventType}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{pref.channel}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-400">
                      {new Date(pref.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analytics by event type */}
      {analytics.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
            Last 30 Days by Event Type
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2 pr-4 font-medium">Event</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {analytics.map((a, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    <td className="py-1.5 pr-4 text-slate-300">
                      {EVENT_LABELS[a.eventType] || a.eventType}
                    </td>
                    <td className="py-1.5 pr-4">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-200">{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
          Delivery Log
        </h3>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
        >
          <option value="all">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="DELIVERED">Delivered</option>
          <option value="OPENED">Opened</option>
          <option value="CLICKED">Clicked</option>
          <option value="BOUNCED">Bounced</option>
          <option value="COMPLAINED">Complained</option>
          <option value="FAILED">Failed</option>
          <option value="SKIPPED">Skipped</option>
        </select>
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
        >
          <option value="all">All events</option>
          <option value="project.deployed">Deployed</option>
          <option value="project.failed">Failed</option>
          <option value="project.paused_budget">Budget Paused</option>
          <option value="proposal.approved">Approved</option>
        </select>
        <span className="text-xs text-slate-500">
          {filteredLogs.length} of {logs.length} entries
        </span>
      </div>

      {/* Log table */}
      {filteredLogs.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-500">
          No notification logs yet. Enable the notifications feature flag to start sending.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Recipient</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-slate-800/50 hover:bg-slate-900/50"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-400">
                    {new Date(log.createdAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 text-slate-300" title={log.recipientEmail}>
                    {log.user?.name || log.recipientEmail}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {EVENT_LABELS[log.eventType] || log.eventType}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={log.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-400">{log.channel}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-rose-400" title={log.error || ""}>
                    {log.error || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Helper components ───────────────────────────────────────────

function StatCard({
  label,
  value,
  sublabel,
  warn,
}: {
  label: string;
  value: number | string;
  sublabel?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warn ? "text-rose-400" : "text-slate-100"}`}>
        {value}
      </div>
      {sublabel && (
        <div className="mt-0.5 text-[10px] text-slate-500">{sublabel}</div>
      )}
    </div>
  );
}

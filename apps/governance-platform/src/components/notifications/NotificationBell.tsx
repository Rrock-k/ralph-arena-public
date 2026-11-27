"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Notification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const EVENT_ICONS: Record<string, string> = {
  "project.deployed": "🚀",
  "project.failed": "❌",
  "project.paused_budget": "⏸️",
  "proposal.approved": "✅",
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/in-app?limit=20");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {
      // Silently fail — bell just won't update
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Poll every 30s for new notifications (lightweight — just count query)
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const markRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch(`/api/notifications/in-app/${id}/read`, { method: "POST" });
  };

  const markAllRead = async () => {
    setLoading(true);
    await fetch("/api/notifications/in-app/read-all", { method: "POST" });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    setLoading(false);
  };

  const handleClick = (notification: Notification) => {
    if (!notification.read) {
      markRead(notification.id);
    }
    if (notification.link) {
      window.location.href = notification.link;
    }
    setOpen(false);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button — matches Credits/Ops header button style */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:w-96">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={loading}
                className="text-xs font-medium text-sky-600 hover:text-sky-500 disabled:opacity-50 dark:text-sky-400"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleClick(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/50 ${
                    !n.read
                      ? "bg-sky-50/50 dark:bg-sky-950/20"
                      : ""
                  }`}
                >
                  <span className="mt-0.5 text-base">
                    {EVENT_ICONS[n.eventType] || "📬"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium ${
                          n.read
                            ? "text-gray-600 dark:text-slate-400"
                            : "text-gray-900 dark:text-slate-100"
                        }`}
                      >
                        {n.title}
                      </span>
                      {!n.read && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-500">
                      {n.body}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-400 dark:text-slate-600">
                    {timeAgo(n.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  getNotificationPreferences,
  getProjectPersonalNotificationPreferences,
  updateProjectPersonalNotificationPreference,
  updateNotificationPreference,
  type ProjectPersonalNotificationPreferencesResult,
} from "@/app/actions/notification-preferences";
import { EVENT_LABELS, NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import type { ProjectPersonalNotificationEventType } from "@/lib/project-personal-notification-types";

const EVENT_DESCRIPTIONS: Record<string, string> = {
  "project.deployed": "When your project is successfully deployed and live.",
  "project.failed": "When your project build fails.",
  "project.paused_budget": "When your project is paused due to budget exhaustion.",
  "proposal.approved": "When your proposal is approved and agents start building it.",
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  in_app: "In-App",
};

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [projectPrefs, setProjectPrefs] =
    useState<ProjectPersonalNotificationPreferencesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getNotificationPreferences()
      .then((result) => {
        if (!alive) return;
        if (result.success) {
          setPrefs(result.preferences);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    getProjectPersonalNotificationPreferences()
      .then((result) => {
        if (alive) setProjectPrefs(result);
      })
      .finally(() => {
        if (alive) setProjectLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (eventType: string, channel: string) => {
    const key = `${eventType}:${channel}`;
    const next = !prefs[key];
    setPrefs((prev) => ({ ...prev, [key]: next }));
    setSaving(key);

    try {
      const result = await updateNotificationPreference(eventType, channel, next);
      if (!result.success) {
        setPrefs((prev) => ({ ...prev, [key]: !next }));
        toast.error(result.error || "Failed to update");
      }
    } catch {
      setPrefs((prev) => ({ ...prev, [key]: !next }));
      toast.error("Network error");
    } finally {
      setSaving(null);
    }
  };

  const toggleProjectPreference = async (
    projectId: string,
    eventType: ProjectPersonalNotificationEventType,
  ) => {
    if (!projectPrefs?.success) return;
    const current = projectPrefs.projects
      .find((project) => project.projectId === projectId)
      ?.events.find((event) => event.eventType === eventType);
    if (!current) return;

    const key = `${projectId}:${eventType}`;
    const next = !current.enabled;
    setProjectSaving(key);
    setProjectPrefs((prev) => updateProjectPreferenceState(prev, projectId, eventType, next));

    try {
      const result = await updateProjectPersonalNotificationPreference(projectId, eventType, next);
      if (!result.success) {
        setProjectPrefs((prev) => updateProjectPreferenceState(prev, projectId, eventType, !next));
        toast.error(result.error || "Failed to update");
      }
    } catch {
      setProjectPrefs((prev) => updateProjectPreferenceState(prev, projectId, eventType, !next));
      toast.error("Network error");
    } finally {
      setProjectSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {NOTIFICATION_EVENTS.map((eventType) => (
        <div
          key={eventType}
          className="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="mb-2">
            <div className="text-sm font-semibold text-gray-900">
              {EVENT_LABELS[eventType]}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {EVENT_DESCRIPTIONS[eventType]}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {(["email", "in_app"] as const).map((channel) => {
              const key = `${eventType}:${channel}`;
              const enabled = prefs[key] ?? true;
              return (
                <label
                  key={channel}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={() => toggle(eventType, channel)}
                    disabled={saving === key}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      enabled ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                        enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                      }`}
                    />
                  </button>
                  <span className="text-xs text-gray-600">
                    {CHANNEL_LABELS[channel]}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <PrivateTelegramProjectNotifications
        loading={projectLoading}
        state={projectPrefs}
        saving={projectSaving}
        onToggle={(projectId, eventType) => void toggleProjectPreference(projectId, eventType)}
      />
      {/* Newsletter toggle */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Newsletter</div>
            <div className="mt-0.5 text-xs text-gray-500">
              Platform updates, new projects, community highlights.
            </div>
          </div>
          <NewsletterToggle />
        </div>
      </div>
    </div>
  );
}

function updateProjectPreferenceState(
  state: ProjectPersonalNotificationPreferencesResult | null,
  projectId: string,
  eventType: ProjectPersonalNotificationEventType,
  enabled: boolean,
): ProjectPersonalNotificationPreferencesResult | null {
  if (!state?.success) return state;
  return {
    ...state,
    projects: state.projects.map((project) => {
      if (project.projectId !== projectId) return project;
      return {
        ...project,
        events: project.events.map((event) => (
          event.eventType === eventType
            ? { ...event, enabled, source: "project" }
            : event
        )),
      };
    }),
  };
}

function PrivateTelegramProjectNotifications({
  loading,
  state,
  saving,
  onToggle,
}: {
  loading: boolean;
  state: ProjectPersonalNotificationPreferencesResult | null;
  saving: string | null;
  onToggle: (projectId: string, eventType: ProjectPersonalNotificationEventType) => void;
}) {
  if (loading) {
    return (
      <div className="mt-6 space-y-3">
        <div className="h-5 w-56 animate-pulse rounded bg-gray-100" />
        <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (!state?.success) {
    return (
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Telegram project notifications are unavailable right now.
      </div>
    );
  }

  return (
    <section className="mt-6 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-900">
          Private Telegram project updates
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Per-project private messages for tg-spec projects where you can manage secrets.
        </p>
      </div>

      <div
        className={`rounded-xl border p-4 ${
          state.telegramAccountStatus === "ready"
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className={`text-sm font-semibold ${
              state.telegramAccountStatus === "ready" ? "text-emerald-800" : "text-amber-800"
            }`}
            >
              {state.telegramAccountStatus === "ready" ? "Telegram ready" : "Telegram needs attention"}
            </div>
            <div className={`mt-0.5 text-xs ${
              state.telegramAccountStatus === "ready" ? "text-emerald-700" : "text-amber-700"
            }`}
            >
              {state.telegramAccountMessage}
            </div>
          </div>
          {state.telegramAccountStatus !== "ready" && (
            <a
              href="/settings#profile"
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:border-amber-400"
            >
              Open profile
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {state.projects.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold text-gray-900">
            No manageable tg-spec projects
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            Projects appear here when you are an owner or have manager access.
          </div>
        </div>
      ) : (
        state.projects.map((project) => (
          <div
            key={project.projectId}
            className="rounded-xl border border-gray-200 bg-white p-4"
          >
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <div className="text-sm font-semibold text-gray-900">
                {project.projectName}
              </div>
              <div className="text-[11px] text-gray-400">
                Updated {new Date(project.updatedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {project.events.map((event) => {
                const key = `${project.projectId}:${event.eventType}`;
                return (
                  <div
                    key={event.eventType}
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {event.label}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {event.description}
                      </div>
                      {event.source === "global" && (
                        <div className="mt-1 text-[11px] text-gray-400">
                          Uses global preference until changed here.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggle(project.projectId, event.eventType)}
                      disabled={saving === key}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        event.enabled ? "bg-emerald-500" : "bg-gray-300"
                      }`}
                      aria-label={`${event.enabled ? "Disable" : "Enable"} ${event.label} for ${project.projectName}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                          event.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function NewsletterToggle() {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/notifications/subscribe/status")
      .then((r) => r.json())
      .then((data) => setSubscribed(data.subscribed ?? false))
      .catch(() => setSubscribed(false));
  }, []);

  const toggle = async () => {
    if (subscribed === null) return;
    const next = !subscribed;
    setSubscribed(next);
    setSaving(true);
    try {
      if (next) {
        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "platform" }),
        });
      } else {
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
        });
      }
    } catch {
      setSubscribed(!next);
    } finally {
      setSaving(false);
    }
  };

  if (subscribed === null) return <div className="h-5 w-9 animate-pulse rounded-full bg-gray-200" />;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        subscribed ? "bg-emerald-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          subscribed ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

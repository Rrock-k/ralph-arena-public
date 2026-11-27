"use client";

import { useState } from "react";
import { toast } from "sonner";
import { setFeatureFlag } from "@/app/actions/feature-flags";
import { FEATURE_FLAG_KEYS } from "@/lib/feature-flag-keys";
import type { FeatureFlagsSnapshot } from "@/lib/feature-flags";

type FeatureFlagsTabProps = {
  featureFlags: FeatureFlagsSnapshot;
};

const FLAG_META: { key: keyof typeof FEATURE_FLAG_KEYS; label: string; description: string }[] = [
  {
    key: "budgetVisibility",
    label: "Budget Visibility For Users",
    description: "Shows or hides public project budget indicators (used, remaining, progress).",
  },
  {
    key: "communityQa",
    label: "Community Q&A",
    description: "Enables community Q&A testing on project pages.",
  },
  {
    key: "notifications",
    label: "Email Notifications",
    description: "Global kill switch for all outbound email notifications (deployed, failed, budget paused, etc.).",
  },
  {
    key: "byokProviderKeys",
    label: "BYOK Provider Keys",
    description: "Shows user API-key settings and permits user-owned Codex/Claude launches through user keys.",
  },
  {
    key: "managedProviderCredits",
    label: "Managed Provider Credits",
    description: "Lets users run Codex/Claude through platform API keys by reserving purchased credits into project budgets.",
  },
];

export function FeatureFlagsTab({ featureFlags }: FeatureFlagsTabProps) {
  return (
    <div className="space-y-3">
      {FLAG_META.map((meta) => (
        <FlagRow
          key={meta.key}
          flagKey={FEATURE_FLAG_KEYS[meta.key]}
          label={meta.label}
          description={meta.description}
          initialEnabled={featureFlags[meta.key]}
        />
      ))}
    </div>
  );
}

function FlagRow({
  flagKey,
  label,
  description,
  initialEnabled,
}: {
  flagKey: (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];
  label: string;
  description: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isSaving, setIsSaving] = useState(false);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setIsSaving(true);

    const result = await setFeatureFlag(flagKey, next);

    setIsSaving(false);

    if (!result.success) {
      setEnabled(!next);
      toast.error(result.error || "Failed to update feature flag");
      return;
    }

    toast.success(`${label}: ${next ? "enabled" : "disabled"}`);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{label}</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{description}</p>
        </div>

        <button
          type="button"
          onClick={toggle}
          disabled={isSaving}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
            enabled
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
          }`}
        >
          {isSaving ? "Saving..." : enabled ? "Enabled" : "Disabled"}
        </button>
      </div>
    </div>
  );
}

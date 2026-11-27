"use client";

import { useState, useTransition } from "react";
import { setProjectAiDisclaimer } from "@/app/actions/project-settings";

interface AiDisclaimerToggleProps {
  projectId: string;
  /** Current value: true = show the AI-generated disclaimer to viewers. */
  initialValue: boolean;
}

/**
 * Admin control for the per-project AI-generated content disclaimer.
 * When off, the preview-gate interstitial ("AI-Generated Content") is skipped —
 * used for projects built by a trusted team.
 */
export function AiDisclaimerToggle({ projectId, initialValue }: AiDisclaimerToggleProps) {
  const [showDisclaimer, setShowDisclaimer] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const next = !showDisclaimer;
    const prev = showDisclaimer;
    setShowDisclaimer(next);
    startTransition(async () => {
      const result = await setProjectAiDisclaimer(projectId, next);
      if (!result.success) setShowDisclaimer(prev);
    });
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        showDisclaimer
          ? "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300"
          : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300"
      } ${isPending ? "opacity-50" : ""}`}
      title={
        showDisclaimer
          ? "AI disclaimer is shown to viewers. Click to hide it (trusted team)."
          : "AI disclaimer is hidden (trusted team). Click to show it."
      }
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
        <line x1="12" y1="9" x2="12" y2="13" strokeWidth={2} strokeLinecap="round" />
        <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth={2} strokeLinecap="round" />
      </svg>
      AI disclaimer: {showDisclaimer ? "On" : "Off"}
    </button>
  );
}

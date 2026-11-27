"use client";

import type { AccessGrantVisualState, AccessPresetKey, EffectiveAccessSourceKind } from "@/lib/access-control/types";
import {
  ACCESS_PRESET_ACCENT_STYLES,
  ACCESS_PRESET_DEFINITIONS,
} from "@/lib/access-control/presets";
import { getAccessGrantLabel } from "@/lib/access-control/utils";

interface AccessGrantBadgeProps {
  presetKey: AccessPresetKey | null;
  customLabel?: string | null;
  state?: AccessGrantVisualState;
  sourceKind?: EffectiveAccessSourceKind;
  compact?: boolean;
}

const STATE_STYLES: Record<AccessGrantVisualState, string> = {
  active: "",
  expired: "opacity-50 line-through",
  revoked: "opacity-40 line-through",
};

const SOURCE_STYLES: Record<EffectiveAccessSourceKind, { border: string; bg: string; text: string; dot: string }> = {
  owner: {
    border: "border-cyan-300 dark:border-cyan-400/25",
    bg: "bg-cyan-50 dark:bg-cyan-500/10",
    text: "text-cyan-700 dark:text-cyan-300",
    dot: "bg-cyan-500 dark:bg-cyan-400",
  },
  direct: {
    border: "border-emerald-300 dark:border-emerald-400/25",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  inherited: {
    border: "border-gray-300 dark:border-slate-400/20",
    bg: "bg-gray-50 dark:bg-slate-500/8",
    text: "text-gray-500 dark:text-slate-400",
    dot: "bg-gray-400 dark:bg-slate-500",
  },
};

function getPresetAccentStyles(presetKey: AccessPresetKey | null): { border: string; bg: string; text: string; dot: string } {
  if (!presetKey) {
    return {
      border: "border-violet-300 dark:border-violet-400/25",
      bg: "bg-violet-50 dark:bg-violet-500/10",
      text: "text-violet-700 dark:text-violet-300",
      dot: "bg-violet-500 dark:bg-violet-400",
    };
  }
  const def = ACCESS_PRESET_DEFINITIONS[presetKey];
  return ACCESS_PRESET_ACCENT_STYLES[def?.accent ?? "slate"];
}

export function AccessGrantBadge({
  presetKey,
  customLabel,
  state = "active",
  sourceKind,
  compact = false,
}: AccessGrantBadgeProps) {
  const label = getAccessGrantLabel({
    customLabel: customLabel ?? null,
    sourcePresetKey: presetKey,
    capabilities: [],
  });

  const styles = sourceKind ? SOURCE_STYLES[sourceKind] : getPresetAccentStyles(presetKey);
  const stateClass = STATE_STYLES[state];

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-tight ${styles.border} ${styles.bg} ${styles.text} ${stateClass}`}
      >
        <span className={`h-1 w-1 rounded-full ${styles.dot}`} />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles.border} ${styles.bg} ${styles.text} ${stateClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {label}
      {state === "expired" && <span className="text-[10px] opacity-70">(expired)</span>}
      {state === "revoked" && <span className="text-[10px] opacity-70">(revoked)</span>}
    </span>
  );
}

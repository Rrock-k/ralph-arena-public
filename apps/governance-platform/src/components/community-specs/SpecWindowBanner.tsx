"use client";

import { useState, useEffect } from "react";
import type { SpecWindowState } from "./mock-data";

interface SpecWindowBannerProps {
  window: SpecWindowState;
}

function formatCountdown(targetDate: string): string {
  const diff = new Date(targetDate).getTime() - Date.now();
  if (diff <= 0) return "0m";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SpecWindowBanner({ window: w }: SpecWindowBannerProps) {
  const [, setTick] = useState(0);

  // Update countdown every 30s
  useEffect(() => {
    if (w.status === "closed") return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [w.status]);

  if (w.status === "open") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-semibold text-emerald-300">
            Spec window open
          </span>
          <span className="text-xs text-slate-500">
            Round {w.currentRound}/{w.maxRounds}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>
            Top {w.maxAcceptedSpecs} specs with ≥{w.specVoteThreshold} votes
            will be accepted
          </span>
          {w.closesAt && (
            <span className="mono font-semibold text-emerald-300">
              {formatCountdown(w.closesAt)} left
            </span>
          )}
        </div>
      </div>
    );
  }

  if (w.status === "scheduled") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.05] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-sm font-semibold text-amber-300">
            Spec window scheduled
          </span>
        </div>
        {w.opensAt && (
          <span className="mono text-xs font-semibold text-amber-300">
            Opens in {formatCountdown(w.opensAt)}
          </span>
        )}
      </div>
    );
  }

  // Closed
  const allRoundsDone = w.currentRound >= w.maxRounds;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-slate-600" />
        <span className="text-sm font-medium text-slate-400">
          Spec window closed
        </span>
        <span className="text-xs text-slate-600">
          {w.currentRound}/{w.maxRounds} rounds completed
        </span>
      </div>
      {allRoundsDone && (
        <span className="text-xs text-slate-600">All rounds finished</span>
      )}
    </div>
  );
}

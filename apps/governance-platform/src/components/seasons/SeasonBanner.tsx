import { getCurrentPhase, type SeasonLike, type SeasonPhase } from "@/lib/seasons";

export interface SeasonBannerData extends SeasonLike {
  id: string;
  title: string;
  description?: string | null;
  _count: { proposals: number };
}

const PHASE_COLORS: Record<string, string> = {
  Open: "bg-cyan-500",
  Build: "bg-amber-500",
};

const PHASE_TEXT_COLORS: Record<string, string> = {
  Open: "text-cyan-700 border-cyan-200 bg-cyan-50",
  Build: "text-amber-700 border-amber-200 bg-amber-50",
};

/* ─── Helpers ────────────────────────────────────────── */

function formatDeadline(date: Date | string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (diffMs < 0) return dateStr;
  if (diffHours < 1) return "< 1 hour";
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 7) return `in ${diffDays} days`;
  return dateStr;
}

/* ─── Single season row (reused by List variant) ─── */

function SeasonRow({ season, phase, compact }: { season: SeasonBannerData; phase: SeasonPhase; compact?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {!compact && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg font-bold text-gray-600">
            S
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className={`${compact ? "text-sm" : "text-base"} font-bold text-gray-950`}>{season.title}</span>
            {phase && (
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${PHASE_TEXT_COLORS[phase] || "text-gray-700 border-gray-200"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${PHASE_COLORS[phase] || "bg-gray-400"} animate-pulse`} />
                {phase}
              </span>
            )}
          </div>
          {!compact && season.description && (
            <p className="text-sm text-gray-500">{season.description}</p>
          )}
        </div>
      </div>
      <div className="mono shrink-0 text-sm text-gray-400">
        {season._count.proposals} proposal{season._count.proposals !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────── */
/* Variant A: Stacked list — one banner row per season */
/* ─────────────────────────────────────────────────── */

export function SeasonBannerList({ seasons }: { seasons: SeasonBannerData[] }) {
  if (seasons.length === 0) return null;

  return (
    <section className="border-b border-gray-200 bg-white py-4">
      <div className="mx-auto max-w-[1200px] space-y-3 px-6">
        {seasons.map((season) => (
          <SeasonRow key={season.id} season={season} phase={getCurrentPhase(season)} />
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────── */
/* Variant B: Primary + "+N more" counter              */
/* ─────────────────────────────────────────────────── */

const PHASE_PRIORITY: Record<string, number> = { Open: 0, Build: 1 };

function pickPrimary(seasons: SeasonBannerData[]): { primary: SeasonBannerData; rest: SeasonBannerData[] } {
  const sorted = [...seasons].sort((a, b) => {
    const pa = PHASE_PRIORITY[getCurrentPhase(a) ?? ""] ?? 99;
    const pb = PHASE_PRIORITY[getCurrentPhase(b) ?? ""] ?? 99;
    return pa - pb;
  });
  return { primary: sorted[0], rest: sorted.slice(1) };
}

export function SeasonBannerPrimary({ seasons }: { seasons: SeasonBannerData[] }) {
  if (seasons.length === 0) return null;
  const { primary, rest } = pickPrimary(seasons);
  const phase = getCurrentPhase(primary);

  return (
    <section className="border-b border-gray-200 bg-white py-5">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg font-bold text-gray-600">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-gray-950">{primary.title}</span>
              {phase && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${PHASE_TEXT_COLORS[phase] || "text-gray-700 border-gray-200"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${PHASE_COLORS[phase] || "bg-gray-400"} animate-pulse`} />
                  {phase} Phase
                </span>
              )}
            </div>
            {primary.description && (
              <p className="text-sm text-gray-500">{primary.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-sm text-gray-400">
            {primary._count.proposals} proposal{primary._count.proposals !== 1 ? "s" : ""}
          </span>
          {rest.length > 0 && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500">
              +{rest.length} more
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────── */
/* Variant C: Horizontal chips — scrolls to section    */
/* ─────────────────────────────────────────────────── */

function chipDeadlineText(season: SeasonBannerData, phase: SeasonPhase): string | null {
  if (phase === "Open") return season.buildStart ? `until ${formatDeadline(season.buildStart)}` : null;
  if (phase === "Build") return season.buildDeadline ? `until ${formatDeadline(season.buildDeadline)}` : null;
  return null;
}

export function SeasonBannerChips({ seasons }: { seasons: SeasonBannerData[] }) {
  if (seasons.length === 0) return null;

  return (
    <section className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-[1200px] items-center gap-3 overflow-x-auto px-6 py-4">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-400">Seasons</span>
        {seasons.map((season) => {
          const phase = getCurrentPhase(season);
          const deadline = chipDeadlineText(season, phase);
          const count = season._count.proposals;
          return (
            <a
              key={season.id}
              href={`#season-${season.id}`}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 transition-all ${
                phase ? PHASE_TEXT_COLORS[phase] : "border-gray-200 bg-gray-50 text-gray-700"
              } hover:ring-1 hover:ring-gray-200 hover:shadow-sm`}
            >
              {phase && (
                <span className={`h-1.5 w-1.5 rounded-full ${PHASE_COLORS[phase]} animate-pulse`} />
              )}
              <span className="text-sm font-bold">{season.title}</span>
              <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${
                phase ? "opacity-80" : "opacity-60"
              }`}>
                {phase ?? "Active"}
              </span>
              {deadline && (
                <span className="text-[11px] opacity-60">{deadline}</span>
              )}
              <span className="mono text-[11px] opacity-50">{count} idea{count !== 1 ? "s" : ""}</span>
              {/* Arrow down icon */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-40"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </a>
          );
        })}
      </div>
    </section>
  );
}

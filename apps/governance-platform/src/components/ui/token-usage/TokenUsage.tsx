/**
 * Token usage indicator variants.
 * Standalone UI elements — pick one to integrate into project cards.
 */

interface TokenUsageProps {
  used: number;
  total: number;
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pct(used: number, total: number) {
  return Math.min(100, Math.round((used / total) * 100));
}

function barColor(percent: number) {
  if (percent >= 90) return "bg-rose-500";
  if (percent >= 70) return "bg-amber-400";
  return "bg-emerald-400";
}

function textColor(percent: number) {
  if (percent >= 90) return "text-rose-400";
  if (percent >= 70) return "text-amber-400";
  return "text-emerald-400";
}

/* ── Variant 1: Thin progress bar ── */
export function TokenBar({ used, total }: TokenUsageProps) {
  const p = pct(used, total);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(p)}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className={`mono text-[10px] font-semibold ${textColor(p)}`}>
        {formatTokens(used)}
      </span>
    </div>
  );
}

/* ── Variant 2: Labeled bar with "used / total" ── */
export function TokenBarLabeled({ used, total }: TokenUsageProps) {
  const p = pct(used, total);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="mono text-[9px] text-slate-600 uppercase tracking-wider">Tokens</span>
        <span className={`mono text-[10px] font-semibold ${textColor(p)}`}>
          {formatTokens(used)} / {formatTokens(total)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(p)}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </div>
  );
}

/* ── Variant 3: Inline pill (compact) ── */
export function TokenPill({ used, total }: TokenUsageProps) {
  const p = pct(used, total);
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 backdrop-blur-sm ${
      p >= 90 ? "bg-rose-400/10 border-rose-400/30" :
      p >= 70 ? "bg-amber-400/10 border-amber-400/30" :
      "bg-emerald-400/10 border-emerald-400/30"
    }`}>
      <svg className={`h-3 w-3 ${textColor(p)}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span className={`mono text-[10px] font-semibold ${textColor(p)}`}>
        {formatTokens(used)} / {formatTokens(total)}
      </span>
    </div>
  );
}

/* ── Variant 4: Ring / donut ── */
export function TokenRing({ used, total }: TokenUsageProps) {
  const p = pct(used, total);
  const r = 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (p / 100) * circ;
  const stroke = p >= 90 ? "#f87171" : p >= 70 ? "#fbbf24" : "#34d399";

  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90">
        <circle cx="11" cy="11" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
        <circle
          cx="11" cy="11" r={r} fill="none"
          stroke={stroke} strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all"
        />
      </svg>
      <div className="flex flex-col">
        <span className={`mono text-[10px] font-bold leading-none ${textColor(p)}`}>{p}%</span>
        <span className="mono text-[8px] text-slate-600 leading-none mt-0.5">{formatTokens(used)}</span>
      </div>
    </div>
  );
}

/* ── Variant 5: Terminal-style counter ── */
export function TokenTerminal({ used, total }: TokenUsageProps) {
  const p = pct(used, total);
  const remaining = total - used;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`mono text-[10px] ${textColor(p)}`}>&#9670;</span>
      <span className="mono text-[10px] text-slate-500">
        {formatTokens(remaining)} <span className="text-slate-700">remaining</span>
      </span>
    </div>
  );
}

/* ── Variant 6: Segmented gauge ── */
export function TokenGauge({ used, total }: TokenUsageProps) {
  const p = pct(used, total);
  const segments = 10;
  const filled = Math.round((p / 100) * segments);

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className={`h-2.5 w-1.5 rounded-sm transition-all ${
              i < filled
                ? i >= segments * 0.9 ? "bg-rose-500" :
                  i >= segments * 0.7 ? "bg-amber-400" :
                  "bg-emerald-400"
                : "bg-white/[0.06]"
            }`}
          />
        ))}
      </div>
      <span className={`mono text-[10px] font-semibold ${textColor(p)}`}>
        {formatTokens(used)}
      </span>
    </div>
  );
}

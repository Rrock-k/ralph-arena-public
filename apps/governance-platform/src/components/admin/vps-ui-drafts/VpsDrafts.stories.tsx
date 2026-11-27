import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

/* ------------------------------------------------------------------ */
/*  RA-037 / RA-059  —  VPS UI Drafts (all-in-one sketch)             */
/* ------------------------------------------------------------------ */

// ─── 1. Deploy Target Selector ──────────────────────────────────────

function DeployTargetSelector({
  value,
  onChange,
}: {
  value: "local" | "vps";
  onChange: (v: "local" | "vps") => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        Deploy target
      </p>
      <div className="flex gap-2">
        <label
          className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
            value === "local"
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-emerald-400"
          }`}
        >
          <input
            type="radio"
            name="deploy-target"
            checked={value === "local"}
            onChange={() => onChange("local")}
            className="h-3.5 w-3.5 text-emerald-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">Local Docker</span>
            <p className="text-xs text-gray-500">Same host as dispatcher</p>
          </div>
        </label>
        <label
          className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
            value === "vps"
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-emerald-400"
          }`}
        >
          <input
            type="radio"
            name="deploy-target"
            checked={value === "vps"}
            onChange={() => onChange("vps")}
            className="h-3.5 w-3.5 text-emerald-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">VPS</span>
            <p className="text-xs text-gray-500">Isolated Hetzner VM</p>
          </div>
        </label>
      </div>
    </div>
  );
}

// ─── 2. VPS Status Badge ────────────────────────────────────────────

function VpsStatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    provisioning: "border-blue-200 bg-blue-50 text-blue-700",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    error: "border-rose-200 bg-rose-50 text-rose-700",
    deprovisioning: "border-amber-200 bg-amber-50 text-amber-700",
  };
  return (
    <span
      className={`mono inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        classes[status] ?? "border-gray-200 bg-gray-50 text-gray-700"
      }`}
    >
      {status}
    </span>
  );
}

// ─── 3. Backend Badge (for projects/runs tables) ────────────────────

const BACKEND_ICONS = {
  local: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
    </svg>
  ),
  vps: (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
  ),
};

const BACKEND_STYLES = {
  local: { border: "border-gray-200", bg: "bg-gray-50", text: "text-gray-600" },
  vps: { border: "border-violet-200", bg: "bg-violet-50", text: "text-violet-600" },
};

/** Full badge: icon + text label */
function BackendBadge({ backend }: { backend: "local" | "vps" }) {
  const s = BACKEND_STYLES[backend];
  return (
    <span className={`mono inline-flex items-center gap-1 rounded-full border ${s.border} ${s.bg} px-2 py-0.5 text-[11px] font-semibold ${s.text}`}>
      {BACKEND_ICONS[backend]}
      {backend}
    </span>
  );
}

/** Compact badge: icon only + tooltip */
function BackendBadgeCompact({ backend }: { backend: "local" | "vps" }) {
  const s = BACKEND_STYLES[backend];
  return (
    <span
      title={backend}
      className={`inline-flex items-center justify-center rounded-full border ${s.border} ${s.bg} ${s.text} h-5 w-5 cursor-default`}
    >
      {BACKEND_ICONS[backend]}
    </span>
  );
}

/** Three-dots context menu with dropdown */
function ContextMenuDots({ items }: { items?: { label: string; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuItems = items ?? [
    { label: "Details" },
    { label: "Deprovision", danger: true },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {menuItems.map((item) => (
            <button
              key={item.label}
              onClick={() => setOpen(false)}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
                item.danger
                  ? "text-rose-600 hover:bg-rose-50"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Composite: All Drafts ──────────────────────────────────────────

function AllVpsDrafts() {
  const [target, setTarget] = useState<"local" | "vps">("local");
  const [billing, setBilling] = useState<"subscription" | "api_key">("subscription");

  return (
    <div style={{ padding: 32, maxWidth: 900 }} className="space-y-10 font-sans">

      {/* ── Section 1: Deploy Target Selector ── */}
      <section>
        <SectionTitle>1. Deploy Target Selector</SectionTitle>
        <p className="text-xs text-gray-500 mb-3">
          Встраивается в Launch / Relaunch диалоги между &quot;Billing&quot; и &quot;Agent configuration&quot;
        </p>
        <div className="max-w-md rounded-xl border border-gray-200 bg-white p-4">
          <DeployTargetSelector value={target} onChange={setTarget} />
        </div>
      </section>

      {/* ── Section 2: Launch Dialog Mock ── */}
      <section>
        <SectionTitle>2. Launch Dialog (with VPS option)</SectionTitle>
        <div className="max-w-md rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-200 px-6 pt-6 pb-3">
            <h3 className="text-base font-semibold text-gray-900">Launch proposal build</h3>
            <p className="text-sm text-gray-500">Choose agent configuration and deploy target.</p>
          </div>
          <div className="space-y-4 px-6 py-4">
            {/* Budget */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Initial budget (USD)
              </label>
              <input
                type="number"
                defaultValue={20}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            {/* Billing */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Billing</p>
              <div className="flex gap-2">
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                    billing === "subscription"
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-emerald-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="mock-billing"
                    checked={billing === "subscription"}
                    onChange={() => setBilling("subscription")}
                    className="h-3.5 w-3.5 text-emerald-600"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">Subscription</span>
                    <p className="text-xs text-gray-500">Platform account billing</p>
                  </div>
                </label>
                <label
                  className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                    billing === "api_key"
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-emerald-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="mock-billing"
                    checked={billing === "api_key"}
                    onChange={() => setBilling("api_key")}
                    className="h-3.5 w-3.5 text-emerald-600"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">API Key</span>
                    <p className="text-xs text-gray-500">Direct provider API key</p>
                  </div>
                </label>
              </div>
            </div>
            {/* Deploy Target */}
            <DeployTargetSelector value={target} onChange={setTarget} />
            {/* Agent (collapsed mock) */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Agent configuration</p>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-emerald-400 bg-emerald-50 px-3 py-2.5 cursor-pointer">
              <input type="radio" checked readOnly className="h-4 w-4 text-emerald-600" />
              <div>
                <span className="text-sm font-medium text-gray-900">Claude Code</span>
                <p className="text-xs text-gray-500">claude-code CLI agent</p>
              </div>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 cursor-pointer hover:border-emerald-400">
              <input type="radio" readOnly className="h-4 w-4 text-emerald-600" />
              <div>
                <span className="text-sm font-medium text-gray-900">Codex CLI</span>
                <p className="text-xs text-gray-500">OpenAI Codex CLI agent</p>
              </div>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
            <button className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black">
              Cancel
            </button>
            <button className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800">
              Confirm & launch
            </button>
          </div>
        </div>
      </section>

      {/* ── Section 3: VPS Status Badges ── */}
      <section>
        <SectionTitle>3. VPS Status Badges</SectionTitle>
        <div className="flex flex-wrap gap-3">
          {["provisioning", "ready", "error", "deprovisioning"].map((s) => (
            <VpsStatusBadge key={s} status={s} />
          ))}
        </div>
      </section>

      {/* ── Section 4: Backend Badges ── */}
      <section>
        <SectionTitle>4. Backend Badges (for tables)</SectionTitle>
        <p className="text-xs text-gray-500 mb-3">
          Показываются в ProjectsTable и RunsTable рядом со статусом
        </p>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Full</p>
            <div className="flex flex-wrap gap-3">
              <BackendBadge backend="local" />
              <BackendBadge backend="vps" />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Compact (hover for tooltip)</p>
            <div className="flex flex-wrap gap-3">
              <BackendBadgeCompact backend="local" />
              <BackendBadgeCompact backend="vps" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 5: Project row with backend info ── */}
      <section>
        <SectionTitle>5. Project Row (with backend badge)</SectionTitle>
        <div className="space-y-2">
          {/* local project */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-3 p-4">
              <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-gray-900">AI Task Manager</span>
              </div>
              <span className="mono rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                DEPLOYED
              </span>
              <BackendBadge backend="local" />
              <span className="mono text-xs text-gray-500">claude-code / opus</span>
              <span className="mono text-xs text-gray-500">3 runs</span>
              <button className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white">Relaunch</button>
            </div>
          </div>
          {/* vps project */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-3 p-4">
              <svg className="h-4 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-gray-900">Community Voting App</span>
              </div>
              <span className="mono rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                BUILDING
              </span>
              <BackendBadge backend="vps" />
              <span className="mono text-xs text-gray-500">codex / o3</span>
              <span className="mono text-xs text-gray-500">1 run</span>
              <button className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500">Manage</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 6: Run row with backend info ── */}
      <section>
        <SectionTitle>6. Run Row (with backend info)</SectionTitle>
        <div className="space-y-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                DEPLOYED
              </span>
              <span className="text-sm font-medium text-gray-900">AI Task Manager</span>
              <span className="mono text-[11px] text-gray-500">claude-code / opus</span>
              <BackendBadge backend="local" />
              <span className="mono text-[11px] text-gray-500">12m 34s</span>
              <span className="mono text-[11px] font-medium text-violet-600">$2.41</span>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                RUNNING
              </span>
              <span className="text-sm font-medium text-gray-900">Community Voting App</span>
              <span className="mono text-[11px] text-gray-500">codex / o3</span>
              <BackendBadge backend="vps" />
              <span className="mono text-[11px] text-gray-500">3m 12s</span>
              <span className="mono text-[11px] font-medium text-violet-600">$0.87</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 7: VPS Hosts Tab ── */}
      <section>
        <SectionTitle>7. VPS Hosts Tab (admin panel)</SectionTitle>
        <p className="text-xs text-gray-500 mb-3">
          Новый таб в AdminTabs — управление пулом VPS хостов
        </p>

        {/* Tab bar mock */}
        <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 mb-4">
          {["Seasons", "Proposals", "Projects", "Runs", "VPS Hosts", "Flags"].map((tab) => (
            <button
              key={tab}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                tab === "VPS Hosts"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {tab}
              {tab === "VPS Hosts" && (
                <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-600">2</span>
              )}
            </button>
          ))}
        </div>

        {/* VPS hosts list */}
        <div className="space-y-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">vps-arena-01</span>
                  <VpsStatusBadge status="ready" />
                </div>
                <div className="mono text-xs text-gray-500">203.0.113.21 &middot; Falkenstein &middot; cx22</div>
              </div>
              <div className="text-right">
                <div className="mono text-xs text-gray-500">2 projects</div>
                <div className="mono text-[11px] text-gray-400">uptime 3d 14h</div>
              </div>
              <ContextMenuDots />
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">vps-arena-02</span>
                  <VpsStatusBadge status="provisioning" />
                </div>
                <div className="mono text-xs text-gray-500">— &middot; Helsinki &middot; cx22</div>
              </div>
              <div className="text-right">
                <div className="mono text-xs text-gray-500">0 projects</div>
                <div className="mono text-[11px] text-gray-400">creating...</div>
              </div>
              <ContextMenuDots />
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <button className="flex w-full items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Provision new VPS
            </button>
          </div>
        </div>
      </section>

      {/* ── Section 8: VPS Host Detail (expanded or separate page) ── */}
      <section>
        <SectionTitle>8. VPS Host Detail Card</SectionTitle>
        <div className="max-w-lg rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">vps-arena-01</h3>
              <p className="mono text-xs text-gray-500">id: vps_h8k2m9x3</p>
            </div>
            <VpsStatusBadge status="ready" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">IP</span>
              <p className="mono text-gray-900">203.0.113.21</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Region</span>
              <p className="text-gray-900">Falkenstein (fsn1)</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Server type</span>
              <p className="text-gray-900">cx22 (2 vCPU / 4 GB)</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Preview domain</span>
              <p className="mono text-gray-900">*.vps01.arena.dev</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Uptime</span>
              <p className="text-gray-900">3d 14h 22m</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">SSH key</span>
              <p className="mono text-xs text-gray-900">SHA256:a3f8...e2d1 (encrypted)</p>
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Assigned projects</span>
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="mono rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">DEPLOYED</span>
                <span className="text-sm text-gray-900">AI Task Manager</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="mono rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">BUILDING</span>
                <span className="text-sm text-gray-900">Community Voting App</span>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: "#374151",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 12,
        borderBottom: "1px solid #e5e7eb",
        paddingBottom: 6,
      }}
    >
      {children}
    </h2>
  );
}

// ─── Storybook Meta ─────────────────────────────────────────────────

const meta: Meta = {
  title: "RA-037 VPS / All Drafts",
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "light" },
  },
};

export default meta;
type Story = StoryObj;

export const Overview: Story = {
  render: () => <AllVpsDrafts />,
};

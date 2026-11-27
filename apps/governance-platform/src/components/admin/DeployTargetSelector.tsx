"use client";

/**
 * RA-037 + RA-081: Deploy target selector with VPS server type.
 */

type DeployTarget = "local" | "vps";

const VPS_SERVER_TYPES = [
  { id: "cpx11", label: "CPX11", desc: "2 vCPU / 2 GB" },
  { id: "cpx21", label: "CPX21", desc: "3 vCPU / 4 GB" },
  { id: "cpx31", label: "CPX31", desc: "4 vCPU / 8 GB" },
  { id: "cpx41", label: "CPX41", desc: "8 vCPU / 16 GB" },
  { id: "cpx51", label: "CPX51", desc: "16 vCPU / 32 GB" },
] as const;

export function DeployTargetSelector({
  value,
  onChange,
  serverType,
  onServerTypeChange,
  allowVps = true,
}: {
  value: DeployTarget;
  onChange: (v: DeployTarget) => void;
  serverType?: string;
  onServerTypeChange?: (v: string) => void;
  allowVps?: boolean;
}) {
  const effectiveValue = allowVps ? value : "local";

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        Deploy target
      </p>
      <div className="flex gap-2">
        <label
          className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
            effectiveValue === "local"
              ? "border-emerald-400 bg-emerald-50"
              : "border-gray-200 bg-white hover:border-emerald-400"
          }`}
        >
          <input
            type="radio"
            name="deploy-target"
            checked={effectiveValue === "local"}
            onChange={() => onChange("local")}
            className="h-3.5 w-3.5 text-emerald-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">Local Docker</span>
            <p className="text-xs text-gray-500">Same host as worker-agent</p>
          </div>
        </label>
        {allowVps && (
          <label
            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
              effectiveValue === "vps"
                ? "border-emerald-400 bg-emerald-50"
                : "border-gray-200 bg-white hover:border-emerald-400"
            }`}
          >
            <input
              type="radio"
              name="deploy-target"
              checked={effectiveValue === "vps"}
              onChange={() => onChange("vps")}
              className="h-3.5 w-3.5 text-emerald-600"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">VPS</span>
              <p className="text-xs text-gray-500">Isolated Hetzner VM</p>
            </div>
          </label>
        )}
      </div>
      {allowVps && effectiveValue === "vps" && onServerTypeChange && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Server type
          </label>
          <select
            value={serverType || VPS_SERVER_TYPES[0].id}
            onChange={(e) => onServerTypeChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {VPS_SERVER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} — {t.desc}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createSeason, updateSeason } from "@/app/actions/seasons";
import { getAgentConfigs, getAgentConfig } from "@/lib/agent-labels-shared";

type BuildConfigRow = {
  id?: string; // existing DB id
  agentConfigId: string;
  modelId: string; // model option id within the agent config
};

interface SeasonFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  season?: {
    id: string;
    title: string;
    description: string | null;
    submissionStart: Date | null;
    buildStart: Date | null;
    buildDeadline: Date | null;
    maxWinners: number;
    requiresModeration?: boolean;
    buildConfigs?: Array<{
      id: string;
      agent: string;
      agentImpl: string;
      model: string | null;
      order: number;
    }>;
  };
}

/** Convert a UTC Date (from DB) to a datetime-local string in the user's timezone */
function toDateTimeLocal(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a datetime-local string (user's local time) to an ISO UTC string for the server */
function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatTz(dateStr: string, tz: string, label: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const s = d.toLocaleString("en-GB", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${label} ${s}`;
}

function TimeHints({ value }: { value: string }) {
  if (!value) return null;
  const hints = [
    formatTz(value, "UTC", "UTC"),
    formatTz(value, "Europe/Moscow", "MSK"),
    formatTz(value, "Asia/Bangkok", "BKK"),
  ].filter(Boolean);
  if (hints.length === 0) return null;
  return (
    <div className="mt-1 space-y-px text-[10px] text-gray-500 mono">
      {hints.map((h) => (
        <div key={h}>{h}</div>
      ))}
    </div>
  );
}

/** Resolve a DB BuildConfig record to a UI row (agentConfigId + modelId) */
function dbConfigToRow(bc: { id: string; agent: string; agentImpl: string; model: string | null }): BuildConfigRow {
  const configs = getAgentConfigs();
  for (const ac of configs) {
    if (ac.agent === bc.agent && ac.agentImpl === bc.agentImpl) {
      const modelOpt = bc.model ? ac.models.find((m) => m.model === bc.model) : null;
      return {
        id: bc.id,
        agentConfigId: ac.id,
        modelId: modelOpt?.id ?? ac.defaultModelId,
      };
    }
  }
  const fallback = configs[0];
  return fallback
    ? { id: bc.id, agentConfigId: fallback.id, modelId: fallback.defaultModelId }
    : { id: bc.id, agentConfigId: "", modelId: "" };
}

export function SeasonForm({ open, onOpenChange, season }: SeasonFormProps) {
  const isEditing = !!season;
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(season?.title ?? "");
  const [description, setDescription] = useState(season?.description ?? "");
  const [submissionStart, setSubmissionStart] = useState(toDateTimeLocal(season?.submissionStart ?? null));
  const [buildStart, setBuildStart] = useState(toDateTimeLocal(season?.buildStart ?? null));
  const [buildDeadline, setBuildDeadline] = useState(toDateTimeLocal(season?.buildDeadline ?? null));
  const [maxWinners, setMaxWinners] = useState<number | "">(season?.maxWinners ?? 3);
  const [requiresModeration, setRequiresModeration] = useState(season?.requiresModeration ?? false);
  const [buildConfigs, setBuildConfigs] = useState<BuildConfigRow[]>(
    season?.buildConfigs?.map(dbConfigToRow) ?? [],
  );

  function addBuildConfig() {
    const configs = getAgentConfigs();
    const first = configs[0];
    setBuildConfigs((prev) => [
      ...prev,
      { agentConfigId: first?.id ?? "", modelId: first?.defaultModelId ?? "" },
    ]);
  }

  function removeBuildConfig(index: number) {
    setBuildConfigs((prev) => prev.filter((_, i) => i !== index));
  }

  function updateBuildConfig(index: number, field: "agentConfigId" | "modelId", value: string) {
    setBuildConfigs((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (field === "agentConfigId") {
          const ac = getAgentConfig(value);
          return { ...row, agentConfigId: value, modelId: ac?.defaultModelId ?? "" };
        }
        return { ...row, [field]: value };
      }),
    );
  }

  function handleSubmit() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    startTransition(async () => {
      const configsPayload = buildConfigs.map((row, i) => {
        const ac = getAgentConfig(row.agentConfigId);
        const modelOpt = ac?.models.find((m) => m.id === row.modelId) ?? ac?.models[0];
        return {
          id: row.id,
          agent: ac?.agent ?? "",
          agentImpl: ac?.agentImpl ?? "",
          model: modelOpt?.model ?? "",
          order: i,
        };
      });

      const data = {
        title,
        description: description || null,
        submissionStart: localToIso(submissionStart),
        buildStart: localToIso(buildStart),
        buildDeadline: localToIso(buildDeadline),
        maxWinners: maxWinners || 3,
        requiresModeration,
        buildConfigs: configsPayload,
      };

      const result = isEditing
        ? await updateSeason(season.id, data)
        : await createSeason(data);

      if (result.success) {
        toast.success(isEditing ? "Season updated" : "Season created");
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-gray-200 bg-white">
        <DialogHeader>
          <DialogTitle className="text-gray-900">
            {isEditing ? "Edit Season" : "Create Season"}
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            {isEditing
              ? "Update season details and phase dates."
              : "Set up a new season with open and build phases."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Season 1"
              className="border-gray-200 bg-white text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>

          {/* Phase dates */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Phase dates
            </p>

            <div>
              <label className="mb-1 block text-xs text-gray-500">Open start</label>
              <div className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={submissionStart}
                  onChange={(e) => setSubmissionStart(e.target.value)}
                  className="border-gray-200 bg-white text-gray-900 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setSubmissionStart(toDateTimeLocal(new Date()))}
                  className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900"
                >
                  now
                </button>
              </div>
              <TimeHints value={submissionStart} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Build start</label>
                <Input
                  type="datetime-local"
                  value={buildStart}
                  onChange={(e) => setBuildStart(e.target.value)}
                  className="border-gray-200 bg-white text-gray-900 text-xs"
                />
                <TimeHints value={buildStart} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Build deadline</label>
                <Input
                  type="datetime-local"
                  value={buildDeadline}
                  onChange={(e) => setBuildDeadline(e.target.value)}
                  className="border-gray-200 bg-white text-gray-900 text-xs"
                />
                <TimeHints value={buildDeadline} />
              </div>
            </div>
          </div>

          {/* Max winners + Moderation */}
          <div className="flex items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Max winners
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={maxWinners}
                onChange={(e) => setMaxWinners(e.target.value === "" ? "" : parseInt(e.target.value) || 1)}
                className="w-24 border-gray-200 bg-white text-gray-900"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requiresModeration}
                onChange={(e) => setRequiresModeration(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs font-medium text-gray-600">Require moderation</span>
            </label>
          </div>

          {/* Build Configs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Build configurations
              </p>
              <button
                type="button"
                onClick={addBuildConfig}
                className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900"
              >
                + Add
              </button>
            </div>

            {buildConfigs.length === 0 && (
              <p className="text-xs text-gray-400 italic">
                No build configs. Winners will be marked but not auto-launched.
              </p>
            )}

            {buildConfigs.map((row, i) => {
              const configs = getAgentConfigs();
              const ac = getAgentConfig(row.agentConfigId);
              return (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                  <select
                    value={row.agentConfigId}
                    onChange={(e) => updateBuildConfig(i, "agentConfigId", e.target.value)}
                    className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none"
                  >
                    {configs.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                  <select
                    value={row.modelId}
                    onChange={(e) => updateBuildConfig(i, "modelId", e.target.value)}
                    className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none"
                  >
                    {(ac?.models ?? []).map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeBuildConfig(i)}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    title="Remove"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !title.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending
              ? isEditing ? "Saving..." : "Creating..."
              : isEditing ? "Save" : "Create Season"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

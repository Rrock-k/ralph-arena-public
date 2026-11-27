"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createAccessGrant,
  createProjectAccessGrant,
} from "@/app/actions/access";
import type {
  AccessPresetKey,
  AccessProjectOption,
  AccessScopeType,
  AccessSubjectSummary,
} from "@/lib/access-control/types";
import {
  ACCESS_PRESET_ACCENT_STYLES,
  ACCESS_PRESET_DEFINITIONS,
  ACCESS_PRESET_ORDER,
} from "@/lib/access-control/presets";
import { toast } from "sonner";

interface GrantAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: AccessSubjectSummary[];
  projectOptions?: AccessProjectOption[];
  defaultPresetKey?: AccessPresetKey;
  defaultScopeType?: AccessScopeType;
  defaultProjectId?: string;
  defaultProjectName?: string;
  projectScopedProjectId?: string;
}

export function GrantAccessDialog({
  open,
  onOpenChange,
  subjects,
  projectOptions = [],
  defaultPresetKey,
  defaultScopeType,
  defaultProjectId,
  defaultProjectName,
  projectScopedProjectId,
}: GrantAccessDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [userQuery, setUserQuery] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<AccessPresetKey | null>(defaultPresetKey ?? null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId ?? "");
  const [expiryDate, setExpiryDate] = useState("");
  const [reason, setReason] = useState("");

  const presets = ACCESS_PRESET_ORDER.map((key) => ACCESS_PRESET_DEFINITIONS[key]);
  const selectedSubject = selectedSubjectId
    ? subjects.find((subject) => subject.id === selectedSubjectId) ?? null
    : null;
  const selectedSubjectLabel = selectedSubject
    ? (selectedSubject.name ?? selectedSubject.email ?? selectedSubject.id)
    : "";
  const filteredSubjects = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) {
      return subjects.slice(0, 8);
    }

    return subjects.filter((subject) => {
      const haystack = [
        subject.name ?? "",
        subject.email ?? "",
        subject.id,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    }).slice(0, 8);
  }, [subjects, userQuery]);
  const effectiveScopeType = selectedPreset
    ? (defaultScopeType ?? ACCESS_PRESET_DEFINITIONS[selectedPreset].scopeType)
    : defaultScopeType ?? null;
  const effectiveProjectId = effectiveScopeType === "project"
    ? ((defaultProjectId ?? selectedProjectId) || null)
    : null;
  const selectedProject = effectiveProjectId
    ? projectOptions.find((project) => project.id === effectiveProjectId) ?? null
    : null;
  const hasConcreteProjectScope = Boolean(defaultProjectId || selectedProjectId);
  const scopePreviewLabel = effectiveScopeType === "platform"
    ? "Platform"
    : (defaultProjectName || selectedProject?.name || "Select project");
  const showSubjectResults = userQuery.trim().length > 0 && userQuery.trim() !== selectedSubjectLabel;

  // Filter presets by scope if a default is provided
  const filteredPresets = defaultScopeType
    ? presets.filter((p) => p.scopeType === defaultScopeType)
    : projectScopedProjectId
      ? presets.filter((p) => p.scopeType === "project")
      : presets;

  function handleGrant() {
    if (!selectedSubjectId) {
      toast.error("Select a user");
      return;
    }
    if (!selectedPreset) {
      toast.error("Select a preset");
      return;
    }
    if (!effectiveScopeType) {
      toast.error("Select a scope");
      return;
    }
    if (effectiveScopeType === "project" && !hasConcreteProjectScope) {
      toast.error("Select a project");
      return;
    }

    const scopeType = effectiveScopeType;
    startTransition(async () => {
      const expiryIso = expiryDate
        ? new Date(`${expiryDate}T23:59:59.999`).toISOString()
        : null;
      const result = projectScopedProjectId
        ? await createProjectAccessGrant(projectScopedProjectId, {
          subjectUserId: selectedSubjectId,
          sourcePresetKey: selectedPreset,
          expiresAt: expiryIso,
          reason,
        })
        : await createAccessGrant({
          subjectUserId: selectedSubjectId,
          scopeType,
          scopeId: effectiveProjectId,
          sourcePresetKey: selectedPreset,
          expiresAt: expiryIso,
          reason,
        });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        `Access granted: ${ACCESS_PRESET_DEFINITIONS[selectedPreset].label} for ${selectedSubjectLabel} on ${scopePreviewLabel}`,
      );
      router.refresh();
      onOpenChange(false);
      resetForm();
    });
  }

  function resetForm() {
    setUserQuery("");
    setSelectedSubjectId(null);
    setSelectedPreset(defaultPresetKey ?? null);
    setShowAdvanced(false);
    setSelectedProjectId(defaultProjectId ?? "");
    setExpiryDate("");
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant access</DialogTitle>
          <DialogDescription>
            {defaultProjectName
              ? `Grant access to ${defaultProjectName}`
              : "Select a preset and assign it to a user."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 py-2">
          {/* User search */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
              User
            </label>
            <Input
              placeholder="Search by name, email, or user id..."
              value={userQuery}
              onChange={(e) => {
                setUserQuery(e.target.value);
                if (selectedSubjectId) {
                  setSelectedSubjectId(null);
                }
              }}
            />
            {selectedSubject && !showSubjectResults && (
              <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                Selected: {selectedSubject.name ?? selectedSubject.email ?? selectedSubject.id}
                {selectedSubject.email ? ` · ${selectedSubject.email}` : ""}
              </p>
            )}
            {showSubjectResults && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-slate-700/50 dark:bg-slate-900/80">
                {filteredSubjects.length > 0 ? filteredSubjects.map((subject) => (
                  <button
                    key={subject.id}
                    type="button"
                    onClick={() => {
                      setSelectedSubjectId(subject.id);
                      setUserQuery(subject.name ?? subject.email ?? subject.id);
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-gray-900 dark:text-slate-100">
                        {subject.name ?? subject.email ?? subject.id}
                      </span>
                      <span className="block truncate text-[11px] text-gray-500 dark:text-slate-500">
                        {subject.email ?? subject.id}
                      </span>
                    </span>
                  </button>
                )) : (
                  <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-slate-500">
                    No users match this search.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preset selection */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
              Preset
            </label>
            <div className="grid grid-cols-2 gap-2">
              {filteredPresets.map((preset) => {
                const isSelected = selectedPreset === preset.key;
                const colors = ACCESS_PRESET_ACCENT_STYLES[preset.accent] ?? ACCESS_PRESET_ACCENT_STYLES.slate;

                return (
                  <button
                    key={preset.key}
                    onClick={() => setSelectedPreset(preset.key)}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? `${colors.border} ${colors.bg} ring-1 ${colors.ring}`
                        : "border-gray-200 bg-gray-50 hover:border-gray-300 dark:border-slate-700/50 dark:bg-slate-800/30 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <svg className={`h-3.5 w-3.5 ${colors.text}`} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className={`text-sm font-semibold ${isSelected ? colors.text : "text-gray-900 dark:text-slate-200"}`}>
                        {preset.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-slate-500">
                      {preset.description}
                    </p>
                    {/* Key capabilities preview */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {preset.highlightCapabilities.slice(0, 3).map((cap) => (
                        <span
                          key={cap}
                          className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 font-mono text-[9px] text-gray-500 dark:border-slate-700/30 dark:bg-slate-800/50 dark:text-slate-500"
                        >
                          {cap}
                        </span>
                      ))}
                      {preset.highlightCapabilities.length > 3 && (
                        <span className="text-[9px] text-gray-400 dark:text-slate-600">
                          +{preset.highlightCapabilities.length - 3}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scope */}
          {effectiveScopeType && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                Scope
              </label>
              {effectiveScopeType === "platform" ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-slate-700/50 dark:bg-slate-800/30 dark:text-slate-300">
                  Platform-wide access
                </div>
              ) : defaultProjectName ? (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                  Project: {defaultProjectName}
                </div>
              ) : (
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Select project...</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-300"
          >
            <svg
              className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Advanced: customize capabilities
          </button>

          {showAdvanced && selectedPreset && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700/50 dark:bg-slate-800/30">
              <p className="mb-2 text-[11px] text-gray-500 dark:text-slate-500">
                Capabilities from {ACCESS_PRESET_DEFINITIONS[selectedPreset].label}:
              </p>
              <div className="flex flex-wrap gap-1">
                {ACCESS_PRESET_DEFINITIONS[selectedPreset].capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:border-slate-600/30 dark:bg-slate-700/30 dark:text-slate-400"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Effective access preview */}
          {selectedPreset && effectiveScopeType && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700/50 dark:bg-slate-800/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                    Effective access preview
                  </p>
                  <p className="mt-1 text-sm text-gray-900 dark:text-slate-200">
                    {ACCESS_PRESET_DEFINITIONS[selectedPreset].label}
                  </p>
                </div>
                <span className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-500 dark:border-slate-700/50 dark:bg-slate-900/60 dark:text-slate-400">
                  {effectiveScopeType === "platform" ? "Platform" : scopePreviewLabel}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {ACCESS_PRESET_DEFINITIONS[selectedPreset].capabilities.slice(0, 6).map((cap) => (
                  <span
                    key={cap}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:border-slate-700/50 dark:bg-slate-900/60 dark:text-slate-400"
                  >
                    {cap}
                  </span>
                ))}
                {ACCESS_PRESET_DEFINITIONS[selectedPreset].capabilities.length > 6 && (
                  <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-400 dark:border-slate-700/50 dark:bg-slate-900/60 dark:text-slate-500">
                    +{ACCESS_PRESET_DEFINITIONS[selectedPreset].capabilities.length - 6} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Optional fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                Expires (optional)
              </label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                Reason (optional)
              </label>
              <Input
                placeholder="Why this access?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500"
            onClick={() => { onOpenChange(false); resetForm(); }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleGrant}
            disabled={!selectedSubjectId || !selectedPreset || isPending}
          >
            {isPending ? "Granting..." : "Grant access"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

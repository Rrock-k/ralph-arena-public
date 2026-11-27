"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createAgentLoop,
  updateAgentLoop,
  deleteAgentLoop,
  createAgentLoopVersion,
} from "@/app/actions/registry";
import {
  getLoopSupportLabel,
  normalizeLoopSupportTier,
  type LoopSupportTier,
} from "@/lib/loop-support";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type ComplianceStatus = "pending" | "verified" | "failed";
const LOOP_SUPPORT_OPTIONS: Array<{ value: LoopSupportTier; label: string }> = [
  { value: "supported", label: "supported" },
  { value: "unsupported", label: "unsupported" },
];

interface LoopComplianceCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: "error" | "warning";
}

interface LoopComplianceResult {
  passed: boolean;
  checks: LoopComplianceCheck[];
  detectedCapabilities: string[];
  status: ComplianceStatus;
  checkedAt: string;
  runner?: {
    command: string;
    runnerRoot: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    parseError: string | null;
  };
}

interface AgentLoopVersionData {
  id: string;
  version: string;
  commandTemplate: string;
  capabilities: string[];
  supportTier: LoopSupportTier;
  changelog: string | null;
  createdAt: string;
  complianceStatus: ComplianceStatus | null;
  complianceResult: LoopComplianceResult | null;
  complianceCheckedAt: string | null;
}

interface AgentLoopData {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  visibility: string;
  sourceUrl: string | null;
  installCommand: string | null;
  currentVersionId: string | null;
  currentVersion: AgentLoopVersionData | null;
  versions: AgentLoopVersionData[];
  owner: { id: string; name: string | null; email: string | null } | null;
}

interface LoopsTabProps {
  agentLoops: AgentLoopData[];
}

function getComplianceSummary(version: AgentLoopVersionData) {
  const status: ComplianceStatus = version.complianceStatus
    ?? (version.complianceResult?.passed ? "verified" : version.complianceResult ? "failed" : "pending");
  const result = version.complianceResult;
  const failingChecks = result?.checks.filter((check) => !check.passed) ?? [];
  const errorCount = failingChecks.filter((check) => check.severity === "error").length;
  const warningCount = failingChecks.filter((check) => check.severity === "warning").length;

  let label = "pending";
  if (status === "verified") {
    label = "verified";
  } else if (status === "failed") {
    label = errorCount > 0
      ? `${errorCount} error${errorCount === 1 ? "" : "s"}`
      : "failed";
    if (warningCount > 0) {
      label += `, ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
    }
  }

  const detail = result?.passed
    ? `Compliance checked ${version.complianceCheckedAt ? new Date(version.complianceCheckedAt).toLocaleDateString("en-US") : "recently"}`
    : failingChecks[0]?.message ?? (status === "pending" ? "Awaiting compliance run" : "Compliance failed");

  return { status, label, detail, failingChecks };
}

function getComplianceBadgeClasses(status: ComplianceStatus) {
  switch (status) {
    case "verified":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-300";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300";
  }
}

function getSupportTierBadgeClasses(tier: LoopSupportTier) {
  switch (tier) {
    case "supported":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "unsupported":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/10 dark:text-rose-300";
  }
}

function getNormalizedSupportTier(tier: string | null | undefined): LoopSupportTier {
  return normalizeLoopSupportTier(tier) ?? "unsupported";
}

export function LoopsTab({ agentLoops }: LoopsTabProps) {
  const [editingLoop, setEditingLoop] = useState<AgentLoopData | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [addingVersionTo, setAddingVersionTo] = useState<AgentLoopData | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {agentLoops.length} loop{agentLoops.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          + Add Loop
        </button>
      </div>

      <div className="space-y-2">
        {agentLoops.map((loop) => {
          const isExpanded = expandedId === loop.id;
          return (
            <div
              key={loop.id}
              className="rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : loop.id)}
                      className="text-sm font-medium text-gray-900 hover:text-emerald-600 dark:text-slate-100 dark:hover:text-emerald-400"
                    >
                      {isExpanded ? "▾" : "▸"} {loop.name}
                    </button>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        loop.isActive
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "border border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {loop.isActive ? "active" : "inactive"}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      {loop.visibility}
                    </span>
                  </div>
                  {loop.description && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                      {loop.description}
                    </p>
                  )}
                  {loop.currentVersion && (() => {
                    const currentCompliance = getComplianceSummary(loop.currentVersion);
                    const currentSupportTier = getNormalizedSupportTier(loop.currentVersion.supportTier);
                    return (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 mono dark:text-slate-400">
                      <span>v{loop.currentVersion.version}</span>
                      <span className="text-gray-300 dark:text-slate-600">|</span>
                      <span className="truncate max-w-xs">
                        {loop.currentVersion.commandTemplate}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getComplianceBadgeClasses(currentCompliance.status)}`}
                        title={currentCompliance.detail}
                      >
                        compliance: {currentCompliance.label}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getSupportTierBadgeClasses(currentSupportTier)}`}
                      >
                        support: {getLoopSupportLabel(currentSupportTier)}
                      </span>
                    </div>
                    );
                  })()}
                  {loop.currentVersion && loop.currentVersion.capabilities.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {loop.currentVersion.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700 dark:border-cyan-400/25 dark:bg-cyan-500/10 dark:text-cyan-300"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setAddingVersionTo(loop)}
                    className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-gray-400 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500"
                  >
                    + Version
                  </button>
                  <button
                    onClick={() => setEditingLoop(loop)}
                    className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-gray-400 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* Expanded: version history */}
              {isExpanded && loop.versions.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-3 dark:border-slate-800">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                    Versions ({loop.versions.length})
                  </p>
                  <div className="space-y-1">
                    {loop.versions.map((v) => {
                      const compliance = getComplianceSummary(v);
                      const versionSupportTier = getNormalizedSupportTier(v.supportTier);
                      return (
                        <div
                          key={v.id}
                          className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs ${
                            v.id === loop.currentVersionId
                              ? "bg-emerald-50 dark:bg-emerald-500/10"
                              : "bg-gray-50 dark:bg-slate-800"
                          }`}
                        >
                          <span className="font-medium mono text-gray-900 dark:text-slate-100">
                            v{v.version}
                          </span>
                          {v.id === loop.currentVersionId && (
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                              registry current
                            </span>
                          )}
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${getComplianceBadgeClasses(compliance.status)}`}
                            title={compliance.detail}
                          >
                            {compliance.status}
                          </span>
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${getSupportTierBadgeClasses(versionSupportTier)}`}
                          >
                            {getLoopSupportLabel(versionSupportTier)}
                          </span>
                          <span className="flex-1 truncate text-gray-500 mono dark:text-slate-400">
                            {v.commandTemplate}
                          </span>
                          {v.changelog && (
                            <span className="text-gray-400 dark:text-slate-500" title={v.changelog}>
                              {v.changelog.slice(0, 40)}
                            </span>
                          )}
                          <span className="text-gray-400 dark:text-slate-500">
                            {new Date(v.createdAt).toLocaleDateString("en-US")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isCreateOpen && (
        <LoopFormDialog onClose={() => setIsCreateOpen(false)} mode="create" />
      )}
      {editingLoop && (
        <LoopFormDialog
          loop={editingLoop}
          onClose={() => setEditingLoop(null)}
          mode="edit"
        />
      )}
      {addingVersionTo && (
        <VersionFormDialog
          loop={addingVersionTo}
          onClose={() => setAddingVersionTo(null)}
        />
      )}
    </div>
  );
}

function LoopFormDialog({
  loop,
  onClose,
  mode,
}: {
  loop?: AgentLoopData;
  onClose: () => void;
  mode: "create" | "edit";
}) {
  const [name, setName] = useState(loop?.name ?? "");
  const [description, setDescription] = useState(loop?.description ?? "");
  const [isActive, setIsActive] = useState(loop?.isActive ?? true);
  const [visibility, setVisibility] = useState(loop?.visibility ?? "public");
  const [sourceUrl, setSourceUrl] = useState(loop?.sourceUrl ?? "");
  const [installCommand, setInstallCommand] = useState(loop?.installCommand ?? "");
  // For create: also collect initial version
  const [version, setVersion] = useState("1.0.0");
  const [commandTemplate, setCommandTemplate] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [supportTier, setSupportTier] = useState<LoopSupportTier | "">("");
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const selectedSupportTier = normalizeLoopSupportTier(supportTier);
      if (mode === "create" && commandTemplate.trim() && !selectedSupportTier) {
        toast.error("Support tier is required");
        return;
      }

      if (mode === "create") {
        const result = await createAgentLoop({
          name: name.trim(),
          description: description.trim() || null,
          isActive,
          visibility,
          sourceUrl: sourceUrl.trim() || null,
          installCommand: installCommand.trim() || null,
          initialVersion: commandTemplate.trim()
            ? {
                version: version.trim(),
                commandTemplate: commandTemplate.trim(),
                capabilities: capabilities
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                supportTier: selectedSupportTier!,
              }
            : undefined,
          });
        if (result.success) {
          const complianceStatus = (result as any).complianceStatus as ComplianceStatus | undefined;
          if (complianceStatus === "failed") {
            toast.error("Agent loop created, but the initial version failed compliance");
          } else {
            toast.success("Agent loop created");
          }
          onClose();
        } else {
          toast.error((result as any).error || "Failed");
        }
      } else {
        const result = await updateAgentLoop(loop!.id, {
          name: name.trim(),
          description: description.trim() || null,
          isActive,
          visibility,
          sourceUrl: sourceUrl.trim() || null,
          installCommand: installCommand.trim() || null,
        });
        if (result.success) {
          toast.success("Agent loop updated");
          onClose();
        } else {
          toast.error((result as any).error || "Failed");
        }
      }
    });
  };

  const handleDelete = () => {
    if (!loop) return;
    startTransition(async () => {
      const result = await deleteAgentLoop(loop.id);
      if (result.success) {
        toast.success("Agent loop deleted");
        onClose();
      } else {
        toast.error((result as any).error || "Failed to delete");
      }
    });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-slate-100">
            {mode === "create" ? "Create Agent Loop" : `Edit: ${loop?.name}`}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="direct"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded text-emerald-600"
              />
              <span className="text-sm text-gray-700 dark:text-slate-300">Active</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-slate-400">Visibility:</span>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Source URL (optional)
            </label>
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="https://github.com/..."
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Install Command (optional)
            </label>
            <input
              value={installCommand}
              onChange={(e) => setInstallCommand(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="npm ci && npm run build"
            />
          </div>

          {mode === "create" && (
            <>
              <hr className="border-gray-200 dark:border-slate-700" />
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Initial version (optional)
              </p>
              <div className="flex gap-2">
                <div className="w-24">
                  <input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    placeholder="1.0.0"
                  />
                </div>
                <div className="flex-1">
                  <input
                    value={capabilities}
                    onChange={(e) => setCapabilities(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    placeholder="specs, community_qa"
                  />
                </div>
              </div>
              <div>
                <input
                  value={commandTemplate}
                  onChange={(e) => setCommandTemplate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="node /arena/cycles/direct.js --agent {agent} ..."
                />
              </div>
              <div>
                <select
                  value={supportTier}
                  onChange={(e) => setSupportTier(e.target.value as LoopSupportTier | "")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Select support tier</option>
                  {LOOP_SUPPORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {mode === "edit" && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="mr-auto rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !name.trim() || (mode === "create" && !!commandTemplate.trim() && !supportTier)}
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-70 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionFormDialog({
  loop,
  onClose,
}: {
  loop: AgentLoopData;
  onClose: () => void;
}) {
  const currentPinnedVersion = loop.currentVersion?.version ?? "0.0.0";
  const [version, setVersion] = useState(() => {
    // Auto-increment patch
    const parts = currentPinnedVersion.split(".");
    if (parts.length === 3) {
      parts[2] = String(Number(parts[2]) + 1);
      return parts.join(".");
    }
    return currentPinnedVersion;
  });
  const [commandTemplate, setCommandTemplate] = useState(
    loop.currentVersion?.commandTemplate ?? ""
  );
  const [capabilities, setCapabilities] = useState(
    loop.currentVersion?.capabilities.join(", ") ?? ""
  );
  const [supportTier, setSupportTier] = useState<LoopSupportTier | "">(
    normalizeLoopSupportTier(loop.currentVersion?.supportTier) ?? ""
  );
  const [changelog, setChangelog] = useState("");
  const [setAsCurrent, setSetAsCurrent] = useState(true);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const selectedSupportTier = normalizeLoopSupportTier(supportTier);
      if (!selectedSupportTier) {
        toast.error("Support tier is required");
        return;
      }

      const result = await createAgentLoopVersion(loop.id, {
        version: version.trim(),
        commandTemplate: commandTemplate.trim(),
        capabilities: capabilities
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        supportTier: selectedSupportTier,
        changelog: changelog.trim() || null,
        setAsCurrent,
      });
      if (result.success) {
        const complianceStatus = (result as any).complianceStatus as ComplianceStatus | undefined;
        if (complianceStatus === "failed") {
          toast.error(`Version ${version} created, but compliance failed`);
        } else {
          toast.success(`Version ${version} created`);
        }
        onClose();
      } else {
        toast.error((result as any).error || "Failed");
      }
    });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-slate-100">
            New version for &ldquo;{loop.name}&rdquo;
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Version
            </label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="1.1.0"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Command template
            </label>
            <input
              value={commandTemplate}
              onChange={(e) => setCommandTemplate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Capabilities (comma-separated)
            </label>
            <input
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="specs, community_qa, messages"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Support tier
            </label>
            <select
              value={supportTier}
              onChange={(e) => setSupportTier(e.target.value as LoopSupportTier | "")}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Select support tier</option>
              {LOOP_SUPPORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Changelog
            </label>
            <textarea
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={setAsCurrent}
              onChange={(e) => setSetAsCurrent(e.target.checked)}
              className="h-4 w-4 rounded text-emerald-600"
            />
            <span className="text-sm text-gray-700 dark:text-slate-300">
              Set as current version
            </span>
          </label>
        </DialogBody>

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !version.trim() || !commandTemplate.trim() || !supportTier}
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-70 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            {isPending ? "Creating..." : "Create version"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

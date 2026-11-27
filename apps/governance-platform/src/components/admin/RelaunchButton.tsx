"use client";

import { relaunchProject, relaunchProjectWithOverrides } from "@/app/actions/relaunch";
import { useState } from "react";
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
import { DeployTargetSelector } from "./DeployTargetSelector";
import {
  getLoopActionBlockMessage,
  resolveLoopSupport,
} from "@/lib/loop-support";
import {
  resolveDefaultLoopId,
  resolveDefaultModelId,
  resolveDefaultToolId,
} from "@/lib/launch-defaults";
import { isToolVisibleForLaunch } from "@/lib/agent-runtime-support";
import type {
  ProjectFacingAgentLoop,
  ProjectFacingLoopToolMapping as LoopToolMapping,
} from "@/lib/project-facing-agent-loops";

interface ModelOption {
  id: string;
  label: string;
  model: string;
  envOverrides?: Record<string, string>;
}

interface ToolData {
  id: string;
  name: string;
  description: string | null;
  models: string | null;
  defaultModelId: string | null;
  isActive: boolean;
}

interface RelaunchButtonProps {
  projectId: string;
  currentAgent?: string;
  currentAgentImpl?: string;
  currentModel?: string | null;
  currentClaudeAuthMode?: string | null;
  currentCodexAuthMode?: string | null;
  currentRunnerBackend?: string | null;
  tools: ToolData[];
  agentLoops: ProjectFacingAgentLoop[];
  simpleMode?: boolean;
  allowCookieAutoconfirm?: boolean;
  allowPlatformCredentials?: boolean;
  allowManagedVps?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
  currentProviderBillingMode?: string | null;
}

function parseModels(raw: string | null): ModelOption[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function deriveAuthOverride(agent?: string, claudeMode?: string | null, codexMode?: string | null): "subscription" | "api_key" {
  if (agent === "claude-code") return claudeMode === "api_key" ? "api_key" : "subscription";
  return codexMode === "api_key" ? "api_key" : "subscription";
}

type ProviderBillingMode = "byok" | "platform_credits" | "platform_credentials";

function normalizeProviderBillingMode(value: string | null | undefined): ProviderBillingMode {
  if (value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return "byok";
}

export function RelaunchButton({
  projectId,
  currentAgent,
  currentAgentImpl,
  currentModel,
  currentClaudeAuthMode,
  currentCodexAuthMode,
  currentRunnerBackend,
  tools,
  agentLoops,
  simpleMode = false,
  allowCookieAutoconfirm = false,
  allowPlatformCredentials = false,
  allowManagedVps = false,
  userProviderCredentialsEnabled = true,
  managedProviderCreditsEnabled = false,
  currentProviderBillingMode = "byok",
}: RelaunchButtonProps) {
  const providerBillingMode = normalizeProviderBillingMode(currentProviderBillingMode);
  const isPlatformCreditsProject = providerBillingMode === "platform_credits";
  const providerLaunchBlocked = !allowPlatformCredentials
    && (currentAgent === "codex" || currentAgent === "claude-code")
    && (
      isPlatformCreditsProject
        ? !managedProviderCreditsEnabled
        : providerBillingMode === "platform_credentials" || !userProviderCredentialsEnabled
    );
  const activeLoops = agentLoops.filter((l) => l.isActive && l.currentVersion);
  const initialLoopId = activeLoops.find((l) => l.name === currentAgentImpl)?.id
    ?? resolveDefaultLoopId(activeLoops);

  const [isLaunching, setIsLaunching] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLoopId, setSelectedLoopId] = useState(initialLoopId);
  const [selectedToolId, setSelectedToolId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [authOverride, setAuthOverride] = useState<"subscription" | "api_key">(
    allowPlatformCredentials
      ? deriveAuthOverride(currentAgent, currentClaudeAuthMode, currentCodexAuthMode)
      : "api_key",
  );
  const [deployTarget, setDeployTarget] = useState<"local" | "vps">(
    allowManagedVps && currentRunnerBackend === "vps" ? "vps" : "local",
  );

  const selectedLoop = activeLoops.find((l) => l.id === selectedLoopId);
  const selectedVersion = selectedLoop?.currentVersion ?? null;
  const selectedLoopSupport = selectedLoop && selectedVersion
    ? resolveLoopSupport({
      agentImpl: selectedLoop.name,
      loopName: selectedLoop.name,
      loopVersion: selectedVersion.version,
      supportTier: selectedVersion.supportTier,
      useRepoHead: true,
      hasLoopVersion: true,
    })
    : null;
  const relaunchBlockReason = selectedLoopSupport
    ? getLoopActionBlockMessage(selectedLoopSupport, "relaunch")
    : null;
  const availableToolMappings = selectedLoop?.loopTools ?? [];
  const availableTools = availableToolMappings
    .map((lt) => {
      const tool = tools.find((t) => t.id === lt.toolId && t.isActive);
      return tool ? { tool, mapping: lt } : null;
    })
    .filter((x): x is { tool: ToolData; mapping: LoopToolMapping } => (
      x !== null && isToolVisibleForLaunch(x.tool.name, { allowPlatformCredentials })
    ));

  const effectiveToolId = availableTools.some((t) => t.tool.id === selectedToolId)
    ? selectedToolId
    : resolveDefaultToolId(availableTools, currentAgent);

  const selectedToolEntry = availableTools.find((t) => t.tool.id === effectiveToolId);
  const selectedTool = selectedToolEntry?.tool;
  const effectiveAuthOverride = isPlatformCreditsProject
    ? "api_key"
    : allowPlatformCredentials ? authOverride : "api_key";
  const effectiveProviderBillingMode: ProviderBillingMode = isPlatformCreditsProject
    ? "platform_credits"
    : allowPlatformCredentials ? "platform_credentials" : providerBillingMode;
  const effectiveClaudeAuthMode = effectiveProviderBillingMode === "platform_credits"
    ? null
    : effectiveAuthOverride === "api_key" ? "api_key" : "oauth";
  const effectiveCodexAuthMode = effectiveProviderBillingMode === "platform_credits"
    ? null
    : effectiveAuthOverride;
  const effectiveDeployTarget = allowManagedVps ? deployTarget : "local";
  const models = selectedToolEntry
    ? parseModels(selectedToolEntry.mapping.models ?? selectedToolEntry.tool.models)
    : [];

  const effectiveModelId = resolveDefaultModelId({
    models,
    selectedModelId,
    currentModel,
    defaultModelId: selectedTool?.defaultModelId,
  });

  const handleLoopChange = (loopId: string) => {
    setSelectedLoopId(loopId);
    setSelectedToolId("");
    setSelectedModelId("");
  };

  const handleToolChange = (toolId: string) => {
    setSelectedToolId(toolId);
    setSelectedModelId("");
  };

  const handleConfirmLaunch = async () => {
    if (simpleMode) {
      setIsLaunching(true);
      toast.loading("Queueing relaunch...");

      const result = await relaunchProject(projectId);

      toast.dismiss();

      if (!result.success) {
        toast.error(result.error || "Failed to relaunch");
        setIsLaunching(false);
      } else {
        toast.success("Run queued. Runtime will start shortly.");
      }
      return;
    }

    if (!selectedTool || !selectedVersion || !selectedLoop) return;
    if (relaunchBlockReason) {
      toast.error(relaunchBlockReason);
      return;
    }

    setIsLaunching(true);
    setIsDialogOpen(false);
    toast.loading("Queueing relaunch...");

    const modelOption = models.find((m) => m.id === effectiveModelId) ?? models[0];
    const isClaude = selectedTool.name === "claude-code";

    const result = await relaunchProjectWithOverrides(projectId, {
      agent: selectedTool.name,
      agentImpl: selectedLoop.name,
      model: modelOption?.model ?? null,
      envOverrides: modelOption?.envOverrides ?? null,
      claudeAuthMode: isClaude ? effectiveClaudeAuthMode : null,
      codexAuthMode: !isClaude ? effectiveCodexAuthMode : null,
      runnerBackend: effectiveDeployTarget,
      toolId: selectedTool.id,
      providerBillingMode: effectiveProviderBillingMode,
    });

    toast.dismiss();

    if (!result.success) {
      toast.error(result.error || "Failed to relaunch");
      setIsLaunching(false);
    } else {
      toast.success("Run queued. Agent will start shortly.");
    }
  };

  const handleRelaunchClick = () => {
    if (providerLaunchBlocked) {
      toast.error(isPlatformCreditsProject ? "Platform Credits provider runs are disabled." : "User provider API-key launches are disabled.");
      return;
    }
    if (simpleMode) {
      void handleConfirmLaunch();
      return;
    }
    if (
      allowCookieAutoconfirm &&
      process.env.NODE_ENV !== "production" &&
      typeof document !== "undefined" &&
      document.cookie.includes("e2e_relaunch_autoconfirm=1")
    ) {
      void handleConfirmLaunch();
      return;
    }
    setIsDialogOpen(true);
  };

  return (
    <>
      <button
        onClick={handleRelaunchClick}
        disabled={isLaunching || providerLaunchBlocked}
        className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
      >
        {isLaunching ? "Launching..." : "Relaunch"}
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md h-[85dvh] border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-slate-100">Relaunch project</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-slate-400">
              Create a new run for this project using its current specs.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                {allowPlatformCredentials || isPlatformCreditsProject ? "Billing" : "Provider auth"}
              </p>
              {isPlatformCreditsProject ? (
                <div className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Uses Platform Credits budget.
                </div>
              ) : allowPlatformCredentials ? (
                <div className="flex gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" name="relaunch-auth" checked={authOverride === "subscription"} onChange={() => setAuthOverride("subscription")} className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-xs text-gray-800 dark:text-slate-200">Subscription</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" name="relaunch-auth" checked={effectiveAuthOverride === "api_key"} onChange={() => setAuthOverride("api_key")} className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-xs text-gray-800 dark:text-slate-200">API Key</span>
                  </label>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Uses your provider API key from Settings.
                </div>
              )}
            </div>
            {allowManagedVps && (
              <DeployTargetSelector
                value={effectiveDeployTarget}
                onChange={setDeployTarget}
                allowVps
              />
            )}

            {/* 1. Agent Loop */}
            <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Agent Loop</p></div>
            {activeLoops.map((loop) => (
              <div key={loop.id}>
                <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${selectedLoopId === loop.id ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10" : "border-gray-200 bg-white hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"}`}>
                  <input type="radio" name="relaunch-loop" value={loop.id} checked={selectedLoopId === loop.id} onChange={() => handleLoopChange(loop.id)} className="h-4 w-4 text-emerald-600" />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{loop.name}</span>
                    {loop.description && <p className="text-xs text-gray-500 dark:text-slate-400">{loop.description}</p>}
                  </div>
                </label>
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: selectedLoopId === loop.id && loop.currentVersion ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="ml-7 mt-1 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                          Bundled default
                        </span>
                        {selectedVersion && selectedVersion.capabilities.length > 0 && (
                          <div className="flex gap-1">
                            {selectedVersion.capabilities.map((cap) => (
                              <span key={cap} className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[9px] text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400">{cap}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {selectedVersion?.changelog && (
                        <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">{selectedVersion.changelog}</p>
                      )}
                      {selectedLoopSupport?.supportLabel && (
                        <p className="mt-1 text-[10px] text-gray-500 dark:text-slate-400">
                          support: {selectedLoopSupport.supportLabel}
                        </p>
                      )}
                      {selectedLoopSupport?.supportHint && (
                        <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-300">{selectedLoopSupport.supportHint}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
                        Relaunch always uses the current bundled default runtime. Version history stays in the registry.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {relaunchBlockReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                {relaunchBlockReason}
              </div>
            )}

            {/* 2. Tool (filtered) */}
            {availableTools.length > 0 && (
              <>
                <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Tool</p></div>
                {availableTools.map(({ tool }) => {
                  const isSelected = effectiveToolId === tool.id;
                  return (
                    <div key={tool.id}>
                      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${isSelected ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10" : "border-gray-200 bg-white hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"}`}>
                        <input type="radio" name="relaunch-tool" value={tool.id} checked={isSelected} onChange={() => handleToolChange(tool.id)} className="h-4 w-4 text-emerald-600" />
                        <div>
                          <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{tool.name}</span>
                          {tool.description && <p className="text-xs text-gray-500 dark:text-slate-400">{tool.description}</p>}
                        </div>
                      </label>
                      {isSelected && models.length > 1 && (
                        <div className="ml-7 mt-1 mb-1 space-y-1">
                          {models.map((model) => (
                            <label key={model.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${effectiveModelId === model.id ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10" : "border-gray-200 bg-gray-50 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-500"}`}>
                              <input type="radio" name="relaunch-model" value={model.id} checked={effectiveModelId === model.id} onChange={() => setSelectedModelId(model.id)} className="h-3.5 w-3.5 text-emerald-600" />
                              <span className="text-xs font-medium text-gray-800 dark:text-slate-200">{model.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {availableTools.length === 0 && selectedLoop && (
              <p className="text-xs text-rose-500">No tools configured for this loop.</p>
            )}
          </DialogBody>

          <DialogFooter>
            <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100" onClick={() => setIsDialogOpen(false)} disabled={isLaunching}>Cancel</button>
            <button type="button" className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400" onClick={handleConfirmLaunch} disabled={isLaunching || !selectedTool || !selectedVersion || Boolean(relaunchBlockReason)}>Confirm & relaunch</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

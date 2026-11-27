"use client";

import { launchProposal } from "@/app/actions/launch";
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
import { RepoSourceSelector } from "./RepoSourceSelector";
import {
  getLoopActionBlockMessage,
  resolveLoopSupport,
} from "@/lib/loop-support";
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

interface LaunchButtonProps {
  proposalId: string;
  tools: ToolData[];
  agentLoops: ProjectFacingAgentLoop[];
}

function parseModels(raw: string | null): ModelOption[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function LaunchButton({ proposalId, tools, agentLoops }: LaunchButtonProps) {
  const activeLoops = agentLoops.filter((l) => l.isActive && l.currentVersion);

  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLoopId, setSelectedLoopId] = useState(activeLoops[0]?.id ?? "");
  const [selectedToolId, setSelectedToolId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [budgetLimitEnabled, setBudgetLimitEnabled] = useState(false);
  const [initialBudget, setInitialBudget] = useState("20");
  const [authOverride, setAuthOverride] = useState<"subscription" | "api_key">("subscription");
  const [deployTarget, setDeployTarget] = useState<"local" | "vps">("local");
  const [repoSource, setRepoSource] = useState<"fresh" | "custom">("fresh");
  const [customRepoUrl, setCustomRepoUrl] = useState("");
  const [customBranch, setCustomBranch] = useState("");

  // Derive selected loop and version
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
  const launchBlockReason = selectedLoopSupport
    ? getLoopActionBlockMessage(selectedLoopSupport, "launch")
    : null;
  const availableToolMappings = selectedLoop?.loopTools ?? [];
  const availableTools = availableToolMappings
    .map((lt) => {
      const tool = tools.find((t) => t.id === lt.toolId && t.isActive);
      return tool ? { tool, mapping: lt } : null;
    })
    .filter((x): x is { tool: ToolData; mapping: LoopToolMapping } => x !== null);

  // Auto-select default tool when loop changes
  const effectiveToolId = availableTools.some((t) => t.tool.id === selectedToolId)
    ? selectedToolId
    : (availableTools.find((t) => t.mapping.isDefault)?.tool.id ?? availableTools[0]?.tool.id ?? "");

  const selectedToolEntry = availableTools.find((t) => t.tool.id === effectiveToolId);
  const selectedTool = selectedToolEntry?.tool;

  // Models: use mapping override if present, otherwise all from tool
  const models = selectedToolEntry
    ? parseModels(selectedToolEntry.mapping.models ?? selectedToolEntry.tool.models)
    : [];

  const effectiveModelId = models.some((m) => m.id === selectedModelId)
    ? selectedModelId
    : (selectedTool?.defaultModelId ?? models[0]?.id ?? "");

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
    if (!selectedTool || !selectedVersion || !selectedLoop) return;
    if (launchBlockReason) {
      toast.error(launchBlockReason);
      return;
    }

    setIsLaunching(true);
    setError(null);
    setIsDialogOpen(false);
    toast.loading("Queueing autonomous run...");

    const modelOption = models.find((m) => m.id === effectiveModelId) ?? models[0];
    const initialBudgetUsd = budgetLimitEnabled ? Number(initialBudget) : null;
    const isClaude = selectedTool.name === "claude-code";

    const result = await launchProposal(proposalId, {
      agent: selectedTool.name,
      agentImpl: selectedLoop.name,
      model: modelOption?.model ?? null,
      envOverrides: modelOption?.envOverrides ?? null,
      initialBudgetUsd,
      claudeAuthMode: isClaude ? (authOverride === "api_key" ? "api_key" : "oauth") : null,
      codexAuthMode: !isClaude ? authOverride : null,
      runnerBackend: deployTarget,
      toolId: selectedTool.id,
      providerBillingMode: authOverride === "api_key" ? "byok" : "platform_credentials",
      ...(customRepoUrl.trim() ? { repoUrl: customRepoUrl.trim() } : {}),
      ...(customBranch.trim() ? { repoBranch: customBranch.trim() } : {}),
    });

    toast.dismiss();

    if (!result.success) {
      const errorMsg = result.error || "Failed to launch";
      setError(errorMsg);
      toast.error(errorMsg);
      setIsLaunching(false);
    } else {
      toast.success("Run queued. Runner will start the selected agent shortly.");
    }
  };

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsDialogOpen(true)}
        disabled={isLaunching}
        className="w-full rounded-lg bg-black px-4 py-2 text-sm font-bold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
      >
        {isLaunching ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Launching...
          </span>
        ) : (
          "Launch Build"
        )}
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md h-[85dvh] border-gray-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Launch proposal build</DialogTitle>
            <DialogDescription className="text-gray-600">
              Choose agent loop, tool, and model for this build.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            <div className="rounded-lg border border-gray-200 px-3 py-2">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                <input
                  type="checkbox"
                  checked={budgetLimitEnabled}
                  onChange={(e) => setBudgetLimitEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 text-emerald-600"
                />
                Limit budget
              </label>
              {budgetLimitEnabled ? (
                <input
                  type="number"
                  step="0.01"
                  min="0.11"
                  value={initialBudget}
                  onChange={(e) => setInitialBudget(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="20.00"
                />
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  Admin/operator launches are unlimited unless a budget limit is explicitly enabled.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Billing
              </p>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="launch-auth"
                    checked={authOverride === "subscription"}
                    onChange={() => setAuthOverride("subscription")}
                    className="h-3.5 w-3.5 text-emerald-600"
                  />
                  <span className="text-xs text-gray-800">Subscription</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="launch-auth"
                    checked={authOverride === "api_key"}
                    onChange={() => setAuthOverride("api_key")}
                    className="h-3.5 w-3.5 text-emerald-600"
                  />
                  <span className="text-xs text-gray-800">API Key</span>
                </label>
              </div>
            </div>
            <DeployTargetSelector value={deployTarget} onChange={setDeployTarget} />

            <RepoSourceSelector
              value={repoSource}
              onChange={setRepoSource}
              repoUrl={customRepoUrl}
              onRepoUrlChange={setCustomRepoUrl}
              branch={customBranch}
              onBranchChange={setCustomBranch}
            />

            {/* 1. Agent Loop selection */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Agent Loop
              </p>
            </div>
            {activeLoops.map((loop) => (
              <div key={loop.id}>
                <label
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                    selectedLoopId === loop.id
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-emerald-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="launch-loop"
                    value={loop.id}
                    checked={selectedLoopId === loop.id}
                    onChange={() => handleLoopChange(loop.id)}
                    className="h-4 w-4 text-emerald-600"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">{loop.name}</span>
                    {loop.description && (
                      <p className="text-xs text-gray-500">{loop.description}</p>
                    )}
                  </div>
                </label>
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: selectedLoopId === loop.id && loop.currentVersion ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="ml-7 mt-1 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Bundled default
                        </span>
                        {selectedVersion && selectedVersion.capabilities.length > 0 && (
                          <div className="flex gap-1">
                            {selectedVersion.capabilities.map((cap) => (
                              <span
                                key={cap}
                                className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[9px] text-cyan-700"
                              >
                                {cap}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {selectedVersion?.changelog && (
                        <p className="mt-0.5 text-[10px] text-gray-400">{selectedVersion.changelog}</p>
                      )}
                      {selectedLoopSupport?.supportLabel && (
                        <p className="mt-1 text-[10px] text-gray-500">
                          support: {selectedLoopSupport.supportLabel}
                        </p>
                      )}
                      {selectedLoopSupport?.supportHint && (
                        <p className="mt-0.5 text-[10px] text-amber-600">{selectedLoopSupport.supportHint}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        Launch always uses the current bundled default runtime. Version history stays in the registry.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {launchBlockReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {launchBlockReason}
              </div>
            )}

            {/* 2. Tool selection (filtered by selected loop) */}
            {availableTools.length > 0 && (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Tool
                  </p>
                </div>
                {availableTools.map(({ tool }) => {
                  const isSelected = effectiveToolId === tool.id;
                  return (
                    <div key={tool.id}>
                      <label
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                          isSelected
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-gray-200 bg-white hover:border-emerald-400"
                        }`}
                      >
                        <input
                          type="radio"
                          name="launch-tool"
                          value={tool.id}
                          checked={isSelected}
                          onChange={() => handleToolChange(tool.id)}
                          className="h-4 w-4 text-emerald-600"
                        />
                        <div>
                          <span className="text-sm font-medium text-gray-900">{tool.name}</span>
                          {tool.description && (
                            <p className="text-xs text-gray-500">{tool.description}</p>
                          )}
                        </div>
                      </label>
                      {isSelected && models.length > 1 && (
                        <div className="ml-7 mt-1 mb-1 space-y-1">
                          {models.map((model) => (
                            <label
                              key={model.id}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer transition-colors ${
                                effectiveModelId === model.id
                                  ? "border-emerald-400 bg-emerald-50"
                                  : "border-gray-200 bg-gray-50 hover:border-emerald-400"
                              }`}
                            >
                              <input
                                type="radio"
                                name="launch-model"
                                value={model.id}
                                checked={effectiveModelId === model.id}
                                onChange={() => setSelectedModelId(model.id)}
                                className="h-3.5 w-3.5 text-emerald-600"
                              />
                              <span className="text-xs font-medium text-gray-800">{model.label}</span>
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
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black"
              onClick={() => setIsDialogOpen(false)}
              disabled={isLaunching}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleConfirmLaunch}
              disabled={isLaunching || !initialBudget || !selectedTool || !selectedVersion || Boolean(launchBlockReason)}
            >
              Confirm & launch
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <p className="mt-2 text-xs text-rose-600 sm:text-sm">{error}</p>
      )}
    </div>
  );
}

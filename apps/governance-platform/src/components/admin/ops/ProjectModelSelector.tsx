"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProjectRuntimeSystem } from "@/app/actions/project-settings";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";
import { resolveDefaultModelId } from "@/lib/launch-defaults";

type ModelOption = {
  id: string;
  label: string;
  model: string;
};

type ToolData = {
  id: string;
  name: string;
  models: unknown;
  defaultModelId?: string | null;
  isActive?: boolean;
};

type ProviderBillingMode = "byok" | "platform_credits" | "platform_credentials";

function parseModels(raw: unknown): ModelOption[] {
  const parsed = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? safeJsonParse(raw)
      : [];
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const model = typeof record.model === "string" ? record.model.trim() : "";
    if (!model) return [];
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : model;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : model;
    return [{ id, label, model }];
  });
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function normalizeProviderBillingMode(value: string | null | undefined): ProviderBillingMode {
  if (value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return "byok";
}

function formatToolLabel(toolName: string): string {
  if (toolName === "claude-code") return "Claude Code";
  if (toolName === "codex") return "Codex";
  if (toolName === "opencode") return "OpenCode";
  return toolName;
}

function resolveRuntimeOptions(input: {
  agentImpl: string;
  tools: ToolData[];
  agentLoops: ProjectFacingAgentLoop[];
}): { tool: ToolData; models: ModelOption[] }[] {
  const loop = input.agentLoops.find((entry) => entry.name === input.agentImpl && entry.isActive);
  if (!loop) return [];
  return loop.loopTools.flatMap((mapping) => {
    const tool = input.tools.find((candidate) => candidate.id === mapping.toolId);
    if (!tool || tool.isActive === false) return [];
    return [{
      tool,
      models: parseModels(mapping.models ?? tool.models),
    }];
  });
}

function authModesForSelection(agent: string, billingMode: ProviderBillingMode) {
  if (agent === "opencode") {
    return { claudeAuthMode: null, codexAuthMode: null };
  }
  if (billingMode === "platform_credits") {
    return { claudeAuthMode: null, codexAuthMode: null };
  }
  if (agent === "claude-code") {
    return {
      claudeAuthMode: billingMode === "platform_credentials" ? "oauth" : "api_key",
      codexAuthMode: null,
    };
  }
  if (agent === "codex") {
    return {
      claudeAuthMode: null,
      codexAuthMode: billingMode === "platform_credentials" ? "subscription" : "api_key",
    };
  }
  return { claudeAuthMode: null, codexAuthMode: null };
}

export function ProjectRuntimeSystemSelector({
  projectId,
  agent,
  agentImpl,
  currentModel,
  currentToolId,
  currentProviderBillingMode,
  allowPlatformCredentials,
  tools,
  agentLoops,
  disabled,
}: {
  projectId: string;
  agent: string;
  agentImpl: string;
  currentModel?: string | null;
  currentToolId?: string | null;
  currentProviderBillingMode?: string | null;
  allowPlatformCredentials?: boolean;
  tools: ToolData[];
  agentLoops: ProjectFacingAgentLoop[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [selectedToolId, setSelectedToolId] = useState(currentToolId ?? "");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [billingMode, setBillingMode] = useState<ProviderBillingMode>(
    normalizeProviderBillingMode(currentProviderBillingMode),
  );
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    setSelectedToolId(currentToolId ?? "");
    setSelectedModelId("");
    setBillingMode(normalizeProviderBillingMode(currentProviderBillingMode));
  }, [currentProviderBillingMode, currentToolId]);

  const runtimeOptions = useMemo(() => resolveRuntimeOptions({
    agentImpl,
    tools,
    agentLoops,
  }), [agentImpl, agentLoops, tools]);
  const currentToolOption = runtimeOptions.find((option) => (
    (currentToolId && option.tool.id === currentToolId) || option.tool.name === agent
  ));
  const selectedToolOption = runtimeOptions.find((option) => option.tool.id === selectedToolId)
    ?? currentToolOption
    ?? runtimeOptions[0]
    ?? null;
  const models = selectedToolOption?.models ?? [];
  const effectiveModelId = resolveDefaultModelId({
    models,
    selectedModelId,
    currentModel: selectedToolOption?.tool.name === agent ? currentModel : null,
    defaultModelId: selectedToolOption?.tool.defaultModelId,
  });
  const selectedModel = models.find((option) => option.id === effectiveModelId) ?? models[0] ?? null;
  const normalizedCurrentBillingMode = normalizeProviderBillingMode(currentProviderBillingMode);
  const billingOptions: ProviderBillingMode[] = [
    "byok",
    ...(allowPlatformCredentials ? ["platform_credentials" as const] : []),
    ...(normalizedCurrentBillingMode === "platform_credits" ? ["platform_credits" as const] : []),
  ];
  const effectiveBillingMode = billingOptions.includes(billingMode)
    ? billingMode
    : billingOptions[0] ?? "byok";
  const canSelect = runtimeOptions.length > 0;
  const selectionChanged =
    selectedToolOption?.tool.name !== agent
    || selectedToolOption?.tool.id !== currentToolId
    || (selectedModel?.model ?? null) !== (currentModel ?? null)
    || effectiveBillingMode !== normalizedCurrentBillingMode;

  if (!canSelect) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">System</span>
          <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {agent}/{agentImpl}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Model</span>
          <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {currentModel ?? "\u2014"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">System</span>
        <select
          value={selectedToolOption?.tool.id ?? ""}
          disabled={disabled || pending}
          title={disabled ? "Cannot switch runtime system while agent work is running" : "Runtime system for future claims"}
          onChange={(event) => {
            setSelectedToolId(event.target.value);
            setSelectedModelId("");
          }}
          className="max-w-[180px] rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          {runtimeOptions.map((option) => (
            <option key={option.tool.id} value={option.tool.id}>
              {formatToolLabel(option.tool.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Model</span>
        {models.length > 0 ? (
          <select
            value={effectiveModelId}
            disabled={disabled || pending}
            title={disabled ? "Cannot switch model while agent work is running" : "Model for future runtime claims"}
            onChange={(event) => setSelectedModelId(event.target.value)}
            className="max-w-[180px] rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {currentModel && !models.some((option) => option.model === currentModel) && (
              <option value={currentModel}>{currentModel} (current)</option>
            )}
            {models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {currentModel ?? "\u2014"}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Billing</span>
        <select
          value={effectiveBillingMode}
          disabled={disabled || pending || billingOptions.length < 2}
          title={disabled ? "Cannot switch billing while agent work is running" : "Provider billing mode for future claims"}
          onChange={(event) => setBillingMode(event.target.value as ProviderBillingMode)}
          className="max-w-[180px] rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          {billingOptions.map((option) => (
            <option key={option} value={option}>
              {option === "platform_credentials" ? "Platform credentials" : option === "platform_credits" ? "Platform Credits" : "BYOK"}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={disabled || pending || !selectedToolOption || !selectionChanged}
          onClick={() => {
            if (!selectedToolOption) return;
            const authModes = authModesForSelection(selectedToolOption.tool.name, effectiveBillingMode);
            const previousToolId = selectedToolId;
            const previousModelId = selectedModelId;
            const previousBillingMode = billingMode;
            startTransition(async () => {
              const result = await setProjectRuntimeSystem(projectId, {
                agent: selectedToolOption.tool.name,
                agentImpl,
                model: selectedModel?.model ?? null,
                toolId: selectedToolOption.tool.id,
                providerBillingMode: effectiveBillingMode,
                claudeAuthMode: authModes.claudeAuthMode,
                codexAuthMode: authModes.codexAuthMode,
              });
              if (!result.success) {
                setSelectedToolId(previousToolId);
                setSelectedModelId(previousModelId);
                setBillingMode(previousBillingMode);
                toast.error(result.error ?? "Failed to update runtime system");
                return;
              }
              toast.success("Runtime system updated for future runs");
              router.refresh();
            });
          }}
          className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          {pending ? "Saving..." : "Apply"}
        </button>
      </div>
    </div>
  );
}

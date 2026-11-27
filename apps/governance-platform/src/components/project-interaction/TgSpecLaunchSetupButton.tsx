"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeployTargetSelector } from "@/components/admin/DeployTargetSelector";
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

type ModelOption = {
  id: string;
  label: string;
  model: string;
  envOverrides?: Record<string, string>;
};

type ToolData = {
  id: string;
  name: string;
  description: string | null;
  models: string | null;
  defaultModelId: string | null;
  isActive: boolean;
};

type ProviderBillingMode = "byok" | "platform_credits" | "platform_credentials";

const PROVIDER_BILLING_LABELS: Record<ProviderBillingMode, string> = {
  platform_credentials: "Админская подписка",
  platform_credits: "Arena Credits",
  byok: "BYOK API key",
};

type TgSpecLaunchSetupButtonProps = {
  projectId: string;
  hasAcceptedSpec: boolean;
  currentAgent?: string;
  currentAgentImpl?: string;
  currentModel?: string | null;
  tools: ToolData[];
  agentLoops: ProjectFacingAgentLoop[];
  allowPlatformCredentials: boolean;
  allowManagedVps: boolean;
  userProviderCredentialsEnabled: boolean;
  managedProviderCreditsEnabled: boolean;
  userCreditBalance: number;
  preferDefaultLaunchConfiguration?: boolean;
};

function parseModels(raw: string | null): ModelOption[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export function TgSpecLaunchSetupButton({
  projectId,
  hasAcceptedSpec,
  currentAgent,
  currentAgentImpl,
  currentModel,
  tools,
  agentLoops,
  allowPlatformCredentials,
  allowManagedVps,
  userProviderCredentialsEnabled,
  managedProviderCreditsEnabled,
  userCreditBalance,
  preferDefaultLaunchConfiguration = false,
}: TgSpecLaunchSetupButtonProps) {
  const router = useRouter();
  const activeLoops = useMemo(
    () => agentLoops.filter((loop) => loop.isActive && loop.currentVersion),
    [agentLoops],
  );
  const initialLoopId = preferDefaultLaunchConfiguration
    ? resolveDefaultLoopId(activeLoops)
    : activeLoops.find((loop) => loop.name === currentAgentImpl)?.id
      ?? resolveDefaultLoopId(activeLoops);
  const defaultProviderBillingMode: ProviderBillingMode = allowPlatformCredentials
    ? "platform_credentials"
    : managedProviderCreditsEnabled ? "platform_credits" : "byok";

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLoopId, setSelectedLoopId] = useState(initialLoopId);
  const [selectedToolId, setSelectedToolId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [deployTarget, setDeployTarget] = useState<"local" | "vps">("local");
  const [providerBillingMode, setProviderBillingMode] = useState<ProviderBillingMode>(
    defaultProviderBillingMode,
  );
  const [initialBudget, setInitialBudget] = useState("5");

  const selectedLoop = activeLoops.find((loop) => loop.id === selectedLoopId);
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
    .map((mapping) => {
      const tool = tools.find((entry) => entry.id === mapping.toolId && entry.isActive);
      return tool ? { tool, mapping } : null;
    })
    .filter((entry): entry is { tool: ToolData; mapping: LoopToolMapping } => (
      entry !== null && isToolVisibleForLaunch(entry.tool.name, { allowPlatformCredentials })
    ));
  const effectiveToolId = availableTools.some((entry) => entry.tool.id === selectedToolId)
    ? selectedToolId
    : resolveDefaultToolId(availableTools, currentAgent);
  const selectedToolEntry = availableTools.find((entry) => entry.tool.id === effectiveToolId);
  const selectedTool = selectedToolEntry?.tool ?? null;
  const models = selectedToolEntry
    ? parseModels(selectedToolEntry.mapping.models ?? selectedToolEntry.tool.models)
    : [];
  const effectiveModelId = resolveDefaultModelId({
    models,
    selectedModelId,
    currentModel,
    defaultModelId: selectedTool?.defaultModelId,
  });
  const providerBillingOptions: ProviderBillingMode[] = [
    ...(allowPlatformCredentials ? ["platform_credentials" as const] : []),
    ...(managedProviderCreditsEnabled ? ["platform_credits" as const] : []),
    ...(userProviderCredentialsEnabled ? ["byok" as const] : []),
  ];
  const effectiveProviderBillingMode: ProviderBillingMode = providerBillingOptions.includes(providerBillingMode)
    ? providerBillingMode
    : defaultProviderBillingMode;
  const usingPlatformCredits = effectiveProviderBillingMode === "platform_credits";
  const effectiveClaudeAuthMode = effectiveProviderBillingMode === "platform_credits"
    ? null
    : effectiveProviderBillingMode === "platform_credentials" ? "oauth" : "api_key";
  const effectiveCodexAuthMode = effectiveProviderBillingMode === "platform_credits"
    ? null
    : effectiveProviderBillingMode === "platform_credentials" ? "subscription" : "api_key";
  const effectiveDeployTarget = allowManagedVps ? deployTarget : "local";

  const handleLoopChange = (loopId: string) => {
    setSelectedLoopId(loopId);
    setSelectedToolId("");
    setSelectedModelId("");
  };

  const handleToolChange = (toolId: string) => {
    setSelectedToolId(toolId);
    setSelectedModelId("");
  };

  const handleSubmit = async () => {
    if (!selectedTool || !selectedLoop || !selectedVersion) return;
    if (launchBlockReason) {
      toast.error(launchBlockReason);
      return;
    }

    const budgetUsd = Number(initialBudget);
    if (usingPlatformCredits) {
      if (!Number.isFinite(budgetUsd) || budgetUsd < 0.11) {
        toast.error("Бюджет Arena Credits должен быть не меньше $0.11.");
        return;
      }
      if (budgetUsd > userCreditBalance) {
        toast.error("Недостаточно Arena Credits. Пополните баланс в настройках.");
        return;
      }
    }

    const modelOption = models.find((model) => model.id === effectiveModelId) ?? models[0] ?? null;
    const isClaude = selectedTool.name === "claude-code";
    setSubmitting(true);
    toast.loading(hasAcceptedSpec ? "Настраиваю запуск..." : "Сохраняю настройки запуска...");

    try {
      await postJson(`/api/projects/${encodeURIComponent(projectId)}/launch/configure`, {
        agent: selectedTool.name,
        agentImpl: selectedLoop.name,
        model: modelOption?.model ?? null,
        envOverrides: modelOption?.envOverrides ?? null,
        claudeAuthMode: isClaude ? effectiveClaudeAuthMode : null,
        codexAuthMode: !isClaude ? effectiveCodexAuthMode : null,
        runnerBackend: effectiveDeployTarget,
        toolId: selectedTool.id,
        providerBillingMode: effectiveProviderBillingMode,
        initialBudgetUsd: usingPlatformCredits ? budgetUsd : null,
      });

      if (hasAcceptedSpec) {
        toast.dismiss();
        toast.loading("Запускаю проект...");
        await postJson(`/api/projects/${encodeURIComponent(projectId)}/launch/start`);
        toast.dismiss();
        toast.success("Проект поставлен в запуск.");
      } else {
        toast.dismiss();
        toast.success("Настройки сохранены. Проект можно будет запустить после первой принятой спеки.");
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.dismiss();
      toast.error(error instanceof Error ? error.message : "Не удалось настроить запуск.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={submitting}
        className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
      >
        {submitting ? "Запускаю..." : "Настроить запуск"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[85dvh] max-w-2xl border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-slate-100">Запуск проекта</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-slate-400">
              Оплата, бюджет и агент для работы Ralph.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                {allowPlatformCredentials || managedProviderCreditsEnabled ? "Оплата" : "Доступ к модели"}
              </p>
              {providerBillingOptions.length > 1 ? (
                <div className="flex flex-wrap gap-3 rounded-lg border border-gray-300 px-3 py-2 dark:border-slate-700">
                  {providerBillingOptions.map((mode) => (
                    <label key={mode} className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-800 dark:text-slate-200">
                      <input type="radio" name="tg-launch-billing" checked={effectiveProviderBillingMode === mode} onChange={() => setProviderBillingMode(mode)} className="h-3.5 w-3.5 text-emerald-600" />
                      {PROVIDER_BILLING_LABELS[mode]}
                    </label>
                  ))}
                </div>
              ) : effectiveProviderBillingMode === "platform_credentials" ? (
                <div className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-slate-700 dark:text-slate-300">
                  Будет использоваться админская OAuth-подписка.
                </div>
              ) : usingPlatformCredits ? (
                <div className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-slate-700 dark:text-slate-300">
                  Будет использоваться баланс Arena Credits.
                </div>
              ) : (
                <div className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-500 dark:border-slate-700 dark:text-slate-300">
                  Будет использоваться BYOK API key из настроек.
                </div>
              )}
            </div>

            {usingPlatformCredits && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                  Бюджет
                </span>
                <input
                  type="number"
                  min="0.11"
                  step="0.01"
                  value={initialBudget}
                  onChange={(event) => setInitialBudget(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <span className="mt-1 block text-[11px] text-gray-500 dark:text-slate-400">
                  Доступно: ${userCreditBalance.toFixed(2)}
                </span>
              </label>
            )}

            {allowManagedVps && (
              <DeployTargetSelector value={effectiveDeployTarget} onChange={setDeployTarget} allowVps />
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                Режим Ralph
              </p>
              <div className="space-y-2">
                {activeLoops.map((loop) => (
                  <label key={loop.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${selectedLoopId === loop.id ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10" : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
                    <input type="radio" name="tg-launch-loop" checked={selectedLoopId === loop.id} onChange={() => handleLoopChange(loop.id)} className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{loop.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {availableTools.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                  Агент
                </p>
                <div className="space-y-2">
                  {availableTools.map(({ tool }) => (
                    <div key={tool.id}>
                      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${effectiveToolId === tool.id ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10" : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
                        <input type="radio" name="tg-launch-tool" checked={effectiveToolId === tool.id} onChange={() => handleToolChange(tool.id)} className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{tool.name}</span>
                      </label>
                      {effectiveToolId === tool.id && models.length > 1 && (
                        <div className="ml-7 mt-1 space-y-1">
                          {models.map((model) => (
                            <label key={model.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 ${effectiveModelId === model.id ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10" : "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800"}`}>
                              <input type="radio" name="tg-launch-model" checked={effectiveModelId === model.id} onChange={() => setSelectedModelId(model.id)} className="h-3.5 w-3.5 text-emerald-600" />
                              <span className="text-xs text-gray-800 dark:text-slate-200">{model.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {launchBlockReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                {launchBlockReason}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <button type="button" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300" onClick={() => setOpen(false)} disabled={submitting}>
              Отмена
            </button>
            <button type="button" className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400" onClick={handleSubmit} disabled={submitting || !selectedTool || !selectedVersion || Boolean(launchBlockReason)}>
              {hasAcceptedSpec ? "Настроить и запустить" : "Сохранить настройки"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

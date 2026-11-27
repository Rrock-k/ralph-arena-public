"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPersonalAgentProject,
  createPersonalRecipeProject,
  createPersonalTgSpecProject,
} from "@/app/actions/projects";
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
import { RepoSourceSelector } from "@/components/admin/RepoSourceSelector";
import { getProjectRecipe } from "@/lib/project-recipes";
import {
  getLoopActionBlockMessage,
  resolveLoopSupport,
} from "@/lib/loop-support";
import {
  resolveDefaultLoopId,
  resolveDefaultModelId,
  resolveDefaultToolId,
} from "@/lib/launch-defaults";
import { PROJECT_ADDONS, type ProjectAddonId } from "@/lib/project-addons";
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

interface ProposalOption {
  id: string;
  title: string;
}

interface CreateProjectButtonProps {
  tools: ToolData[];
  agentLoops: ProjectFacingAgentLoop[];
  proposals?: ProposalOption[];
  className?: string;
  label?: string;
  postCreateBehavior?: "open-project" | "stay";
  onCreated?: (projectId: string) => void;
  allowPlatformCredentials?: boolean;
  allowManagedVps?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
  userCreditBalance?: number;
}

type CreateMode = "agent_project" | "tg_spec_target" | "simple_web" | "openclaw";
type UserProviderBillingMode = "byok" | "platform_credits";
type EffectiveProviderBillingMode = UserProviderBillingMode | "platform_credentials";

function parseModels(raw: string | null): ModelOption[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function CreateProjectButton({
  tools,
  agentLoops,
  proposals = [],
  className,
  label = "+ New Project",
  postCreateBehavior = "open-project",
  onCreated,
  allowPlatformCredentials = false,
  allowManagedVps = false,
  userProviderCredentialsEnabled = true,
  managedProviderCreditsEnabled = false,
  userCreditBalance = 0,
}: CreateProjectButtonProps) {
  const router = useRouter();
  const simpleWebRecipe = getProjectRecipe("simple_web");
  const openclawRecipe = getProjectRecipe("openclaw");
  const providerAgentLaunchOptionsEnabled =
    allowPlatformCredentials || userProviderCredentialsEnabled || managedProviderCreditsEnabled;
  const directByokRecipeOptionsEnabled = allowPlatformCredentials || userProviderCredentialsEnabled;
  const defaultProviderBillingMode: UserProviderBillingMode =
    managedProviderCreditsEnabled && !userProviderCredentialsEnabled ? "platform_credits" : "byok";
  const activeLoops = useMemo(
    () => agentLoops.filter((loop) => loop.isActive && loop.currentVersion),
    [agentLoops],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<CreateMode>(
    providerAgentLaunchOptionsEnabled ? "agent_project" : "simple_web",
  );
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [budgetLimitEnabled, setBudgetLimitEnabled] = useState(false);
  const [initialBudget, setInitialBudget] = useState("20");
  const [authOverride, setAuthOverride] = useState<"subscription" | "api_key">(
    allowPlatformCredentials ? "subscription" : "api_key",
  );
  const [providerBillingMode, setProviderBillingMode] = useState<UserProviderBillingMode>(
    defaultProviderBillingMode,
  );
  const [deployTarget, setDeployTarget] = useState<"local" | "vps">("local");
  const [selectedLoopId, setSelectedLoopId] = useState(resolveDefaultLoopId(activeLoops));
  const [repoSource, setRepoSource] = useState<"fresh" | "custom">("fresh");
  const [customRepoUrl, setCustomRepoUrl] = useState("");
  const [customBranch, setCustomBranch] = useState("");
  const [selectedToolId, setSelectedToolId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedProposalId, setSelectedProposalId] = useState("");
  const [selectedAddonIds, setSelectedAddonIds] = useState<ProjectAddonId[]>([]);
  const [addonSecretValues, setAddonSecretValues] = useState<Record<string, string>>({});

  const isAgentDrivenProject = selectedRecipe === "agent_project" || selectedRecipe === "tg_spec_target";
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
    : resolveDefaultToolId(availableTools);

  const selectedToolEntry = availableTools.find((entry) => entry.tool.id === effectiveToolId);
  const selectedTool = selectedToolEntry?.tool;
  const userProviderBillingMode =
    providerBillingMode === "byok" && !userProviderCredentialsEnabled && managedProviderCreditsEnabled
      ? "platform_credits"
      : providerBillingMode;
  const effectiveProviderBillingMode: EffectiveProviderBillingMode = allowPlatformCredentials
    ? "platform_credentials"
    : userProviderBillingMode;
  const effectiveAuthOverride = allowPlatformCredentials ? authOverride : "api_key";
  const effectiveClaudeAuthMode = effectiveProviderBillingMode === "platform_credits"
    ? null
    : effectiveAuthOverride === "api_key" ? "api_key" : "oauth";
  const effectiveCodexAuthMode = effectiveProviderBillingMode === "platform_credits"
    ? null
    : effectiveAuthOverride;
  const effectiveDeployTarget = allowManagedVps ? deployTarget : "local";
  const modelOptions = selectedToolEntry
    ? parseModels(selectedToolEntry.mapping.models ?? selectedToolEntry.tool.models)
    : [];
  const effectiveModelId = resolveDefaultModelId({
    models: modelOptions,
    selectedModelId,
    defaultModelId: selectedTool?.defaultModelId,
  });
  const selectedAddons = isAgentDrivenProject
    ? PROJECT_ADDONS.filter((addon) => selectedAddonIds.includes(addon.id))
    : [];
  const selectedAddonRequiredSecrets = selectedAddons.flatMap((addon) => addon.requiredSecrets);
  const missingAddonRequiredSecrets = selectedAddonRequiredSecrets.filter((secret) => (
    secret.blocking !== false && !addonSecretValues[secret.key]?.trim()
  ));

  const handleLoopChange = (loopId: string) => {
    setSelectedLoopId(loopId);
    setSelectedToolId("");
    setSelectedModelId("");
  };

  const handleToolChange = (toolId: string) => {
    setSelectedToolId(toolId);
    setSelectedModelId("");
  };

  const toggleAddon = (addonId: ProjectAddonId) => {
    setSelectedAddonIds((current) => (
      current.includes(addonId)
        ? current.filter((id) => id !== addonId)
        : [...current, addonId]
    ));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    let result:
      | Awaited<ReturnType<typeof createPersonalAgentProject>>
      | Awaited<ReturnType<typeof createPersonalTgSpecProject>>
      | Awaited<ReturnType<typeof createPersonalRecipeProject>>;

    if (selectedRecipe === "agent_project" || selectedRecipe === "tg_spec_target") {
      if (!providerAgentLaunchOptionsEnabled) {
        toast.error("User provider API-key launches are disabled.");
        setIsSubmitting(false);
        return;
      }
      if (!selectedVersion || !selectedLoop || !selectedTool) {
        toast.error("Choose an agent loop and tool");
        setIsSubmitting(false);
        return;
      }
      if (launchBlockReason) {
        toast.error(launchBlockReason);
        setIsSubmitting(false);
        return;
      }
      if (missingAddonRequiredSecrets.length > 0) {
        toast.error(`Add required secret: ${missingAddonRequiredSecrets[0].key}`);
        setIsSubmitting(false);
        return;
      }
      const usingPlatformCredits = !allowPlatformCredentials && effectiveProviderBillingMode === "platform_credits";
      const platformCreditBudgetUsd = Number(initialBudget);
      const initialBudgetUsd = usingPlatformCredits
        ? platformCreditBudgetUsd
        : budgetLimitEnabled ? Number(initialBudget) : null;
      if (usingPlatformCredits) {
        if (!Number.isFinite(platformCreditBudgetUsd) || platformCreditBudgetUsd < 0.11) {
          toast.error("Platform Credits budget must be at least $0.11.");
          setIsSubmitting(false);
          return;
        }
        if (platformCreditBudgetUsd > userCreditBalance) {
          toast.error("Not enough credits. Buy credits in Settings first.");
          setIsSubmitting(false);
          return;
        }
      }

      const selectedModel = modelOptions.find((entry) => entry.id === effectiveModelId) ?? modelOptions[0] ?? null;
      const isClaude = selectedTool.name === "claude-code";
      const selectedAddonSecretValues = Object.fromEntries(
        selectedAddonRequiredSecrets
          .map((secret) => [secret.key, addonSecretValues[secret.key]?.trim() ?? ""] as const)
          .filter(([, value]) => value),
      );
      const agentProjectInput = {
        name,
        initialBudgetUsd,
        agent: selectedTool.name,
        agentImpl: selectedLoop.name,
        model: selectedModel?.model ?? null,
        envOverrides: selectedModel?.envOverrides ?? null,
        claudeAuthMode: isClaude ? effectiveClaudeAuthMode : null,
        codexAuthMode: !isClaude ? effectiveCodexAuthMode : null,
        runnerBackend: effectiveDeployTarget,
        toolId: selectedTool.id,
        providerBillingMode: effectiveProviderBillingMode,
        proposalId: selectedProposalId || null,
        ...(customRepoUrl.trim() ? { repoUrl: customRepoUrl.trim() } : {}),
        ...(customBranch.trim() ? { repoBranch: customBranch.trim() } : {}),
        ...(selectedAddonIds.length > 0
          ? {
              addonIds: selectedAddonIds,
              addonSecretValues: selectedAddonSecretValues,
            }
          : {}),
      };

      result = selectedRecipe === "agent_project"
        ? await createPersonalAgentProject({
          ...agentProjectInput,
          spec,
        })
        : await createPersonalTgSpecProject(agentProjectInput);
    } else {
      if (selectedRecipe === "openclaw" && !directByokRecipeOptionsEnabled) {
        toast.error("User provider API-key launches are disabled.");
        setIsSubmitting(false);
        return;
      }
      result = await createPersonalRecipeProject({
        recipeId: selectedRecipe,
        name,
        initialBudgetUsd: budgetLimitEnabled ? Number(initialBudget) : null,
        runnerBackend: effectiveDeployTarget,
      });
    }

    setIsSubmitting(false);

    if (!result.success) {
      toast.error(result.error || "Failed to create project");
      return;
    }

    toast.success(
      selectedRecipe === "simple_web"
        ? "Simple web project created."
        : selectedRecipe === "openclaw"
          ? "OpenClaw project created. Add required secrets to start it."
          : selectedRecipe === "tg_spec_target"
            ? "TG-spec target created. It will start after the first imported spec."
            : "Project created",
    );
    setIsOpen(false);
    onCreated?.(result.projectId);
    if (postCreateBehavior === "open-project") {
      router.push(`/my/projects/${result.projectId}`);
    }
    router.refresh();
  };

  const usingPlatformCredits =
    isAgentDrivenProject
    && !allowPlatformCredentials
    && effectiveProviderBillingMode === "platform_credits";
  const canChooseUserBillingMode =
    !allowPlatformCredentials
    && managedProviderCreditsEnabled
    && userProviderCredentialsEnabled;
  const budgetLimitControl = (
    <div>
      {usingPlatformCredits ? (
        <>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Platform Credits budget
          </label>
          <input
            type="number"
            min="0.11"
            max={userCreditBalance}
            step="0.01"
            value={initialBudget}
            onChange={(event) => setInitialBudget(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            Available: ${userCreditBalance.toFixed(2)}
          </p>
        </>
      ) : (
        <>
          <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={budgetLimitEnabled}
              onChange={(event) => setBudgetLimitEnabled(event.target.checked)}
              className="h-3.5 w-3.5 text-emerald-600"
            />
            Budget limit
          </label>
          {budgetLimitEnabled ? (
            <input
              type="number"
              min="0.11"
              step="0.01"
              value={initialBudget}
              onChange={(event) => setInitialBudget(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          ) : (
            <div className="flex min-h-[42px] items-center rounded-lg border border-gray-300 px-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Unlimited by default for admin/operator-created projects.
            </div>
          )}
        </>
      )}
    </div>
  );
  const canSubmit =
    !!name.trim() &&
    (usingPlatformCredits || !budgetLimitEnabled || !!initialBudget.trim()) &&
    (!usingPlatformCredits || !!initialBudget.trim()) &&
    (
      selectedRecipe === "simple_web"
      || (selectedRecipe === "openclaw" && directByokRecipeOptionsEnabled)
      || (
        providerAgentLaunchOptionsEnabled
        &&
        isAgentDrivenProject
        && !!selectedLoop
        && !!selectedTool
        && !launchBlockReason
        && missingAddonRequiredSecrets.length === 0
        && (selectedRecipe === "tg_spec_target" || !!spec.trim())
      )
    );
  const recipeGridClass = directByokRecipeOptionsEnabled
    ? "sm:grid-cols-4"
    : providerAgentLaunchOptionsEnabled ? "sm:grid-cols-3" : "sm:grid-cols-1";

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={className ?? "rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-gray-800 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"}
      >
        {label}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl h-[85dvh] border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-slate-100">Create Project</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-slate-400">
              Start a private runtime project. Some project types launch immediately, while tg-spec targets wait for their first imported spec.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                What would you like to create?
              </p>
              <div className={`grid gap-2 ${recipeGridClass}`}>
                {providerAgentLaunchOptionsEnabled && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedRecipe("agent_project")}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        selectedRecipe === "agent_project"
                          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                          : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Agent Project</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        Spec-driven project with an agent loop under the hood.
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedRecipe("tg_spec_target")}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        selectedRecipe === "tg_spec_target"
                          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                          : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">TG-Spec Target</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        Empty execution project that wakes up when Evolution pushes the first accepted spec.
                      </div>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRecipe("simple_web")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    selectedRecipe === "simple_web"
                      ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                      : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Simple Web Template</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    Minimal preview-ready web service to validate recipe-backed runtime projects.
                  </div>
                </button>
                {directByokRecipeOptionsEnabled && (
                  <button
                    type="button"
                    onClick={() => setSelectedRecipe("openclaw")}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                      selectedRecipe === "openclaw"
                        ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                        : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">OpenClaw Template</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                      Personal assistant with a built-in Control UI and optional Telegram bot channel.
                    </div>
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Project name
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My private agent project"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            {proposals.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Proposal (optional)
                </label>
                <select
                  value={selectedProposalId}
                  onChange={(event) => setSelectedProposalId(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">None (private project)</option>
                  {proposals.map((proposal) => (
                    <option key={proposal.id} value={proposal.id}>
                      {proposal.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedRecipe === "simple_web" && (
              <>
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <div className="text-sm font-semibold text-sky-900 dark:text-sky-200">
                    {simpleWebRecipe.title}
                  </div>
                  <p className="mt-1 text-xs text-sky-800 dark:text-sky-300">
                    {simpleWebRecipe.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sky-900 dark:text-sky-200">
                    <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-sky-500/30 dark:bg-slate-900">
                      no required secrets
                    </span>
                    <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-sky-500/30 dark:bg-slate-900">
                      preview on port 3000
                    </span>
                    <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-sky-500/30 dark:bg-slate-900">
                      /health endpoint
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {budgetLimitControl}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      First launch
                    </p>
                    <div className="flex h-[42px] items-center rounded-lg border border-gray-300 px-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      Project is provisioned immediately after create. No extra setup is required.
                    </div>
                  </div>
                </div>

                {allowManagedVps && (
                  <DeployTargetSelector
                    value={effectiveDeployTarget}
                    onChange={setDeployTarget}
                    allowVps
                  />
                )}
              </>
            )}

            {selectedRecipe === "openclaw" && (
              <>
                <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10">
                  <div className="text-sm font-semibold text-fuchsia-900 dark:text-fuchsia-200">
                    {openclawRecipe.title}
                  </div>
                  <p className="mt-1 text-xs text-fuchsia-800 dark:text-fuchsia-300">
                    {openclawRecipe.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fuchsia-900 dark:text-fuchsia-200">
                    <span className="rounded-full border border-fuchsia-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-fuchsia-500/30 dark:bg-slate-900">
                      requires password + OpenAI key
                    </span>
                    <span className="rounded-full border border-fuchsia-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-fuchsia-500/30 dark:bg-slate-900">
                      preview on port 3000
                    </span>
                    <span className="rounded-full border border-fuchsia-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-fuchsia-500/30 dark:bg-slate-900">
                      optional Telegram bot
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {budgetLimitControl}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      First launch
                    </p>
                    <div className="flex h-[42px] items-center rounded-lg border border-gray-300 px-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      Project starts paused until you provide the required secrets on the project page.
                    </div>
                  </div>
                </div>

                {allowManagedVps && (
                  <DeployTargetSelector
                    value={effectiveDeployTarget}
                    onChange={setDeployTarget}
                    allowVps
                  />
                )}
              </>
            )}

            {(selectedRecipe === "agent_project" || selectedRecipe === "tg_spec_target") && (
              <>
                {selectedRecipe === "agent_project" ? (
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Initial spec
                    </label>
                    <textarea
                      value={spec}
                      onChange={(event) => setSpec(event.target.value)}
                      placeholder="Describe what the agent should build or change..."
                      rows={8}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    This project starts without a local spec. Bind it to a `tg-spec` project and the first accepted spec will be imported automatically.
                  </div>
                )}

                <RepoSourceSelector
                  value={repoSource}
                  onChange={setRepoSource}
                  repoUrl={customRepoUrl}
                  onRepoUrlChange={setCustomRepoUrl}
                  branch={customBranch}
                  onBranchChange={setCustomBranch}
                />

                {isAgentDrivenProject && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Add-ons
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {PROJECT_ADDONS.map((addon) => {
                        const checked = selectedAddonIds.includes(addon.id);
                        return (
                          <label
                            key={addon.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                              checked
                                ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                                : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAddon(addon.id)}
                              className="mt-0.5 h-4 w-4 text-emerald-600"
                            />
                            <span>
                              <span className="block text-sm font-semibold text-gray-900 dark:text-slate-100">
                                {addon.label}
                              </span>
                              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-slate-400">
                                {addon.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {selectedAddonRequiredSecrets.length > 0 && (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          Required add-on secrets
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                          {selectedAddonRequiredSecrets.map((secret) => (
                            <label key={secret.key} className="block">
                              <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-slate-300">
                                {secret.key}
                              </span>
                              <input
                                type="password"
                                value={addonSecretValues[secret.key] ?? ""}
                                onChange={(event) => setAddonSecretValues((current) => ({
                                  ...current,
                                  [secret.key]: event.target.value,
                                }))}
                                placeholder={secret.description ?? "Secret value"}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                              />
                              {secret.description && (
                                <span className="mt-1 block text-[11px] leading-4 text-gray-500 dark:text-slate-400">
                                  Stored encrypted as a project secret.
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  {budgetLimitControl}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      {allowPlatformCredentials || managedProviderCreditsEnabled ? "Billing" : "Provider auth"}
                    </p>
                    {allowPlatformCredentials ? (
                      <div className="flex h-[42px] items-center gap-4 rounded-lg border border-gray-300 px-3 dark:border-slate-700 dark:bg-slate-800">
                        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-slate-300">
                          <input
                            type="radio"
                            name="project-auth"
                            checked={authOverride === "subscription"}
                            onChange={() => setAuthOverride("subscription")}
                            className="h-3.5 w-3.5 text-emerald-600"
                          />
                          Subscription
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-slate-300">
                          <input
                            type="radio"
                            name="project-auth"
                            checked={effectiveAuthOverride === "api_key"}
                            onChange={() => setAuthOverride("api_key")}
                            className="h-3.5 w-3.5 text-emerald-600"
                          />
                          API Key
                        </label>
                      </div>
                    ) : canChooseUserBillingMode ? (
                      <div className="flex h-[42px] items-center gap-4 rounded-lg border border-gray-300 px-3 dark:border-slate-700 dark:bg-slate-800">
                        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-slate-300">
                          <input
                            type="radio"
                            name="provider-billing-mode"
                            checked={effectiveProviderBillingMode === "byok"}
                            onChange={() => setProviderBillingMode("byok")}
                            className="h-3.5 w-3.5 text-emerald-600"
                          />
                          BYOK
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-slate-300">
                          <input
                            type="radio"
                            name="provider-billing-mode"
                            checked={effectiveProviderBillingMode === "platform_credits"}
                            onChange={() => setProviderBillingMode("platform_credits")}
                            className="h-3.5 w-3.5 text-emerald-600"
                          />
                          Platform Credits
                        </label>
                      </div>
                    ) : usingPlatformCredits ? (
                      <div className="flex h-[42px] items-center rounded-lg border border-gray-300 px-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Uses Platform Credits balance.
                      </div>
                    ) : (
                      <div className="flex h-[42px] items-center rounded-lg border border-gray-300 px-3 text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Uses your provider API key from Settings.
                      </div>
                    )}
                    {selectedRecipe === "tg_spec_target" && (
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                        Starts after the first accepted tg-spec import.
                      </p>
                    )}
                  </div>
                </div>

                {allowManagedVps && (
                  <DeployTargetSelector
                    value={effectiveDeployTarget}
                    onChange={setDeployTarget}
                    allowVps
                  />
                )}

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Agent Loop
                  </p>
                  <div className="space-y-2">
                    {activeLoops.map((loop) => (
                      <div key={loop.id}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                            selectedLoopId === loop.id
                              ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                              : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                          }`}
                        >
                          <input
                            type="radio"
                            name="project-loop"
                            value={loop.id}
                            checked={selectedLoopId === loop.id}
                            onChange={() => handleLoopChange(loop.id)}
                            className="h-4 w-4 text-emerald-600"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{loop.name}</span>
                            {loop.description && (
                              <p className="text-xs text-gray-500 dark:text-slate-400">{loop.description}</p>
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
                                <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                                  Repo HEAD
                                </span>
                                {selectedVersion && selectedVersion.capabilities.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {selectedVersion.capabilities.map((cap) => (
                                      <span key={cap} className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[9px] text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400">{cap}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {selectedLoopSupport?.supportLabel && (
                                <p className="mt-1 text-[10px] text-gray-500 dark:text-slate-400">
                                  support: {selectedLoopSupport.supportLabel}
                                </p>
                              )}
                              {selectedLoopSupport?.supportHint && (
                                <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-300">{selectedLoopSupport.supportHint}</p>
                              )}
                              <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
                                New agent projects always start on the current Repo HEAD runtime. Version history stays in the registry.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {launchBlockReason && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                      {launchBlockReason}
                    </div>
                  )}
                </div>

                {availableTools.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Tool
                    </p>
                    <div className="space-y-2">
                      {availableTools.map(({ tool }) => {
                        const isSelected = effectiveToolId === tool.id;
                        return (
                          <div key={tool.id}>
                            <label
                              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                                isSelected
                                  ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                                  : "border-gray-200 bg-white hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-500"
                              }`}
                            >
                              <input
                                type="radio"
                                name="project-tool"
                                value={tool.id}
                                checked={isSelected}
                                onChange={() => handleToolChange(tool.id)}
                                className="h-4 w-4 text-emerald-600"
                              />
                              <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-slate-100">{tool.name}</div>
                                {tool.description && (
                                  <p className="text-xs text-gray-500 dark:text-slate-400">{tool.description}</p>
                                )}
                              </div>
                            </label>
                            {isSelected && modelOptions.length > 1 && (
                              <div className="ml-7 mt-1 space-y-1">
                                {modelOptions.map((modelOption) => (
                                  <label
                                    key={modelOption.id}
                                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors ${
                                      effectiveModelId === modelOption.id
                                        ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
                                        : "border-gray-200 bg-gray-50 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-500"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="project-model"
                                      value={modelOption.id}
                                      checked={effectiveModelId === modelOption.id}
                                      onChange={() => setSelectedModelId(modelOption.id)}
                                      className="h-3.5 w-3.5 text-emerald-600"
                                    />
                                    <span className="text-xs font-medium text-gray-800 dark:text-slate-200">
                                      {modelOption.label}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </DialogBody>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !canSubmit}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            >
              {isSubmitting ? "Creating..." : "Create Project"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

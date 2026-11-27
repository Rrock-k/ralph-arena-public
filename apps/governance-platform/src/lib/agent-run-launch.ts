import { decryptSecret, getEncryptionKey } from "@/lib/crypto";
import { buildProjectWorkspaceLabel } from "@/lib/project-identity";
import {
  BUDGET_THRESHOLD_USD,
  formatBudgetBlockedMessage,
  PLATFORM_CREDITS_BUDGET_REQUIRED_MESSAGE,
} from "@/lib/project-budget";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import {
  buildRunAuthEnvFresh,
  narrowRunAuthModesForAgent,
  resolveRunAuthModesForBuild,
  RuntimeAuthUnavailableError,
} from "@/lib/run-auth";
import { userProviderCredentialOwnerId } from "@/lib/user-provider-credentials";
import { normalizeProviderBillingMode } from "@/lib/user-launch-policy";
import {
  buildProviderProxyAuthEnv,
  resolveApiProxyUrlForBackend,
} from "@/lib/provider-proxy-auth";
import { createRunnerProjectSecret } from "@/lib/internal-auth";

export type AgentRunLaunchProject = {
  id: string;
  name: string | null;
  slug: string | null;
  proposalId: string | null;
  proposal: { title: string | null } | null;
  ownerScopeType: string | null;
  ownerScopeId: string | null;
  providerBillingMode: string | null;
  cycleImage: string | null;
  envOverrides: string | null;
  agent: string;
  agentImpl: string;
  model: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
  budget: {
    isEnabled: boolean;
    totalCreditsUsd: number;
    usedCreditsUsd: number;
  } | null;
  secrets: Array<{
    key: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
  }>;
  components: Array<{
    kind?: string | null;
    agentIntent: string;
    runtimeConfig: unknown;
  }>;
};

export type RuntimeLaunchMode = "preview_only" | "agent_run";

type AgentRunLaunchPayload = {
  env: Record<string, string>;
  workerImage: string | null;
  workspaceLabel: string;
  resources?: { memoryMb?: number; cpuCount?: number };
};

type AgentRunLaunchBlocked =
  | { ok: false; kind: "auth_unavailable"; message: string; statusCode: number }
  | { ok: false; kind: "budget_blocked"; message: string };

type AgentRunLaunchSuccess = { ok: true; payload: AgentRunLaunchPayload };

export type AgentRunLaunchResult = AgentRunLaunchSuccess | AgentRunLaunchBlocked;

export type AgentRunLaunchDryRunResult =
  | { ok: false; kind: "budget_blocked"; message: string }
  | {
      ok: true;
      payload: {
        workspaceLabel: string;
        workerImage: string | null;
        resources?: { memoryMb?: number; cpuCount?: number };
        envSummary: {
          exposesValues: false;
          categories: string[];
          projectEnvOverrideCount: number;
          projectSecretCount: number;
          auth: "not_required" | "not_checked" | "provider_proxy";
        };
      };
    };

function parseProjectEnvOverrides(raw: string | null): Record<string, string | null> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => (
        (typeof value === "string" || value === null) && !isPlatformOwnedRuntimeEnvKey(key)
          ? [[key, value]]
          : []
      )),
    );
  } catch {
    return {};
  }
}

function isPlatformOwnedRuntimeEnvKey(key: string): boolean {
  const normalized = key.trim().toUpperCase();
  return normalized.startsWith("ARENA_")
    || normalized.startsWith("LANGFUSE_")
    || normalized === "CODEX_AUTH_JSON"
    || normalized === "OPENAI_API_KEY"
    || normalized === "OPENAI_BASE_URL"
    || normalized === "OPENAI_API_BASE"
    || normalized === "ANTHROPIC_API_KEY"
    || normalized === "ANTHROPIC_AUTH_TOKEN"
    || normalized === "ANTHROPIC_BASE_URL"
    || normalized === "ANTHROPIC_API_URL"
    || normalized === "CLAUDE_CODE_OAUTH_TOKEN"
    || normalized === "CLAUDE_CODE_OAUTH_REFRESH_TOKEN"
    || normalized === "OPENCODE_API_KEY"
    || normalized === "ANTIGRAVITY_AUTH_JSON";
}

export function parseComponentResources(runtimeConfig: unknown): { memoryMb?: number; cpuCount?: number } | undefined {
  if (!runtimeConfig || typeof runtimeConfig !== "object" || Array.isArray(runtimeConfig)) {
    return undefined;
  }

  const config = runtimeConfig as Record<string, unknown>;
  const memoryMb =
    typeof config.memoryMb === "number" && Number.isFinite(config.memoryMb) && config.memoryMb > 0
      ? Math.round(config.memoryMb)
      : undefined;
  const cpuCount =
    typeof config.cpuCount === "number" && Number.isFinite(config.cpuCount) && config.cpuCount > 0
      ? config.cpuCount
      : undefined;

  if (!memoryMb && !cpuCount) {
    return undefined;
  }

  return {
    ...(memoryMb ? { memoryMb } : {}),
    ...(cpuCount ? { cpuCount } : {}),
  };
}

function resolveGovernanceUrl(backend: "local" | "vps"): string {
  return backend === "vps"
    ? (process.env.GOVERNANCE_PUBLIC_URL || process.env.GOVERNANCE_INTERNAL_URL || "http://governance-platform:3000")
    : (process.env.GOVERNANCE_INTERNAL_URL || "http://governance-platform:3000");
}

function resolveGovernancePublicUrl(): string | null {
  const value = (process.env.GOVERNANCE_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

export function buildLangfuseRuntimeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const baseUrl = trimToNull(env.LANGFUSE_BASE_URL);
  const publicKey = trimToNull(env.LANGFUSE_PUBLIC_KEY);
  const secretKey = trimToNull(env.LANGFUSE_SECRET_KEY);

  if (!baseUrl || !publicKey || !secretKey) {
    return {};
  }

  return {
    LANGFUSE_BASE_URL: baseUrl,
    LANGFUSE_PUBLIC_KEY: publicKey,
    LANGFUSE_SECRET_KEY: secretKey,
  };
}

function checkPlatformCreditsBudget(input: {
  project: AgentRunLaunchProject;
  providerBillingMode: ReturnType<typeof normalizeProviderBillingMode>;
  shouldStartAgent: boolean;
  primaryComponent: ReturnType<typeof getPrimaryLifecycleComponent>;
}): { ok: true } | { ok: false; message: string } {
  const shouldEnforceBudget = input.shouldStartAgent && input.primaryComponent?.agentIntent !== "OFF";
  const shouldEnforcePlatformCreditsBudget = shouldEnforceBudget && input.providerBillingMode === "platform_credits";

  if (shouldEnforcePlatformCreditsBudget && input.project.budget?.isEnabled) {
    const remainingUsd = Number(input.project.budget.totalCreditsUsd) - Number(input.project.budget.usedCreditsUsd);
    if (Number.isFinite(remainingUsd) && remainingUsd <= BUDGET_THRESHOLD_USD) {
      return {
        ok: false,
        message: formatBudgetBlockedMessage(remainingUsd),
      };
    }
  } else if (shouldEnforcePlatformCreditsBudget) {
    return {
      ok: false,
      message: PLATFORM_CREDITS_BUDGET_REQUIRED_MESSAGE,
    };
  }

  return { ok: true };
}

function resolveRuntimeLaunchBasePayload(project: AgentRunLaunchProject) {
  const primaryComponent = getPrimaryLifecycleComponent(project);
  const runtimeConfig =
    primaryComponent && primaryComponent.runtimeConfig && typeof primaryComponent.runtimeConfig === "object"
      ? (primaryComponent.runtimeConfig as Record<string, unknown>)
      : null;

  return {
    primaryComponent,
    workerImage:
      runtimeConfig && typeof runtimeConfig.cycleImage === "string" && runtimeConfig.cycleImage.trim()
        ? runtimeConfig.cycleImage
        : project.cycleImage,
    resources: parseComponentResources(primaryComponent?.runtimeConfig),
    workspaceLabel: buildProjectWorkspaceLabel(project),
  };
}

export function prepareRuntimeLaunchDryRun(
  project: AgentRunLaunchProject,
  backend: "local" | "vps",
  mode: RuntimeLaunchMode,
): AgentRunLaunchDryRunResult {
  const shouldStartAgent = mode === "agent_run";
  const providerBillingMode = normalizeProviderBillingMode(project.providerBillingMode);
  const basePayload = resolveRuntimeLaunchBasePayload(project);
  const budgetCheck = checkPlatformCreditsBudget({
    project,
    providerBillingMode,
    shouldStartAgent,
    primaryComponent: basePayload.primaryComponent,
  });
  if (!budgetCheck.ok) {
    return {
      ok: false,
      kind: "budget_blocked",
      message: budgetCheck.message,
    };
  }

  const serviceLikeProject = project.agent === "service" || project.agent === "openclaw";
  const projectEnvOverrides = parseProjectEnvOverrides(project.envOverrides);
  const categories = [
    "arena_core",
    "governance_url",
    "api_proxy",
    "agent_identity",
    ...(Object.keys(projectEnvOverrides).length > 0 ? ["project_env_overrides"] : []),
    ...(project.secrets.length > 0 ? ["project_secrets"] : []),
    ...(Object.keys(buildLangfuseRuntimeEnv()).length > 0 ? ["langfuse"] : []),
  ];

  const auth =
    !shouldStartAgent || serviceLikeProject
      ? "not_required"
      : providerBillingMode === "platform_credits"
        ? "provider_proxy"
        : "not_checked";

  void backend;

  return {
    ok: true,
    payload: {
      workspaceLabel: basePayload.workspaceLabel,
      workerImage: basePayload.workerImage,
      ...(basePayload.resources ? { resources: basePayload.resources } : {}),
      envSummary: {
        exposesValues: false,
        categories,
        projectEnvOverrideCount: Object.keys(projectEnvOverrides).length,
        projectSecretCount: project.secrets.length,
        auth,
      },
    },
  };
}

export async function prepareRuntimeLaunch(
  project: AgentRunLaunchProject,
  backend: "local" | "vps",
  mode: RuntimeLaunchMode,
): Promise<AgentRunLaunchResult> {
  const shouldStartAgent = mode === "agent_run";
  const providerBillingMode = normalizeProviderBillingMode(project.providerBillingMode);
  const basePayload = resolveRuntimeLaunchBasePayload(project);
  const budgetCheck = checkPlatformCreditsBudget({
    project,
    providerBillingMode,
    shouldStartAgent,
    primaryComponent: basePayload.primaryComponent,
  });
  if (!budgetCheck.ok) {
    return {
      ok: false,
      kind: "budget_blocked",
      message: budgetCheck.message,
    };
  }

  const projectEnvOverrides = parseProjectEnvOverrides(project.envOverrides);
  const serviceLikeProject = project.agent === "service" || project.agent === "openclaw";
  const userProviderOwnerId = providerBillingMode === "byok"
    ? userProviderCredentialOwnerId(project.ownerScopeType, project.ownerScopeId)
    : null;
  const rawAuthModes = narrowRunAuthModesForAgent(project.agent, {
    claudeAuthMode: project.claudeAuthMode,
    codexAuthMode: project.codexAuthMode,
  });
  const authModes = resolveRunAuthModesForBuild(rawAuthModes, {
    agent: project.agent,
    userId: userProviderOwnerId,
  });
  const apiProxyUrl = resolveApiProxyUrlForBackend(backend);

  let authEnv: Record<string, string> = {};
  if (shouldStartAgent && !serviceLikeProject) {
    try {
      authEnv = providerBillingMode === "platform_credits"
        ? buildProviderProxyAuthEnv({
          projectId: project.id,
          agent: project.agent,
          apiProxyUrl,
        })
        : await buildRunAuthEnvFresh(authModes, {
          agent: project.agent,
          userId: userProviderOwnerId,
        });
    } catch (error) {
      if (error instanceof RuntimeAuthUnavailableError) {
        return {
          ok: false,
          kind: "auth_unavailable",
          message: error.message,
          statusCode: error.statusCode,
        };
      }
      throw error;
    }
  }

  const secretsEnv: Record<string, string> = {};
  if (project.secrets.length > 0) {
    try {
      const encKey = getEncryptionKey();
      for (const secret of project.secrets) {
        if (isPlatformOwnedRuntimeEnvKey(secret.key)) continue;
        secretsEnv[secret.key] = decryptSecret(
          { ciphertext: secret.encryptedValue, iv: secret.iv, authTag: secret.authTag },
          encKey,
        );
      }
    } catch (err) {
      console.warn(`[agent-run-launch] Failed to decrypt secrets for project ${project.id}:`, err);
    }
  }

  const governancePublicUrl = resolveGovernancePublicUrl();
  const env: Record<string, string> = {
    ARENA_PROJECT_ID: project.id,
    ARENA_GOVERNANCE_URL: resolveGovernanceUrl(backend),
    ...(governancePublicUrl ? { ARENA_GOVERNANCE_PUBLIC_URL: governancePublicUrl } : {}),
    ARENA_PROJECT_SECRET: createRunnerProjectSecret(project.id),
    ARENA_API_PROXY_URL: apiProxyUrl,
    ARENA_API_PROXY_SECRET: process.env.API_PROXY_SECRET || "",
    ARENA_RUNTIME_INTENT_RUNNER_MODE: mode,
    ARENA_AGENT: project.agent,
    ARENA_AGENT_IMPL: project.agentImpl,
    ARENA_PROVIDER_BILLING_MODE: providerBillingMode,
    ...(!serviceLikeProject ? {
      ...(project.agent === "claude-code"
        ? { ARENA_CLAUDE_AUTH_MODE: authModes.claudeAuthMode || "oauth" }
        : {}),
      ...(project.agent === "codex" && authModes.codexAuthMode
        ? { ARENA_CODEX_AUTH_MODE: authModes.codexAuthMode }
        : {}),
    } : {}),
    ...(project.model ? { ARENA_MODEL: project.model } : {}),
    CI: "true",
    PORT: "3000",
    APP_PORT: "3000",
    ...authEnv,
    ...secretsEnv,
    ...buildLangfuseRuntimeEnv(),
  };

  for (const [key, value] of Object.entries(projectEnvOverrides)) {
    if (value === null) {
      delete env[key];
      continue;
    }
    env[key] = value;
  }

  return {
    ok: true,
    payload: {
      env,
      workspaceLabel: basePayload.workspaceLabel,
      workerImage: basePayload.workerImage,
      resources: basePayload.resources,
    },
  };
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

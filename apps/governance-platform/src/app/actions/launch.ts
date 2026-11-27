"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { progressBus } from "@/lib/progress-bus";
import { createProjectFromProposal } from "@/lib/launch-utils";
import { appendLifecycle } from "@/lib/log-writer";
import { resolveLoopAndTool } from "@/lib/control-plane";
import { requirePlatformCapability } from "@/lib/platform-access";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";
import {
  enforceUserLaunchPolicy,
  normalizeAuthModesForProviderBilling,
  parseProviderBillingMode,
} from "@/lib/user-launch-policy";

const LAUNCHABLE_STATUSES = ["PROPOSED", "WINNER", "APPROVED"];
const VALID_CLAUDE_AUTH_MODES = ["oauth", "api_key"] as const;
const VALID_CODEX_AUTH_MODES = ["subscription", "api_key"] as const;
type TransactionClient = Prisma.TransactionClient;

type LaunchOptions = {
  agent?: string;
  agentImpl?: string;
  model?: string | null;
  envOverrides?: Record<string, string> | null;
  initialBudgetUsd?: number | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  runnerBackend?: string | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  vpsServerType?: string | null;
  toolId?: string | null;
  providerBillingMode?: string | null;
};

export async function launchProposal(proposalId: string, options?: LaunchOptions) {
  const access = await requirePlatformCapability("platform.projects.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return launchProposalInternal(proposalId, options, {
    createdById: access.session?.user?.id ?? null,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function launchProposalInternal(
  proposalId: string,
  options?: LaunchOptions,
  opts?: { createdById?: string | null; internalActionToken?: unknown },
) {
  const internalGuard = requireInternalActionToken(opts?.internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    // Get the proposal
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        title: true,
        status: true,
        spec: true,
        createdById: true,
      },
    });

    if (!proposal) {
      return { success: false, error: "Proposal not found" };
    }

    if (!LAUNCHABLE_STATUSES.includes(proposal.status)) {
      return { success: false, error: `Cannot launch proposal with status ${proposal.status}` };
    }

    const agent = options?.agent?.trim() || process.env.RUNNER_AGENT || "codex";
    const agentImpl = options?.agentImpl?.trim() || process.env.RUNNER_AGENT_IMPL || "direct";
    const model = options?.model?.trim() ?? null;
    const envOverrides = options?.envOverrides ? JSON.stringify(options.envOverrides) : null;

    const claudeAuthMode = options?.claudeAuthMode?.trim() || null;
    const codexAuthMode = options?.codexAuthMode?.trim() || null;
    if (claudeAuthMode && !VALID_CLAUDE_AUTH_MODES.includes(claudeAuthMode as any)) {
      return { success: false, error: `Invalid claudeAuthMode: ${claudeAuthMode}` };
    }
    if (codexAuthMode && !VALID_CODEX_AUTH_MODES.includes(codexAuthMode as any)) {
      return { success: false, error: `Invalid codexAuthMode: ${codexAuthMode}` };
    }
    const rawProviderBillingMode = options?.providerBillingMode?.trim() || null;
    if (!rawProviderBillingMode) {
      return { success: false, error: "providerBillingMode is required" };
    }
    const providerBillingMode = parseProviderBillingMode(rawProviderBillingMode);
    if (!providerBillingMode) {
      return { success: false, error: `Invalid providerBillingMode: ${rawProviderBillingMode}` };
    }
    if (providerBillingMode === "platform_credits" && options?.initialBudgetUsd == null) {
      return { success: false, error: "Platform Credits launches require an initial budget." };
    }

    const runnerBackend = options?.runnerBackend?.trim() || "local";

    const repoUrl = options?.repoUrl?.trim() || null;
    const repoBranch = options?.repoBranch?.trim() || null;
    const vpsServerType = options?.vpsServerType?.trim() || null;

    const VALID_VPS_SERVER_TYPES = ["cpx11", "cpx21", "cpx31", "cpx41", "cpx51"] as const;
    if (vpsServerType && !VALID_VPS_SERVER_TYPES.includes(vpsServerType as any)) {
      return { success: false, error: `Invalid vpsServerType: ${vpsServerType}` };
    }

    const resolvedTooling = await resolveLoopAndTool(agentImpl, agent);
    const toolId = options?.toolId ?? resolvedTooling.toolId;
    const agentLoopVersionId = resolvedTooling.agentLoopVersionId;

    if (!toolId || !agentLoopVersionId) {
      return { success: false, error: `Unknown tool/loop mapping for ${agent} / ${agentImpl}` };
    }
    const authModes = normalizeAuthModesForProviderBilling(agent, providerBillingMode, {
      claudeAuthMode,
      codexAuthMode,
    });
    const ownerScopeId = opts?.createdById ?? proposal.createdById ?? null;
    const policy = await enforceUserLaunchPolicy({
      userId: ownerScopeId,
      privileged: true,
      agent,
      agentImpl,
      runnerBackend,
      providerBillingMode,
    });
    if (!policy.allowed) {
      return { success: false, error: policy.error };
    }

    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      return createProjectFromProposal(tx, proposal, {
        agent,
        agentImpl,
        model,
        envOverrides,
        claudeAuthMode: authModes.claudeAuthMode,
        codexAuthMode: authModes.codexAuthMode,
        runnerBackend,
        repoUrl,
        repoBranch,
        vpsServerType,
        toolId,
        agentLoopVersionId,
        providerBillingMode,
      }, {
        createdById: opts?.createdById ?? undefined,
        initialBudgetUsd: options?.initialBudgetUsd ?? undefined,
      });
    });

    // RA-120: Log LAUNCHED lifecycle event
    await appendLifecycle(result.project.id, "LAUNCHED").catch(() => {});

    revalidatePath("/");
    revalidatePath("/admin");

    progressBus.notifyChanged();
    return { success: true, projectId: result.project.id };
  } catch (error) {
    console.error("Launch error:", error);
    return { success: false, error: "Failed to launch proposal" };
  }
}

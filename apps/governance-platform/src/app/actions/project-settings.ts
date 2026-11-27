"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireProjectCapability } from "@/lib/project-access";
import { requirePlatformCapability, resolvePlatformAccess } from "@/lib/platform-access";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { resolveLaunchCatalogSelection, selectCatalogModel, trimToNull } from "@/lib/model-catalog";
import type { ProjectVisibility } from "@/lib/action-types";
import {
  normalizeAuthModesForProviderBilling,
  normalizeProviderBillingMode,
  parseProviderBillingMode,
} from "@/lib/user-launch-policy";
import {
  buildVisualWorkbenchEvidenceAutomationRuntimeConfig,
  isVisualEvidenceMode,
  type VisualEvidenceMode,
} from "@/lib/visual-workbench-runtime-config";

const VALID_CLAUDE_AUTH_MODES = ["oauth", "api_key"] as const;
const VALID_CODEX_AUTH_MODES = ["subscription", "api_key"] as const;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export type ProjectRuntimeSystemInput = {
  agent: string;
  agentImpl: string;
  model?: string | null;
  toolId?: string | null;
  providerBillingMode: string | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
};

function getObjectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function serializeEnvOverrides(value: Record<string, string> | null): string | null {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

function readCurrentVisualEvidenceMode(runtimeConfig: Record<string, unknown>): VisualEvidenceMode | null {
  const rawMode = runtimeConfig.visualEvidenceMode;
  if (isVisualEvidenceMode(rawMode)) return rawMode;
  if (rawMode !== undefined) return null;
  return runtimeConfig.visualWorkbenchEvidenceAutomation == null ? "off" : "required";
}

export async function togglePinned(projectId: string, isPinned: boolean) {
  const access = await requirePlatformCapability("platform.projects.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { isPinned },
    });
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("togglePinned error:", error);
    return { success: false, error: "Failed to update" };
  }
}

export async function setProjectAiDisclaimer(projectId: string, showAiDisclaimer: boolean) {
  // Removing the AI-generated content disclaimer is a platform trust decision
  // (it disclaims Ralph Arena's endorsement), so it is admin-gated, not owner-gated.
  const access = await requirePlatformCapability("platform.projects.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { showAiDisclaimer },
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("setProjectAiDisclaimer error:", error);
    return { success: false, error: "Failed to update" };
  }
}

export async function setProjectVisibilityInternal(
  projectId: string,
  visibility: ProjectVisibility,
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { visibility },
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin");
    revalidatePath("/");
    revalidatePath("/explore");
    return { success: true };
  } catch (error) {
    console.error("setProjectVisibility error:", error);
    return { success: false, error: "Failed to update" };
  }
}

export async function setProjectVisibility(projectId: string, visibility: ProjectVisibility) {
  const access = await requireProjectCapability(projectId, "project.settings.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  if (visibility === "featured") {
    const platformAccess = await requirePlatformCapability("platform.projects.manage");
    if (!platformAccess.authorized) {
      return { success: false, error: platformAccess.error };
    }
  }

  return setProjectVisibilityInternal(projectId, visibility, INTERNAL_ACTION_TOKEN);
}

export async function setProjectModelInternal(
  projectId: string,
  requestedModel: string,
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const requested = trimToNull(requestedModel);
  if (!requested) {
    return { success: false, error: "model is required" };
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        archivedAt: true,
        agent: true,
        agentImpl: true,
        model: true,
        envOverrides: true,
        toolId: true,
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            agentState: true,
            runtimeConfig: true,
          },
        },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }
    if (project.archivedAt) {
      return { success: false, error: "Project is archived" };
    }
    const component = project.components?.[0] ?? null;
    if (!component) {
      return { success: false, error: "Project app component not found" };
    }
    const loop = await (prisma as any).agentLoop.findUnique({
      where: { name: project.agentImpl },
      select: {
        isActive: true,
        loopTools: {
          select: {
            toolId: true,
            models: true,
            tool: {
              select: {
                id: true,
                name: true,
                models: true,
                defaultModelId: true,
                isActive: true,
              },
            },
          },
        },
      },
    });
    if (!loop?.isActive) {
      return { success: false, error: `Unknown or inactive agent loop: ${project.agentImpl}` };
    }
    const mapping = loop.loopTools.find((entry: any) => (
      entry.tool?.isActive
      && entry.tool.name === project.agent
      && (!project.toolId || entry.toolId === project.toolId)
    ));
    if (!mapping?.tool) {
      return { success: false, error: `Tool ${project.agent} is not available for loop ${project.agentImpl}` };
    }

    const selection = selectCatalogModel({
      rawModels: mapping.models ?? mapping.tool.models,
      requestedModel: requested,
      defaultModelId: mapping.tool.defaultModelId,
    });
    if (!selection.success) {
      return selection;
    }
    if (!selection.model) {
      return { success: false, error: "model is required" };
    }
    const envOverrides = serializeEnvOverrides(selection.envOverrides);
    if (
      component.agentState === "RUNNING"
      && (project.model !== selection.model || (project.envOverrides ?? null) !== envOverrides)
    ) {
      return {
        success: false,
        error: "Cannot switch model while agent work is running. Pause the agent or wait for an idle boundary.",
      };
    }

    const runtimeConfig = getObjectConfig(component.runtimeConfig);

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          model: selection.model,
          envOverrides,
        },
      });
      await tx.projectComponent.update({
        where: { id: component.id },
        data: {
          runtimeConfig: {
            ...runtimeConfig,
            model: selection.model,
            envOverrides,
          },
        },
      });
      await tx.runLog.create({
        data: {
          projectId,
          event: "MODEL_UPDATED",
          detail: JSON.stringify({
            previousModel: project.model ?? null,
            model: selection.model,
            modelId: selection.modelId,
            previousEnvOverrides: project.envOverrides ?? null,
            envOverrides,
            note: "Applies to future runtime claims; no lifecycle mutation was performed.",
          }),
        },
      });
    });

    revalidatePath("/admin");
    revalidatePath(`/projects/${projectId}`);
    notifyProjectChanged(projectId);
    return {
      success: true,
      projectId,
      model: selection.model,
      modelId: selection.modelId,
    };
  } catch (error) {
    console.error("setProjectModel error:", error);
    return { success: false, error: "Failed to update project model" };
  }
}

export async function setProjectModel(projectId: string, model: string) {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return setProjectModelInternal(projectId, model, INTERNAL_ACTION_TOKEN);
}

export async function setProjectRuntimeSystemInternal(
  projectId: string,
  input: ProjectRuntimeSystemInput,
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const agent = trimToNull(input.agent);
  const agentImpl = trimToNull(input.agentImpl);
  if (!agent) return { success: false, error: "agent is required" };
  if (!agentImpl) return { success: false, error: "agentImpl is required" };

  if (input.claudeAuthMode && !VALID_CLAUDE_AUTH_MODES.includes(input.claudeAuthMode as any)) {
    return { success: false, error: `Invalid claudeAuthMode: ${input.claudeAuthMode}` };
  }
  if (input.codexAuthMode && !VALID_CODEX_AUTH_MODES.includes(input.codexAuthMode as any)) {
    return { success: false, error: `Invalid codexAuthMode: ${input.codexAuthMode}` };
  }
  if (agent !== "claude-code" && input.claudeAuthMode) {
    return { success: false, error: "claudeAuthMode is only valid for Claude Code runtime." };
  }
  if (agent !== "codex" && input.codexAuthMode) {
    return { success: false, error: "codexAuthMode is only valid for Codex runtime." };
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        archivedAt: true,
        agent: true,
        agentImpl: true,
        model: true,
        envOverrides: true,
        toolId: true,
        agentLoopVersionId: true,
        claudeAuthMode: true,
        codexAuthMode: true,
        providerBillingMode: true,
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            agentState: true,
            runtimeConfig: true,
          },
        },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }
    if (project.archivedAt) {
      return { success: false, error: "Project is archived" };
    }
    const component = project.components?.[0] ?? null;
    if (!component) {
      return { success: false, error: "Project app component not found" };
    }

    const selected = await resolveLaunchCatalogSelection({
      agent,
      agentImpl,
      toolId: input.toolId,
      model: input.model,
    });
    if (!selected.success) {
      return selected;
    }

    const rawProviderBillingMode = trimToNull(input.providerBillingMode);
    const providerBillingMode = parseProviderBillingMode(rawProviderBillingMode);
    if (!providerBillingMode) {
      return {
        success: false,
        error: rawProviderBillingMode
          ? `Invalid providerBillingMode: ${rawProviderBillingMode}`
          : "providerBillingMode is required",
      };
    }

    const nextAuthModes = normalizeAuthModesForProviderBilling(
      agent,
      providerBillingMode,
      {
        claudeAuthMode: agent === "claude-code" && input.claudeAuthMode !== undefined
          ? input.claudeAuthMode
          : agent === "claude-code" ? project.claudeAuthMode ?? null : null,
        codexAuthMode: agent === "codex" && input.codexAuthMode !== undefined
          ? input.codexAuthMode
          : agent === "codex" ? project.codexAuthMode ?? null : null,
      },
    );

    if (providerBillingMode === "platform_credentials" && agent === "claude-code" && !nextAuthModes.claudeAuthMode) {
      return { success: false, error: "claudeAuthMode is required for Claude Code platform_credentials runtime." };
    }
    if (providerBillingMode === "platform_credentials" && agent === "codex" && !nextAuthModes.codexAuthMode) {
      return { success: false, error: "codexAuthMode is required for Codex platform_credentials runtime." };
    }

    const envOverrides = serializeEnvOverrides(selected.envOverrides);
    const current = {
      agent: project.agent,
      agentImpl: project.agentImpl,
      model: project.model ?? null,
      envOverrides: project.envOverrides ?? null,
      toolId: project.toolId ?? null,
      agentLoopVersionId: project.agentLoopVersionId ?? null,
      claudeAuthMode: project.claudeAuthMode ?? null,
      codexAuthMode: project.codexAuthMode ?? null,
      providerBillingMode: normalizeProviderBillingMode(project.providerBillingMode),
    };
    const next = {
      agent,
      agentImpl,
      model: selected.model,
      envOverrides,
      toolId: selected.toolId,
      agentLoopVersionId: selected.agentLoopVersionId,
      claudeAuthMode: nextAuthModes.claudeAuthMode,
      codexAuthMode: nextAuthModes.codexAuthMode,
      providerBillingMode,
    };
    const changed = Object.entries(next).some(([key, value]) => (
      current[key as keyof typeof current] !== value
    ));

    if (component.agentState === "RUNNING" && changed) {
      return {
        success: false,
        error: "Cannot switch runtime system while agent work is running. Pause the agent or wait for an idle boundary.",
      };
    }

    const runtimeConfig = getObjectConfig(component.runtimeConfig);
    const nextRuntimeConfig = {
      ...runtimeConfig,
      agent,
      agentImpl,
      model: selected.model,
      envOverrides,
      claudeAuthMode: nextAuthModes.claudeAuthMode,
      codexAuthMode: nextAuthModes.codexAuthMode,
      providerBillingMode,
      toolId: selected.toolId,
      agentLoopVersionId: selected.agentLoopVersionId,
    };

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          agent,
          agentImpl,
          model: selected.model,
          envOverrides,
          claudeAuthMode: nextAuthModes.claudeAuthMode,
          codexAuthMode: nextAuthModes.codexAuthMode,
          providerBillingMode,
          tool: selected.toolId ? { connect: { id: selected.toolId } } : { disconnect: true },
          agentLoopVersion: selected.agentLoopVersionId
            ? { connect: { id: selected.agentLoopVersionId } }
            : { disconnect: true },
        },
      });
      await tx.projectComponent.update({
        where: { id: component.id },
        data: {
          runtimeConfig: nextRuntimeConfig,
        },
      });
      await tx.runLog.create({
        data: {
          projectId,
          event: "RUNTIME_SYSTEM_UPDATED",
          detail: JSON.stringify({
            previous: current,
            next,
            modelId: selected.modelId,
            note: "Applies to future runtime claims; no lifecycle, retry, relaunch, preview or planner mutation was performed.",
          }),
        },
      });
    });

    revalidatePath("/admin");
    revalidatePath(`/projects/${projectId}`);
    notifyProjectChanged(projectId);
    return {
      success: true,
      projectId,
      agent,
      agentImpl,
      model: selected.model,
      modelId: selected.modelId,
      toolId: selected.toolId,
      agentLoopVersionId: selected.agentLoopVersionId,
      claudeAuthMode: nextAuthModes.claudeAuthMode,
      codexAuthMode: nextAuthModes.codexAuthMode,
      providerBillingMode,
    };
  } catch (error) {
    console.error("setProjectRuntimeSystem error:", error);
    return { success: false, error: "Failed to update project runtime system" };
  }
}

export async function setProjectRuntimeSystem(projectId: string, input: ProjectRuntimeSystemInput) {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }
  if (input.providerBillingMode === "platform_credentials") {
    const platformAccess = await resolvePlatformAccess(access.session as any, access.hasBypass);
    if (
      !platformAccess.hasCapability("platform.projects.manage")
      && !platformAccess.hasCapability("platform.runtime.manage")
    ) {
      return { success: false, error: "Platform provider credentials require platform runtime access." };
    }
  }

  return setProjectRuntimeSystemInternal(projectId, input, INTERNAL_ACTION_TOKEN);
}

export async function setProjectSourceSnapshotInternal(
  projectId: string,
  commitSha: string,
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const requestedCommitSha = trimToNull(commitSha);
  if (!requestedCommitSha || !COMMIT_SHA_PATTERN.test(requestedCommitSha)) {
    return { success: false, error: "commitSha must be a 40 character git SHA" };
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        archivedAt: true,
        repoUrl: true,
        repoBranch: true,
        commitSha: true,
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }
    if (project.archivedAt) {
      return { success: false, error: "Project is archived" };
    }
    if (!project.repoUrl) {
      return { success: false, error: "Project has no repoUrl source truth" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { commitSha: requestedCommitSha },
      });
      await tx.runLog.create({
        data: {
          projectId,
          event: "SOURCE_SNAPSHOT_UPDATED",
          detail: JSON.stringify({
            previousCommitSha: project.commitSha ?? null,
            commitSha: requestedCommitSha,
            repoUrl: project.repoUrl,
            repoBranch: project.repoBranch,
            note: "Updates source snapshot pointer only; no lifecycle, retry, relaunch or runtime mutation was performed.",
          }),
        },
      });
    });

    revalidatePath("/admin");
    revalidatePath(`/projects/${projectId}`);
    notifyProjectChanged(projectId);
    return {
      success: true,
      projectId,
      previousCommitSha: project.commitSha ?? null,
      commitSha: requestedCommitSha,
      repoUrl: project.repoUrl,
      repoBranch: project.repoBranch,
    };
  } catch (error) {
    console.error("setProjectSourceSnapshot error:", error);
    return { success: false, error: "Failed to update project source snapshot" };
  }
}

export async function setProjectRuntimeAuthModesInternal(
  projectId: string,
  input: {
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
  },
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const hasClaude = Object.prototype.hasOwnProperty.call(input, "claudeAuthMode");
  const hasCodex = Object.prototype.hasOwnProperty.call(input, "codexAuthMode");
  if (!hasClaude && !hasCodex) {
    return { success: false, error: "At least one auth mode is required" };
  }

  const requestedClaudeAuthMode = hasClaude ? trimToNull(input.claudeAuthMode ?? null) : undefined;
  const requestedCodexAuthMode = hasCodex ? trimToNull(input.codexAuthMode ?? null) : undefined;
  if (requestedClaudeAuthMode && !VALID_CLAUDE_AUTH_MODES.includes(requestedClaudeAuthMode as any)) {
    return { success: false, error: `Invalid claudeAuthMode: ${requestedClaudeAuthMode}` };
  }
  if (requestedCodexAuthMode && !VALID_CODEX_AUTH_MODES.includes(requestedCodexAuthMode as any)) {
    return { success: false, error: `Invalid codexAuthMode: ${requestedCodexAuthMode}` };
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        archivedAt: true,
        agent: true,
        claudeAuthMode: true,
        codexAuthMode: true,
        providerBillingMode: true,
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            agentState: true,
            runtimeConfig: true,
          },
        },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }
    if (project.archivedAt) {
      return { success: false, error: "Project is archived" };
    }
    const component = project.components?.[0] ?? null;
    if (!component) {
      return { success: false, error: "Project app component not found" };
    }

    const nextAuthModes = normalizeAuthModesForProviderBilling(
      project.agent,
      project.providerBillingMode,
      {
        claudeAuthMode: hasClaude ? requestedClaudeAuthMode ?? null : project.claudeAuthMode ?? null,
        codexAuthMode: hasCodex ? requestedCodexAuthMode ?? null : project.codexAuthMode ?? null,
      },
    );

    if (
      component.agentState === "RUNNING"
      && (
        (project.claudeAuthMode ?? null) !== nextAuthModes.claudeAuthMode
        || (project.codexAuthMode ?? null) !== nextAuthModes.codexAuthMode
      )
    ) {
      return {
        success: false,
        error: "Cannot switch runtime auth modes while agent work is running. Pause the agent or wait for an idle boundary.",
      };
    }

    const runtimeConfig = getObjectConfig(component.runtimeConfig);

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          claudeAuthMode: nextAuthModes.claudeAuthMode,
          codexAuthMode: nextAuthModes.codexAuthMode,
        },
      });
      await tx.projectComponent.update({
        where: { id: component.id },
        data: {
          runtimeConfig: {
            ...runtimeConfig,
            claudeAuthMode: nextAuthModes.claudeAuthMode,
            codexAuthMode: nextAuthModes.codexAuthMode,
          },
        },
      });
      await tx.runLog.create({
        data: {
          projectId,
          event: "RUNTIME_AUTH_MODES_UPDATED",
          detail: JSON.stringify({
            previousClaudeAuthMode: project.claudeAuthMode ?? null,
            previousCodexAuthMode: project.codexAuthMode ?? null,
            claudeAuthMode: nextAuthModes.claudeAuthMode,
            codexAuthMode: nextAuthModes.codexAuthMode,
            providerBillingMode: project.providerBillingMode,
            note: "Applies to future runtime claims; no lifecycle, retry, relaunch or runtime mutation was performed.",
          }),
        },
      });
    });

    revalidatePath("/admin");
    revalidatePath(`/projects/${projectId}`);
    notifyProjectChanged(projectId);
    return {
      success: true,
      projectId,
      claudeAuthMode: nextAuthModes.claudeAuthMode,
      codexAuthMode: nextAuthModes.codexAuthMode,
      providerBillingMode: project.providerBillingMode,
    };
  } catch (error) {
    console.error("setProjectRuntimeAuthModes error:", error);
    return { success: false, error: "Failed to update project runtime auth modes" };
  }
}

export async function setProjectRuntimeAuthModes(
  projectId: string,
  input: {
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
  },
) {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return setProjectRuntimeAuthModesInternal(projectId, input, INTERNAL_ACTION_TOKEN);
}

export async function setProjectVisualEvidenceModeInternal(
  projectId: string,
  visualEvidenceMode: string,
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  if (!isVisualEvidenceMode(visualEvidenceMode)) {
    return { success: false, error: "visualEvidenceMode must be one of: off, required, new_tasks_only" };
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        archivedAt: true,
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            agentState: true,
            runtimeConfig: true,
          },
        },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }
    if (project.archivedAt) {
      return { success: false, error: "Project is archived" };
    }
    const component = project.components?.[0] ?? null;
    if (!component) {
      return { success: false, error: "Project app component not found" };
    }

    const runtimeConfig = getObjectConfig(component.runtimeConfig);
    const previousVisualEvidenceMode = readCurrentVisualEvidenceMode(runtimeConfig);
    if (!previousVisualEvidenceMode) {
      return { success: false, error: "Invalid current visualEvidenceMode runtimeConfig" };
    }

    if (component.agentState === "RUNNING" && previousVisualEvidenceMode !== visualEvidenceMode) {
      return {
        success: false,
        error: "Cannot switch visual evidence mode while agent work is running. Pause the agent or wait for an idle boundary.",
      };
    }

    const nextRuntimeConfig: Record<string, unknown> = {
      ...runtimeConfig,
      visualEvidenceMode,
    };
    if (visualEvidenceMode === "off") {
      delete nextRuntimeConfig.visualWorkbenchEvidenceAutomation;
    } else {
      nextRuntimeConfig.visualWorkbenchEvidenceAutomation = buildVisualWorkbenchEvidenceAutomationRuntimeConfig();
    }

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.projectComponent.update({
        where: { id: component.id },
        data: {
          runtimeConfig: nextRuntimeConfig,
        },
      });
      await tx.runLog.create({
        data: {
          projectId,
          event: "VISUAL_EVIDENCE_MODE_UPDATED",
          detail: JSON.stringify({
            previousVisualEvidenceMode,
            visualEvidenceMode,
            visualWorkbenchEvidenceAutomation: visualEvidenceMode === "off" ? "disabled" : "enabled",
            note: "Applies to future runtime claims; no lifecycle, retry, relaunch or runtime mutation was performed.",
          }),
        },
      });
    });

    revalidatePath("/admin");
    revalidatePath(`/projects/${projectId}`);
    notifyProjectChanged(projectId);
    return {
      success: true,
      projectId,
      previousVisualEvidenceMode,
      visualEvidenceMode,
      visualWorkbenchEvidenceAutomation: visualEvidenceMode === "off" ? "disabled" : "enabled",
    };
  } catch (error) {
    console.error("setProjectVisualEvidenceMode error:", error);
    return { success: false, error: "Failed to update project visual evidence mode" };
  }
}

export async function setProjectVisualEvidenceMode(projectId: string, visualEvidenceMode: VisualEvidenceMode) {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return setProjectVisualEvidenceModeInternal(projectId, visualEvidenceMode, INTERNAL_ACTION_TOKEN);
}

export async function setExploreOrder(projectIds: string[]) {
  const access = await requirePlatformCapability("platform.projects.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  if (!Array.isArray(projectIds)) {
    return { success: false, error: "projectIds must be an array" };
  }

  const orderedIds = projectIds.map((projectId) =>
    typeof projectId === "string" ? projectId.trim() : "",
  );
  if (orderedIds.some((projectId) => projectId.length === 0)) {
    return { success: false, error: "projectIds must be non-empty strings" };
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    return { success: false, error: "projectIds must be unique" };
  }

  try {
    await prisma.$transaction([
      prisma.project.updateMany({
        where:
          orderedIds.length > 0
            ? { exploreRank: { not: null }, id: { notIn: orderedIds } }
            : { exploreRank: { not: null } },
        data: { exploreRank: null },
      }),
      ...orderedIds.map((projectId, index) =>
        prisma.project.update({
          where: { id: projectId },
          data: { exploreRank: index + 1 },
        }),
      ),
    ]);
    revalidatePath("/admin");
    revalidatePath("/");
    revalidatePath("/explore");
    return { success: true };
  } catch (error) {
    console.error("setExploreOrder error:", error);
    return { success: false, error: "Failed to update Explore order" };
  }
}

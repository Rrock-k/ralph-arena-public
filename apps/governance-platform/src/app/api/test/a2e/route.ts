import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { launchProposal } from "@/app/actions/launch";
import { createProjectSecretInternal } from "@/app/actions/secrets";
import { addProjectCreditsInternal, setProjectBudgetLimitInternal } from "@/app/actions/budget";
import { createSpecInternal } from "@/app/actions/specs";
import { setAgentIntentInternal } from "@/app/actions/agent-intent";
import { setPowerIntentInternal } from "@/app/actions/power-intent";
import { relaunchProjectInternal } from "@/app/actions/relaunch";
import { deleteProjectInternal } from "@/app/actions/project-manage";
import { archiveProjectInternal, unarchiveProjectInternal } from "@/app/actions/archive";
import { getProjectState as getControlPlaneProjectState, getWorkerSnapshot as getControlPlaneWorkerSnapshot } from "@/lib/control-plane";
import { getProjectRecipe, type ProjectRecipeId } from "@/lib/project-recipes";
import { isTestModeEnabledForRequest } from "@/lib/test-mode";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

const DEFAULT_WORKER_IMAGE = process.env.WORKER_IMAGE || "arena-public-worker:local";

/** Resolve agentLoopVersionId + toolId from loop name + tool name */
async function resolveLoopAndTool(agentImpl: string, agent: string): Promise<{ agentLoopVersionId: string | null; toolId: string | null }> {
  const loop = await (prisma as any).agentLoop.findUnique({
    where: { name: agentImpl },
    select: { currentVersionId: true },
  });
  const tool = await (prisma as any).tool.findUnique({
    where: { name: agent },
    select: { id: true },
  });
  return {
    agentLoopVersionId: loop?.currentVersionId ?? null,
    toolId: tool?.id ?? null,
  };
}
type ActionBody =
  | {
      action: "create_or_get_proposal";
      title?: string;
      description?: string;
      spec?: string;
    }
  | {
      action: "launch";
      proposalId: string;
      agent: string;
      agentImpl: string;
      runnerBackend: string;
      claudeAuthMode?: string | null;
      codexAuthMode?: string | null;
      model?: string | null;
      initialBudgetUsd?: number | null;
      repoUrl?: string | null;
      repoBranch?: string | null;
      vpsServerType?: string | null;
      providerBillingMode?: string | null;
    }
  | {
      action: "state";
      projectId: string;
    }
  | {
      action: "worker_snapshot";
      projectId: string;
    }
  | {
      action: "create_personal_agent_project";
      name?: string;
      spec?: string;
      agent?: string;
      agentImpl?: string;
      agentIntent?: "ON" | "OFF";
      model?: string | null;
      initialBudgetUsd?: number | null;
      runnerBackend?: string | null;
      vpsServerType?: string | null;
      codexAuthMode?: string | null;
      claudeAuthMode?: string | null;
    }
  | {
      action: "create_personal_recipe_project";
      recipeId: ProjectRecipeId;
      name?: string;
      initialBudgetUsd?: number | null;
      runnerBackend?: string | null;
      vpsServerType?: string | null;
    }
  | {
      action: "create_secret";
      projectId: string;
      key: string;
      value: string;
      description?: string;
    }
  | {
      action: "create_secret_from_env";
      projectId: string;
      key: string;
      envKey: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "TELEGRAM_BOT_TOKEN";
      description?: string;
    }
  | {
      action: "top_up_budget";
      projectId: string;
      amountUsd: number;
      note?: string;
    }
  | {
      action: "set_budget";
      projectId: string;
      totalCreditsUsd: number;
      isEnabled?: boolean;
      note?: string;
    }
  | {
      action: "create_spec";
      projectId: string;
      title?: string;
      content: string;
    }
  | {
      action: "agent_off";
      projectId: string;
    }
  | {
      action: "agent_on";
      projectId: string;
    }
  | {
      action: "relaunch_project";
      projectId: string;
    }
  | {
      action: "delete_project";
      projectId: string;
      removeDocker?: boolean;
      removeWorkspace?: boolean;
    }
  | {
      action: "power_off";
      projectId: string;
    }
  | {
      action: "power_on";
      projectId: string;
    }
  | {
      action: "archive_project";
      projectId: string;
    }
  | {
      action: "unarchive_project";
      projectId: string;
    }
  | {
      action: "unarchive_then_power_on";
      projectId: string;
    };

export function shouldSkipRepoProvisioningForHostRepo(envOverrides?: string | null): boolean {
  if (!envOverrides?.trim()) return false;

  try {
    const parsed = JSON.parse(envOverrides) as Record<string, unknown>;
    return parsed.ARENA_MOUNT_HOST_REPO === "1";
  } catch {
    return false;
  }
}

export function normalizeInitialAgentIntent(agentIntent?: string | null): "ON" | "OFF" {
  return agentIntent === "OFF" ? "OFF" : "ON";
}

async function createPersonalAgentProjectFixture(input: {
  name?: string;
  spec?: string;
  agent?: string;
  agentImpl?: string;
  agentIntent?: "ON" | "OFF";
  model?: string | null;
  initialBudgetUsd?: number | null;
  runnerBackend?: string | null;
  vpsServerType?: string | null;
  envOverrides?: string | null;
  codexAuthMode?: string | null;
  claudeAuthMode?: string | null;
}) {
  const name = input.name?.trim() || `A2E Personal Agent ${Date.now()}`;
  const spec = input.spec?.trim() || "Build a tiny healthy preview app and keep it running on port 3000.";
  const rawBudget = Number(input.initialBudgetUsd ?? 20);
  const initialBudgetUsd = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 20;
  const agent = input.agent?.trim() || "codex";
  const agentImpl = input.agentImpl?.trim() || "dummy";
  const agentIntent = normalizeInitialAgentIntent(input.agentIntent);
  const model = input.model?.trim() || "gpt-5.1-codex-mini";
  const runnerBackend = input.runnerBackend?.trim() || "local";
  const vpsServerType = input.vpsServerType?.trim() || null;
  const { agentLoopVersionId, toolId } = await resolveLoopAndTool(agentImpl, agent);

  const projectId = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name,
        mode: "personal",
        ownerScopeType: "user",
        ownerScopeId: "a2e-user",
        agent,
        agentImpl,
        model,
        codexAuthMode: input.codexAuthMode ?? null,
        claudeAuthMode: input.claudeAuthMode ?? null,
        envOverrides: input.envOverrides ?? null,
        runnerBackend,
        vpsServerType,
        toolId,
        agentLoopVersionId,
        visibility: "private",
        budget: {
          create: {
            isEnabled: true,
            totalCreditsUsd: initialBudgetUsd,
            usedCreditsUsd: 0,
          },
        },
        specs: {
          create: {
            title: name,
            content: spec,
            orderIndex: 0,
            versions: {
              create: {
                version: 1,
                content: spec,
                message: "Initial version",
              },
            },
          },
        },
        components: {
          create: {
            name: "main",
            kind: "app",
            powerIntent: "ON",
            runtimeState: "ABSENT",
            agentState: "IDLE",
            agentIntent,
            blockers: [],
            sourceType: "managed",
            sourceConfig: {
              recipe: "agent_project",
            },
            runtimeConfig: {
              model,
              cycleImage: DEFAULT_WORKER_IMAGE,
              runnerBackend,
              useRepoHead: true,
              ...(agentImpl === "dummy" || shouldSkipRepoProvisioningForHostRepo(input.envOverrides) ? { repoProvisioning: "skip" } : {}),
            },
          },
        },
      },
      select: { id: true },
    });

    await tx.runLog.create({
      data: {
        projectId: created.id,
        event: "LAUNCHED",
        detail: JSON.stringify({
          agent,
          agentImpl,
          model,
          personal: true,
          recipe: "agent_project",
          a2e: true,
        }),
      },
    });

    return created.id;
  });

  return { projectId };
}

async function createPersonalRecipeProjectFixture(input: {
  recipeId: ProjectRecipeId;
  name?: string;
  initialBudgetUsd?: number | null;
  runnerBackend?: string | null;
  vpsServerType?: string | null;
}) {
  const recipe = getProjectRecipe(input.recipeId);
  if (!recipe) {
    return { success: false, error: `Unknown recipe: ${input.recipeId}` };
  }
  const name = input.name?.trim() || `${recipe.title} ${Date.now()}`;
  const rawBudget = Number(input.initialBudgetUsd ?? 20);
  const initialBudgetUsd = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 20;
  const runnerBackend = input.runnerBackend?.trim() || "local";
  const vpsServerType = input.vpsServerType?.trim() || null;
  const envOverrides = recipe.envOverrides ? JSON.stringify(recipe.envOverrides) : null;
  const recipeRuntimeConfig =
    recipe.component.runtimeConfig && typeof recipe.component.runtimeConfig === "object"
      ? recipe.component.runtimeConfig as Record<string, unknown>
      : {};
  const cycleImage =
    typeof recipeRuntimeConfig.cycleImage === "string" && recipeRuntimeConfig.cycleImage.trim()
      ? recipeRuntimeConfig.cycleImage
      : DEFAULT_WORKER_IMAGE;
  const blockingRequiredSecrets = recipe.requiredSecrets.filter((entry) => entry.blocking !== false);
  const powerIntent = blockingRequiredSecrets.length > 0 ? "OFF" : "ON";
  const blockers = blockingRequiredSecrets.length > 0 ? ["SECRETS"] : [];
  const agentState = blockingRequiredSecrets.length > 0 ? "IDLE" : null;
  const { agentLoopVersionId, toolId } = await resolveLoopAndTool(recipe.agentImpl, recipe.agent);

  const projectId = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name,
        mode: "personal",
        ownerScopeType: "user",
        ownerScopeId: "a2e-user",
        agent: recipe.agent,
        agentImpl: recipe.agentImpl,
        envOverrides,
        runnerBackend,
        vpsServerType,
        toolId,
        agentLoopVersionId,
        visibility: "private",
        requiredSecrets: recipe.requiredSecrets.length > 0 ? JSON.stringify(recipe.requiredSecrets) : null,
        budget: {
          create: {
            isEnabled: true,
            totalCreditsUsd: initialBudgetUsd,
            usedCreditsUsd: 0,
          },
        },
        components: {
          create: {
            name: recipe.component.name,
            kind: recipe.component.kind,
            powerIntent,
            runtimeState: "ABSENT",
            agentState,
            blockers,
            sourceType: recipe.component.sourceType,
            sourceConfig: recipe.component.sourceConfig as any,
            runtimeConfig: {
              ...recipeRuntimeConfig,
              cycleImage,
              runnerBackend,
            } as any,
          },
        },
      },
      select: { id: true },
    });

    await tx.runLog.create({
      data: {
        projectId: created.id,
        event: "LAUNCHED",
        detail: JSON.stringify({
          personal: true,
          recipe: recipe.id,
          agent: recipe.agent,
          agentImpl: recipe.agentImpl,
          a2e: true,
        }),
      },
    });

    if (blockers.includes("SECRETS")) {
      await tx.runLog.create({
        data: {
          projectId: created.id,
          event: "SECRETS_BLOCKED",
          detail: JSON.stringify({
            reason: "initial_recipe_setup",
            missingSecrets: blockingRequiredSecrets.map((entry) => entry.key),
          }),
        },
      });
    }

    return created.id;
  });

  return { projectId };
}

export async function GET(request: Request) {
  if (!isTestModeEnabledForRequest(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const project = await getControlPlaneProjectState(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function POST(request: Request) {
  if (!isTestModeEnabledForRequest(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as ActionBody | null;
  if (!body?.action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  // Validate projectId for actions that require it (A2E #5 finding: missing projectId → Prisma crash)
  const actionsRequiringProjectId = new Set([
    "state", "worker_snapshot", "agent_off", "agent_on", "relaunch_project", "delete_project",
    "top_up_budget", "set_budget", "create_spec", "create_secret", "create_secret_from_env",
    "power_off", "power_on", "archive_project", "unarchive_project", "unarchive_then_power_on",
  ]);
  if (actionsRequiringProjectId.has(body.action) && !(body as any).projectId?.trim()) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "create_personal_agent_project": {
        const result = await createPersonalAgentProjectFixture(body as any);
        return NextResponse.json(result);
      }

      case "create_personal_recipe_project": {
        const result = await createPersonalRecipeProjectFixture(body);
        return NextResponse.json(result);
      }

      case "create_or_get_proposal": {
        const title = body.title?.trim() || "A2E Telegram Bot Inspector";
        const existing = await prisma.proposal.findFirst({
          where: { title },
          select: { id: true, title: true },
        });
        if (existing) {
          return NextResponse.json({ proposalId: existing.id, reused: true });
        }

        const proposal = await prisma.proposal.create({
          data: {
            title,
            description: body.description?.trim() || "Minimal app that requires a Telegram bot token and exposes bot info in preview.",
            spec: body.spec?.trim() || [
              "Build a very small web app.",
              "",
              "Requirements:",
              "- The homepage should show a single button: \"Check Telegram Bot\".",
              "- When clicked, the app should call Telegram Bot API getMe and display:",
              "  - bot username",
              "  - bot id",
              "  - whether the bot can join groups",
              "- The app must never expose the bot token in HTML or client-side JS.",
              "- The app should display a clear loading state and an error state.",
              "- The app should run on port 3000.",
              "",
              "The app must work in preview and must use a secret for the Telegram bot token.",
            ].join("\n"),
            status: "APPROVED",
          },
          select: { id: true },
        });
        return NextResponse.json({ proposalId: proposal.id, reused: false });
      }

      case "launch": {
        const { toolId } = await resolveLoopAndTool(body.agentImpl, body.agent);
        const result = await launchProposal(body.proposalId, {
          agent: body.agent,
          agentImpl: body.agentImpl,
          runnerBackend: body.runnerBackend,
          claudeAuthMode: body.claudeAuthMode ?? null,
          codexAuthMode: body.codexAuthMode ?? null,
          model: body.model ?? null,
          initialBudgetUsd: body.initialBudgetUsd ?? undefined,
          repoUrl: body.repoUrl ?? null,
          repoBranch: body.repoBranch ?? null,
          vpsServerType: body.vpsServerType ?? null,
          providerBillingMode: body.providerBillingMode ?? null,
          toolId,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

    case "state": {
      const project = await getControlPlaneProjectState(body.projectId);
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json(project);
    }

    case "worker_snapshot": {
      const snapshot = await getControlPlaneWorkerSnapshot(body.projectId);
      if (!snapshot) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      return NextResponse.json(snapshot);
    }

      case "create_secret": {
        const result = await createProjectSecretInternal(body.projectId, body.key, body.value, body.description, {
          internalActionToken: INTERNAL_ACTION_TOKEN,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "create_secret_from_env": {
        const envValue = process.env[body.envKey];
        if (!envValue) {
          return NextResponse.json({ success: false, error: `${body.envKey} is not configured` }, { status: 400 });
        }

        const result = await createProjectSecretInternal(body.projectId, body.key, envValue, body.description, {
          internalActionToken: INTERNAL_ACTION_TOKEN,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "top_up_budget": {
        const result = await addProjectCreditsInternal(body.projectId, body.amountUsd, body.note, {
          internalActionToken: INTERNAL_ACTION_TOKEN,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "set_budget": {
        const result = await setProjectBudgetLimitInternal(
          body.projectId,
          body.totalCreditsUsd,
          body.isEnabled ?? true,
          body.note,
          { internalActionToken: INTERNAL_ACTION_TOKEN },
        );
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "create_spec": {
        const result = await createSpecInternal(body.projectId, {
          title: body.title,
          content: body.content,
        }, INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "agent_off": {
        const result = await setAgentIntentInternal(body.projectId, "OFF", INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "agent_on": {
        const result = await setAgentIntentInternal(body.projectId, "ON", INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "relaunch_project": {
        const result = await relaunchProjectInternal(body.projectId, INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "delete_project": {
        const result = await deleteProjectInternal(body.projectId, {
          removeDocker: body.removeDocker,
          removeWorkspace: body.removeWorkspace,
          internalActionToken: INTERNAL_ACTION_TOKEN,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "power_off": {
        const result = await setPowerIntentInternal(body.projectId, "OFF", INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "power_on": {
        const result = await setPowerIntentInternal(body.projectId, "ON", INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "archive_project": {
        const result = await archiveProjectInternal(body.projectId, INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "unarchive_project": {
        const result = await unarchiveProjectInternal(body.projectId, INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case "unarchive_then_power_on": {
        const unarchiveResult = await unarchiveProjectInternal(body.projectId, INTERNAL_ACTION_TOKEN);
        if (!unarchiveResult.success) {
          return NextResponse.json(unarchiveResult, { status: 400 });
        }

        const result = await setPowerIntentInternal(body.projectId, "ON", INTERNAL_ACTION_TOKEN);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      default:
        return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[a2e] route failed:", error);
    return NextResponse.json(
      { error: "A2E route failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

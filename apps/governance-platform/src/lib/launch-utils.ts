import type { Prisma } from "@prisma/client";
import { BUDGET_THRESHOLD_USD } from "@/lib/project-budget";
import { buildWorkspaceLabel } from "@/lib/workspace-label";

type TransactionClient = Prisma.TransactionClient;

export async function createProjectFromProposal(
  tx: TransactionClient,
  proposal: { id: string; title?: string | null; spec: string | null; createdById?: string | null },
  config: {
    agent: string;
    agentImpl: string;
    model: string | null;
    envOverrides?: string | null;
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
    runnerBackend?: string | null;
    repoUrl?: string | null;
    repoBranch?: string | null;
    vpsServerType?: string | null;
    toolId?: string | null;
    agentLoopVersionId?: string | null;
    providerBillingMode?: string | null;
  },
  opts?: {
    createdById?: string;
    initialBudgetUsd?: number | null;
  },
) {
  const repoBranch = config.repoBranch || process.env.DEFAULT_PROJECT_BRANCH || "main";
  const repoUrl = config.repoUrl || null;
  const hasBudgetLimit = opts?.initialBudgetUsd != null;
  const initialBudgetUsd = hasBudgetLimit ? Number(opts.initialBudgetUsd) : null;

  if (initialBudgetUsd !== null && (!Number.isFinite(initialBudgetUsd) || initialBudgetUsd <= BUDGET_THRESHOLD_USD)) {
    throw new Error(`Initial budget must be greater than $${BUDGET_THRESHOLD_USD.toFixed(2)}`);
  }

  // Copy proposal spec as the first Spec entity
  const specContent = proposal.spec || "";
  const projectName = proposal.title?.trim() || `Project ${proposal.id.slice(-6)}`;
  const ownerScopeId = opts?.createdById ?? proposal.createdById ?? null;

  // RA-120: Seed log with LAUNCHED lifecycle event
  const launchedLine = JSON.stringify({ ts: Date.now(), lc: "LAUNCHED" }) + "\n";

  const project = await tx.project.create({
    data: {
      name: projectName,
      mode: "community",
      ownerScopeType: "user",
      ownerScopeId,
      proposalId: proposal.id,
      // RA-237: no project-level state. archivedAt=null means active.
      agent: config.agent,
      agentImpl: config.agentImpl,
      model: config.model,
      envOverrides: config.envOverrides ?? null,
      claudeAuthMode: config.claudeAuthMode ?? null,
      codexAuthMode: config.codexAuthMode ?? null,
      providerBillingMode: config.providerBillingMode ?? "byok",
      runnerBackend: config.runnerBackend ?? "local",
      vpsServerType: config.vpsServerType ?? null,
      toolId: config.toolId ?? null,
      agentLoopVersionId: config.agentLoopVersionId ?? null,
      repoUrl,
      repoBranch,
      specSnapshot: specContent,
      log: launchedLine,
    },
  });

  await tx.projectComponent.create({
    data: {
      projectId: project.id,
      name: "main",
      kind: "app",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      sourceType: repoUrl ? "git" : "managed",
      sourceConfig: {
        repoUrl,
        repoBranch,
        agent: config.agent,
        agentImpl: config.agentImpl,
        toolId: config.toolId ?? null,
        agentLoopVersionId: config.agentLoopVersionId ?? null,
      },
      runtimeConfig: {
        runnerBackend: config.runnerBackend ?? "local",
        cycleImage: "arena-public-worker:local",
        model: config.model,
        envOverrides: config.envOverrides ?? null,
        claudeAuthMode: config.claudeAuthMode ?? null,
        codexAuthMode: config.codexAuthMode ?? null,
        providerBillingMode: config.providerBillingMode ?? "byok",
        vpsServerType: config.vpsServerType ?? null,
        ...(config.agentImpl === "dummy" ? { repoProvisioning: "skip" } : {}),
        useRepoHead: true,
      },
    },
  });

  if (initialBudgetUsd != null) {
    await tx.projectBudget.create({
      data: {
        projectId: project.id,
        isEnabled: true,
        totalCreditsUsd: initialBudgetUsd,
        usedCreditsUsd: 0,
        note: "Initial project budget",
      },
    });
  }

  if (opts?.createdById && initialBudgetUsd != null) {
    await tx.projectBudgetAdjustment.create({
      data: {
        projectId: project.id,
        createdById: opts.createdById,
        amountUsd: initialBudgetUsd,
        kind: "SET_LIMIT",
        note: "Initial project budget",
      },
    });
  }

  if (specContent) {
    await tx.spec.create({
      data: {
        projectId: project.id,
        title: proposal.title?.trim() || "Specification",
        content: specContent,
        orderIndex: 0,
      },
    });
  }

  // RA-216: Set immutable slug for runtime identity
  await tx.project.update({
    where: { id: project.id },
    data: { slug: buildWorkspaceLabel(projectName, project.id) },
  });

  // Write launch event to RunLog
  await tx.runLog.create({
    data: {
      projectId: project.id,
      event: "LAUNCHED",
      detail: JSON.stringify({ agent: config.agent, agentImpl: config.agentImpl, model: config.model, ...(repoUrl ? { repoUrl, repoBranch } : {}) }),
    },
  });

  return { project };
}

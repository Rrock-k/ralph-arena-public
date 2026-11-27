import {
  acceptedSpecArtifactRequiresLoopWork,
  parseAcceptedSpecArtifact,
  type RunnerRalphConfig,
} from "@arena/contracts";
import { filterCapabilitiesByFlags } from "@/lib/capability-flags";
import { getProjectAssetManifest } from "@/lib/project-assets";
import { getProjectDescription, getProjectName } from "@/lib/project-identity";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { runtimeConfigUsesRepoHead } from "@/lib/loop-support";
import { buildRunnerSpecsPayload, getSpecInputUpdatedAt, RUNNER_SPEC_SELECT } from "@/lib/runner-specs";
import { prisma } from "@/lib/prisma";
import { buildRunnerRalphConfigFromRuntimeConfig } from "@/lib/visual-workbench-runtime-config";

export const RUNNER_INIT_READINESS_SCHEMA_VERSION = "ra-356.runner-init-readiness.v1" as const;

type RunnerInitProject = {
  id: string;
  repoUrl: string | null;
  repoBranch: string | null;
  commitSha: string | null;
  agent: string;
  agentImpl: string;
  model: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
  providerBillingMode: string | null;
  visibility: string;
  proposal: { title: string | null; description: string | null } | null;
  specs: Array<Parameters<typeof getSpecInputUpdatedAt>[0]>;
  secrets: Array<{ key: string }>;
  components: Array<{
    kind?: string | null;
    agentIntent?: string | null;
    lastOutcome?: string | null;
    lastOutcomeAt?: Date | string | null;
    sourceConfig?: unknown;
    runtimeConfig?: unknown;
  }>;
  agentLoopVersion: {
    version: string | null;
    commandTemplate: string | null;
    capabilities: string[] | null;
    agentLoop: {
      sourceUrl: string | null;
      installCommand: string | null;
    } | null;
  } | null;
};

export type RunnerInitProjection = {
  repo: {
    url: string;
    baseBranch: string;
    projectBranch: string;
    runBranch: string;
  } | null;
  specs: ReturnType<typeof buildRunnerSpecsPayload>["specs"];
  specsHash: string;
  assets: Awaited<ReturnType<typeof getProjectAssetManifest>>["assets"];
  assetsHash: string;
  proposal: {
    title: string;
    description: string;
  };
  project: {
    id: string;
    name: string;
    hasPendingLoopWork: boolean;
    agent: string;
    agentImpl: string;
    model: string | null;
    claudeAuthMode: string | null;
    codexAuthMode: string | null;
    providerBillingMode: string;
    commitSha: string | null;
    agentIntent: string;
  };
  capabilities: string[];
  commandTemplate: string | null;
  commandSource: "component_runtime_config" | "agent_loop_version" | "missing";
  commandLegacyPathNormalized: boolean;
  loopSource: {
    url: string;
    ref?: string;
    installCommand?: string;
  } | null;
  ralphConfig: RunnerRalphConfig | null;
  ralphConfigError: string | null;
  platformPrompt: string;
  secretCount: number;
};

export type RunnerInitReadinessSummary =
  | {
      schemaVersion: typeof RUNNER_INIT_READINESS_SCHEMA_VERSION;
      projectId: string;
      available: false;
      unavailableReason: "project_missing";
      blockers: string[];
      evidenceNotes: string[];
    }
  | {
      schemaVersion: typeof RUNNER_INIT_READINESS_SCHEMA_VERSION;
      projectId: string;
      available: true;
      project: RunnerInitProjection["project"];
      repo: {
        present: boolean;
        baseBranch: string | null;
        projectBranch: string | null;
        commitSha: string | null;
      };
      specs: {
        count: number;
        hash: string;
      };
      assets: {
        count: number;
        hash: string;
      };
      secrets: {
        count: number;
      };
      capabilities: {
        count: number;
        values: string[];
      };
      command: {
        present: boolean;
        source: RunnerInitProjection["commandSource"];
        legacyPathNormalized: boolean;
        requiresLoopSource: boolean;
        loopSourcePresent: boolean;
        unresolvedPlaceholders: string[];
        resolvable: boolean;
      };
      loopSource: {
        present: boolean;
        ref: string | null;
        installCommandPresent: boolean;
      };
      ralphConfig: {
        present: boolean;
        visualEvidenceMode: "off" | "required" | "new_tasks_only" | null;
        visualEvidenceModeError: string | null;
        visualWorkbenchExecutorCaptureShell: "allowlisted" | "not_configured";
      };
      blockers: string[];
      evidenceNotes: string[];
    };

export const RUNNER_INIT_PROJECT_INCLUDE = {
  components: {
    orderBy: { createdAt: "asc" },
    take: 1,
  },
  proposal: { select: { title: true, description: true } },
  specs: {
    orderBy: { orderIndex: "asc" },
    select: RUNNER_SPEC_SELECT,
  },
  secrets: true,
  agentLoopVersion: { include: { agentLoop: true } },
} as const;

export function buildPlatformPrompt(visibility: string): string {
  const visibilityDesc: Record<string, string> = {
    featured: "Anyone can access your app — no sign-in required.",
    public: "Only authenticated platform users can access your app.",
    private: "Only the project owner and admins can access your app.",
  };

  return `## Multi-User Runtime

Your app is served behind an authentication proxy. Multiple users will access it simultaneously.

**Visitor identity:** Each request includes an \`X-Ralph-Anon-Id\` HTTP header — a stable, anonymous, per-project identifier for the current visitor (16-char hex string). Use this header to implement per-user state (preferences, game progress, user-specific data, sessions).

**Project access:** Preview requests that pass through Arena preview-gate include project-scoped access headers:
- \`X-Arena-Project-Id\` — the current Arena project id.
- \`X-Arena-Project-Role\` — one of \`public\`, \`viewer\`, \`member\`, \`admin\`, \`owner\`.
- \`X-Arena-Project-Capabilities\` — comma-separated app-scoped Arena project capabilities, derived from project owner and direct project \`AccessGrant\` truth. Platform/operator grants are not exposed to generated apps as app-admin capabilities.

**Important:**
- Do NOT ask users to "sign in" or create accounts — identity is handled by the platform.
- Do NOT generate or assign your own user IDs — always use \`X-Ralph-Anon-Id\`.
- The same visitor always gets the same ID for this project, but IDs differ across projects.
- Unauthenticated requests (e.g. health checks) will not have this header.
- Do NOT check Telegram, email addresses, global user roles or hardcoded user ids for project admin features.
- Do NOT treat Arena platform/operator admins as project app admins unless the headers explicitly say \`owner\` or \`admin\`.
- Treat missing project access headers as \`public\` with no capabilities.
- For admin-only app features such as video generation, hide UI and protect server endpoints by checking \`X-Arena-Project-Role=owner|admin\` or the explicit project capabilities in \`X-Arena-Project-Capabilities\` on every request.

**Access level:** ${visibilityDesc[visibility] || visibilityDesc.public}
`;
}

export function normalizeLegacyLoopCommandTemplate(
  commandTemplate: string | null,
  loopSource: { url: string; ref?: string; installCommand?: string } | null,
): string | null {
  if (!commandTemplate || !loopSource) return commandTemplate;
  if (!commandTemplate.includes("/ralph/")) return commandTemplate;
  return commandTemplate.replaceAll("/ralph", "{loopdir}");
}

export function injectGithubTokenInRepoUrl(repoUrl: string): string {
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken && repoUrl.startsWith("https://github.com/")) {
    return repoUrl.replace(
      "https://github.com/",
      `https://x-access-token:${githubToken}@github.com/`,
    );
  }
  return repoUrl;
}

export async function buildRunnerInitProjection(
  project: RunnerInitProject,
  options: { tolerateInvalidRalphConfig?: boolean } = {},
): Promise<RunnerInitProjection> {
  const { specs, hash: specsHash } = buildRunnerSpecsPayload(project.specs);
  const assetManifest = await getProjectAssetManifest(project.id);
  const primaryComponent = getPrimaryLifecycleComponent(project);
  const hasPendingSpecChanges = getInitialPendingSpecChanges(primaryComponent, project.specs);
  const hasPendingLoopWork = hasPendingSpecChanges || primaryComponent?.lastOutcome == null;
  const activeCommitSha = hasPendingLoopWork ? null : project.commitSha;
  const sourceConfig =
    primaryComponent && primaryComponent.sourceConfig && typeof primaryComponent.sourceConfig === "object"
      ? (primaryComponent.sourceConfig as Record<string, unknown>)
      : null;
  const runtimeConfig =
    primaryComponent && primaryComponent.runtimeConfig && typeof primaryComponent.runtimeConfig === "object"
      ? (primaryComponent.runtimeConfig as Record<string, unknown>)
      : null;
  const repoUrl =
    project.repoUrl ||
    (typeof sourceConfig?.repoUrl === "string" ? sourceConfig.repoUrl : "") ||
    "";
  const repoBranch =
    project.repoBranch ||
    (typeof sourceConfig?.repoBranch === "string" ? sourceConfig.repoBranch : "") ||
    "main";
  const runtimeCommandTemplate = typeof runtimeConfig?.commandTemplate === "string"
    ? runtimeConfig.commandTemplate
    : null;
  const commandTemplate =
    runtimeCommandTemplate ??
    project.agentLoopVersion?.commandTemplate ??
    null;
  const commandSource = runtimeCommandTemplate
    ? "component_runtime_config"
    : project.agentLoopVersion?.commandTemplate
      ? "agent_loop_version"
      : "missing";
  const rawCapabilities = project.agentLoopVersion?.capabilities ?? [];
  const capabilities = await filterCapabilitiesByFlags(rawCapabilities);
  const useRepoHead = runtimeConfigUsesRepoHead(runtimeConfig);
  const loopSourceUrl = project.agentLoopVersion?.agentLoop?.sourceUrl ?? null;
  const loopVersion = project.agentLoopVersion?.version;
  const loopSource = loopSourceUrl
    ? {
        url: loopSourceUrl,
        ...(!useRepoHead && loopVersion ? { ref: `v${loopVersion}` } : {}),
        ...(project.agentLoopVersion!.agentLoop!.installCommand
          ? { installCommand: project.agentLoopVersion!.agentLoop!.installCommand }
          : {}),
      }
    : null;
  const normalizedCommandTemplate = normalizeLegacyLoopCommandTemplate(commandTemplate, loopSource);
  let ralphConfig: RunnerRalphConfig | null = null;
  let ralphConfigError: string | null = null;
  try {
    ralphConfig = buildRunnerRalphConfigFromRuntimeConfig(runtimeConfig);
  } catch (error) {
    if (!options.tolerateInvalidRalphConfig) throw error;
    ralphConfigError = error instanceof Error ? error.message : String(error);
  }

  return {
    repo: repoUrl
      ? {
          url: repoUrl,
          baseBranch: repoBranch,
          projectBranch: `arena/project-${project.id}`,
          runBranch: `arena/project-${project.id}`,
        }
      : null,
    specs,
    specsHash,
    assets: assetManifest.assets,
    assetsHash: assetManifest.hash,
    proposal: {
      title: project.proposal?.title ?? getProjectName(project),
      description: project.proposal?.description ?? getProjectDescription(project) ?? "",
    },
    project: {
      id: project.id,
      name: getProjectName(project),
      hasPendingLoopWork,
      agent: project.agent,
      agentImpl: project.agentImpl,
      model: runtimeConfig?.model ? String(runtimeConfig.model) : project.model,
      claudeAuthMode: project.claudeAuthMode,
      codexAuthMode: project.codexAuthMode,
      providerBillingMode: project.providerBillingMode ?? "byok",
      commitSha: activeCommitSha,
      agentIntent: primaryComponent?.agentIntent ?? "ON",
    },
    capabilities,
    commandTemplate: normalizedCommandTemplate,
    commandSource,
    commandLegacyPathNormalized: commandTemplate !== normalizedCommandTemplate,
    loopSource,
    ralphConfig,
    ralphConfigError,
    platformPrompt: buildPlatformPrompt(project.visibility),
    secretCount: project.secrets.length,
  };
}

export async function buildRunnerInitReadinessSummary(projectId: string): Promise<RunnerInitReadinessSummary> {
  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    include: RUNNER_INIT_PROJECT_INCLUDE,
  });

  if (!project) {
    return {
      schemaVersion: RUNNER_INIT_READINESS_SCHEMA_VERSION,
      projectId,
      available: false,
      unavailableReason: "project_missing",
      blockers: ["project_missing"],
      evidenceNotes: [
        "Runner init readiness is a governance read-side summary; it does not call runner init or decrypt secrets.",
      ],
    };
  }

  const projection = await buildRunnerInitProjection(project, { tolerateInvalidRalphConfig: true });
  const unresolvedPlaceholders = listUnresolvedCommandPlaceholders(projection.commandTemplate);
  const requiresLoopSource = Boolean(projection.commandTemplate?.includes("{loopdir}"));
  const blockers = [
    ...(!projection.commandTemplate ? ["init_command_missing"] : []),
    ...(requiresLoopSource && !projection.loopSource ? ["loop_source_missing"] : []),
    ...(unresolvedPlaceholders.length > 0 ? ["init_command_unresolved_placeholders"] : []),
    ...(projection.ralphConfigError ? ["visual_evidence_runtime_config_invalid"] : []),
  ];

  return {
    schemaVersion: RUNNER_INIT_READINESS_SCHEMA_VERSION,
    projectId,
    available: true,
    project: projection.project,
    repo: {
      present: projection.repo !== null,
      baseBranch: projection.repo?.baseBranch ?? null,
      projectBranch: projection.repo?.projectBranch ?? null,
      commitSha: projection.project.commitSha,
    },
    specs: {
      count: projection.specs.length,
      hash: projection.specsHash,
    },
    assets: {
      count: projection.assets.length,
      hash: projection.assetsHash,
    },
    secrets: {
      count: projection.secretCount,
    },
    capabilities: {
      count: projection.capabilities.length,
      values: projection.capabilities,
    },
    command: {
      present: projection.commandTemplate !== null,
      source: projection.commandSource,
      legacyPathNormalized: projection.commandLegacyPathNormalized,
      requiresLoopSource,
      loopSourcePresent: projection.loopSource !== null,
      unresolvedPlaceholders,
      resolvable: blockers.length === 0,
    },
    loopSource: {
      present: projection.loopSource !== null,
      ref: projection.loopSource?.ref ?? null,
      installCommandPresent: Boolean(projection.loopSource?.installCommand),
    },
    ralphConfig: {
      present: projection.ralphConfig !== null,
      visualEvidenceMode: projection.ralphConfigError
        ? null
        : projection.ralphConfig?.visualWorkbench.visualEvidenceMode ?? "off",
      visualEvidenceModeError: projection.ralphConfigError,
      visualWorkbenchExecutorCaptureShell:
        projection.ralphConfig?.visualWorkbench.executorCaptureShell.mode === "allowlisted"
          ? "allowlisted"
          : "not_configured",
    },
    blockers,
    evidenceNotes: [
      "Runner init readiness is a governance read-side summary; it does not call runner init or decrypt secrets.",
      "Command readiness reports template shape only and never returns the raw command template.",
      ...(projection.ralphConfigError
        ? [`Visual evidence runtimeConfig is invalid: ${projection.ralphConfigError}`]
        : []),
    ],
  };
}

function getInitialPendingSpecChanges(
  component: { lastOutcomeAt?: Date | string | null } | null,
  specs: Parameters<typeof getSpecInputUpdatedAt>[0][] | null | undefined,
): boolean {
  if (!component?.lastOutcomeAt) return false;

  const lastOutcomeAt = component.lastOutcomeAt instanceof Date
    ? component.lastOutcomeAt
    : new Date(component.lastOutcomeAt);
  if (Number.isNaN(lastOutcomeAt.getTime())) return false;

  return (specs ?? []).some((spec) => {
    const updatedAt = getSpecInputUpdatedAt(spec);
    return !!updatedAt
      && updatedAt.getTime() > lastOutcomeAt.getTime()
      && specRequiresLoopWork(spec);
  });
}

function specRequiresLoopWork(spec: Parameters<typeof getSpecInputUpdatedAt>[0]): boolean {
  const acceptedArtifact = spec.versions?.[0]?.acceptedArtifact;
  if (!acceptedArtifact) return true;
  return acceptedSpecArtifactRequiresLoopWork(parseAcceptedSpecArtifact(acceptedArtifact));
}

function listUnresolvedCommandPlaceholders(commandTemplate: string | null): string[] {
  if (!commandTemplate) return [];
  const allowed = new Set(["agent", "specdir", "specfile", "workdir", "loopdir", "model"]);
  const placeholders = [...commandTemplate.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
  return [...new Set(placeholders.filter((placeholder) => !allowed.has(placeholder)))];
}

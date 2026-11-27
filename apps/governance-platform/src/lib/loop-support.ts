import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";

export const LOOP_SUPPORT_TIERS = [
  "supported",
  "unsupported",
] as const;

export type LoopSupportTier = (typeof LOOP_SUPPORT_TIERS)[number];
export type LoopAction = "power_on" | "agent_on" | "relaunch" | "launch";
export type LoopSupportStatus = "supported" | "upgrade-required" | "unsupported";

type LoopSupportInput = {
  agentImpl?: string | null;
  loopName?: string | null;
  loopVersion?: string | null;
  supportTier?: string | null;
  useRepoHead?: boolean | null;
  hasLoopVersion?: boolean | null;
};

export type ResolvedLoopSupport = {
  loopIdentity: string;
  loopName: string;
  baseSupportTier: LoopSupportTier | null;
  supportStatus: LoopSupportStatus | null;
  supportLabel: string | null;
  supportHint: string | null;
  identityMode: "repo-head" | "pinned-version" | "unversioned";
  metadataVersionLabel: string | null;
  mismatchReason: string | null;
  appStartAllowed: boolean;
  agentStartAllowed: boolean;
  relaunchAllowed: boolean;
};

type LoopActionSupportState = {
  loopIdentity?: string | null;
  supportStatus?: LoopSupportStatus | null;
  agentStartAllowed?: boolean;
  relaunchAllowed?: boolean;
};

function normalizeLoopName(input: LoopSupportInput): string {
  const loopName = input.loopName?.trim();
  if (loopName) return loopName;
  const agentImpl = input.agentImpl?.trim();
  return agentImpl || "unknown";
}

function formatVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function normalizeLoopSupportTier(value: unknown): LoopSupportTier | null {
  if (typeof value !== "string") return null;
  switch (value) {
    case "supported":
    case "resident-supported":
      return "supported";
    case "unsupported":
    case "preview-only-supported":
    case "legacy-limited":
      return "unsupported";
    default:
      return null;
  }
}

export function runtimeConfigUsesRepoHead(runtimeConfig: unknown): boolean {
  return runtimeConfig != null
    && typeof runtimeConfig === "object"
    && "useRepoHead" in runtimeConfig
    && (runtimeConfig as { useRepoHead?: unknown }).useRepoHead === true;
}

export function getLoopSupportLabel(tier: LoopSupportTier | null): string | null {
  if (!tier) return null;
  switch (tier) {
    case "supported":
      return "supported";
    case "unsupported":
      return "unsupported";
  }
}

function getLoopSupportStatusLabel(status: LoopSupportStatus | null): string | null {
  if (!status) return null;
  switch (status) {
    case "supported":
      return "supported";
    case "upgrade-required":
      return "upgrade required";
    case "unsupported":
      return "unsupported";
  }
}

export function getAdminLoopIdentity(project: LoopSupportInput): string {
  const loopName = normalizeLoopName(project);
  const versionLabel = formatVersion(project.loopVersion);

  if (project.useRepoHead === true) return `${loopName} Bundled default`;
  if (versionLabel) return `${loopName} Pinned ${versionLabel}`;
  return loopName;
}

export function resolveLoopSupport(input: LoopSupportInput): ResolvedLoopSupport {
  const loopName = normalizeLoopName(input);
  const loopIdentity = getAdminLoopIdentity(input);
  const baseSupportTier =
    normalizeLoopSupportTier(input.supportTier) ?? (input.hasLoopVersion ? "unsupported" : null);
  const metadataVersionLabel = formatVersion(input.loopVersion);

  const agentImpl = input.agentImpl?.trim();
  const explicitLoopName = input.loopName?.trim();
  const mismatchReason =
    agentImpl && explicitLoopName && agentImpl !== explicitLoopName
      ? `agentImpl "${agentImpl}" does not match loop "${explicitLoopName}"`
      : null;

  const hasExplicitLoopMode = input.useRepoHead === true || input.hasLoopVersion === true;
  let supportStatus: LoopSupportStatus | null = null;
  let supportHint: string | null = null;

  if (mismatchReason) {
    supportStatus = "unsupported";
    supportHint = mismatchReason;
  } else if (input.useRepoHead === true) {
    supportStatus = baseSupportTier === "unsupported" ? "unsupported" : "supported";
    supportHint = supportStatus === "supported"
      ? "Bundled default is the only supported Ralph runtime right now."
      : "Bundled default is blocked because this loop is outside the supported set.";
  } else if (hasExplicitLoopMode) {
    supportStatus = "upgrade-required";
    supportHint = "Pinned loop versions are history-only. Upgrade this project to the bundled default runtime before restarting it.";
  }

  const appStartAllowed = true;
  const agentStartAllowed = supportStatus == null || supportStatus === "supported";
  const relaunchAllowed = agentStartAllowed;

  return {
    loopIdentity,
    loopName,
    baseSupportTier,
    supportStatus,
    supportLabel: getLoopSupportStatusLabel(supportStatus),
    supportHint,
    identityMode: input.useRepoHead === true
      ? "repo-head"
      : metadataVersionLabel
        ? "pinned-version"
        : "unversioned",
    metadataVersionLabel,
    mismatchReason,
    appStartAllowed,
    agentStartAllowed,
    relaunchAllowed,
  };
}

export function getLoopActionBlockMessage(
  support: ResolvedLoopSupport,
  action: LoopAction,
): string | null {
  return getLoopActionBlockMessageFromState(support, action);
}

export function getLoopActionBlockMessageFromState(
  support: LoopActionSupportState,
  action: LoopAction,
): string | null {
  const loopIdentity = support.loopIdentity ?? "This loop";
  const supportStatus = support.supportStatus ?? null;
  const agentStartAllowed = support.agentStartAllowed ?? true;
  const relaunchAllowed = support.relaunchAllowed ?? true;

  switch (action) {
    case "power_on":
      return null;
    case "agent_on":
      if (!agentStartAllowed) {
        if (supportStatus === "upgrade-required") {
          return `${loopIdentity} is not on the supported bundled default runtime. Upgrade this project before starting the agent.`;
        }
        return `${loopIdentity} is unsupported. Agent ON is blocked until the loop configuration is fixed.`;
      }
      return null;
    case "relaunch":
      if (!relaunchAllowed) {
        if (supportStatus === "upgrade-required") {
          return `${loopIdentity} is not on the supported bundled default runtime. Upgrade this project before relaunching it.`;
        }
        return `${loopIdentity} is unsupported. Relaunch is blocked until the loop configuration is fixed.`;
      }
      return null;
    case "launch":
      if (!relaunchAllowed) {
        if (supportStatus === "upgrade-required") {
          return `${loopIdentity} is not on the supported bundled default runtime. Upgrade this project before launching it.`;
        }
        return `${loopIdentity} is unsupported. Agent launch is blocked until the loop configuration is fixed.`;
      }
      return null;
  }
}

export async function getProjectLoopSupport(
  prismaLike: {
    project: {
      findUnique: (args: unknown) => Promise<any>;
    };
  },
  projectId: string,
): Promise<ResolvedLoopSupport | null> {
  const project = await prismaLike.project.findUnique({
    where: { id: projectId },
    select: {
      agentImpl: true,
      agentLoopVersionId: true,
      agentLoopVersion: {
        select: {
          version: true,
          supportTier: true,
          agentLoop: {
            select: {
              name: true,
            },
          },
        },
      },
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          runtimeConfig: true,
        },
      },
    },
  });

  if (!project) return null;

  const primaryComponent = getPrimaryLifecycleComponent(project);
  const runtimeConfig =
    primaryComponent?.runtimeConfig && typeof primaryComponent.runtimeConfig === "object"
      ? (primaryComponent.runtimeConfig as Record<string, unknown>)
      : null;

  return resolveLoopSupport({
    agentImpl: project.agentImpl,
    loopName: project.agentLoopVersion?.agentLoop?.name ?? null,
    loopVersion: project.agentLoopVersion?.version ?? null,
    supportTier: project.agentLoopVersion?.supportTier ?? null,
    useRepoHead: runtimeConfigUsesRepoHead(runtimeConfig),
    hasLoopVersion: Boolean(project.agentLoopVersionId),
  });
}

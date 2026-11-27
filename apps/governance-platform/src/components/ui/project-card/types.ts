import { getOpsDisplayStatus } from "@/lib/operator-display";

export interface ProjectSummary {
  id: string;
  archivedAt?: Date | string | null;
  visibility?: "featured" | "public" | "private";
  runnerBackend?: string;
  agent: string;
  agentImpl: string;
  model: string | null;
  repoUrl: string | null;
  repoBranch: string;
  previewUrl: string | null;
  createdAt: Date;
  containerName?: string | null;
  app?: {
    kind?: string | null;
    previewUrl?: string | null;
    previewHealth?: string | null;
    containerName?: string | null;
    powerIntent?: string | null;
    agentIntent?: string | null;
    runtimeState?: string | null;
    agentState?: string | null;
    blockers?: string[];
    lastOutcome?: string | null;
    provisionedAt?: Date | string | null;
  } | null;
  components?: Array<{
    kind?: string | null;
    previewUrl?: string | null;
    previewHealth?: string | null;
    containerName?: string | null;
    powerIntent: string;
    agentIntent?: string | null;
    runtimeState: string;
    agentState: string | null;
    blockers: string[];
    lastOutcome: string | null;
    provisionedAt?: Date | string | null;
  }>;
  budget?: {
    isEnabled: boolean;
    totalCreditsUsd: number;
    usedCreditsUsd: number;
  } | null;
  specs?: Array<{
    id: string;
    title: string | null;
    content: string;
    orderIndex: number;
  }>;
}

export interface ProposalWithVotes {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: Date;
  archivedAt: Date | null;
  season?: {
    id: string;
    title: string;
    status: string;
    submissionStart: Date | null;
    buildStart: Date | null;
    buildDeadline: Date | null;
  } | null;
  projects: ProjectSummary[];
  _count: {
    votes: number;
  };
  votes: Array<{ userId: string }>;
}

export interface ProposalCardProps {
  proposal: ProposalWithVotes;
  /** When set, the card renders this specific project instead of picking projects[0]. */
  project?: ProjectSummary;
  /** Optional detail URL override for contexts like admin views. */
  detailHrefOverride?: string;
  /** When set, card click calls this instead of navigating. */
  onCardClick?: () => void;
  showBudget?: boolean;
  /** Shows local/VPS backend badges. Only platform runtime/admin surfaces should enable this. */
  showBackendBadge?: boolean;
  isAuthenticated: boolean;
  userId?: string;
  isAdmin?: boolean;
  /** RA-220: Pre-computed stage from server to avoid hydration mismatch */
  serverStage?: PreviewStage | null;
}

/* ── Budget display helpers ── */

export interface BudgetDisplayData {
  hasBudget: boolean;
  budgetUsed: number;
  budgetTotal: number;
  budgetRemaining: number;
  /** How much of the budget has been used (0–100). */
  budgetUsagePct: number;
  /** How much of the budget remains (0–100). Use this for bar width. */
  budgetRemainingPct: number;
  /** Bar color based on remaining budget: green = healthy, amber = low, rose = exhausted. */
  budgetBarColor: string;
  budgetLevel: "low" | "medium" | "high" | "exhausted";
}

export function getBudgetDisplayData(
  project: ProjectSummary | undefined,
  showBudget: boolean,
): BudgetDisplayData {
  const budget = project?.budget;
  const hasBudget =
    showBudget && !!budget?.isEnabled && (budget.totalCreditsUsd ?? 0) > 0;
  const budgetUsed = budget?.usedCreditsUsd ?? 0;
  const budgetTotal = budget?.totalCreditsUsd ?? 0;
  const budgetRemaining = Math.max(0, budgetTotal - budgetUsed);
  const budgetUsagePct =
    budgetTotal > 0 ? Math.min(100, (budgetUsed / budgetTotal) * 100) : 0;
  const budgetRemainingPct = 100 - budgetUsagePct;
  const budgetBarColor =
    budgetRemainingPct <= 0
      ? "bg-rose-500"
      : budgetRemainingPct <= 20
        ? "bg-amber-500"
        : "bg-emerald-500";
  const budgetLevel: BudgetDisplayData["budgetLevel"] =
    budgetUsagePct >= 100
      ? "exhausted"
      : budgetUsagePct >= 80
        ? "high"
        : budgetUsagePct >= 40
          ? "medium"
          : "low";
  return {
    hasBudget,
    budgetUsed,
    budgetTotal,
    budgetRemaining,
    budgetUsagePct,
    budgetRemainingPct,
    budgetBarColor,
    budgetLevel,
  };
}

export function getStatusColor(status: string) {
  if (status === "PROPOSED")
    return {
      bg: "bg-cyan-500",
      text: "text-cyan-300",
      border: "border-cyan-400/30",
    };
  if (status === "BUILDING")
    return {
      bg: "bg-amber-500",
      text: "text-amber-300",
      border: "border-amber-400/30",
    };
  return {
    bg: "bg-emerald-500",
    text: "text-emerald-300",
    border: "border-emerald-400/30",
  };
}

export function getRunStatusColor(status: string) {
  if (status === "BUILDING") return "text-amber-300";
  if (status === "LIVE") return "text-emerald-300";
  if (status === "PAUSED") return "text-slate-400";
  // Legacy compat
  if (
    status === "RUNNING" ||
    status === "PROVISIONING" ||
    status === "QUEUED" ||
    status === "STARTING"
  )
    return "text-amber-300";
  if (status === "FAILED" || status === "CANCELED") return "text-rose-300";
  if (status === "DEPLOYED" || status === "SLEEPING") return "text-emerald-300";
  return "text-emerald-300";
}

/* ── Preview stage ── */

export type PreviewStage = "starting" | "building" | "live" | "paused";

/** Get the effective preview URL from project */
export function getEffectivePreviewUrl(
  proposal: ProposalWithVotes,
): string | null {
  const project = proposal.projects?.[0];
  return project?.previewUrl ?? null;
}

/** Get effective repo URL from project */
export function getEffectiveRepoUrl(proposal: ProposalWithVotes): {
  repoUrl: string | null;
  repoBranch: string;
} {
  const project = proposal.projects?.[0];
  return {
    repoUrl: project?.repoUrl ?? null,
    repoBranch: project?.repoBranch ?? "main",
  };
}

export function getPreviewStage(
  proposal: ProposalWithVotes,
  projectOverride?: ProjectSummary,
): PreviewStage | null {
  const project = projectOverride ?? proposal.projects?.[0];
  if (!project) return null;

  const status = getProjectDisplayStatus(project);
  if (status === "PAUSED") return "paused";
  if (status === "LIVE") return "live";
  if (status === "BUILDING") return "building";
  return "starting";
}

export function getStageStyle(stage: PreviewStage) {
  if (stage === "paused") {
    return {
      dot: "bg-amber-400",
      text: "text-amber-400",
      border: "border-amber-400/30",
      bg: "bg-amber-400/10",
    };
  }
  return {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    border: "border-emerald-400/30",
    bg: "bg-emerald-400/10",
  };
}

export function getPublicRunMessage(status?: string | null): string | null {
  if (!status) return null;
  if (status === "PAUSED") return "Paused";
  if (status === "BUILDING") return "Building...";
  return null;
}

export function getProjectDisplayStatus(
  project?: ProjectSummary | null,
): string | null {
  if (!project) return null;
  return getOpsDisplayStatus(project);
}

/** Check if a proposal has any project (launched at least once) */
export function hasActiveProject(proposal: ProposalWithVotes): boolean {
  return (proposal.projects?.length ?? 0) > 0;
}

/** Pick the best project to display: prefer active/deployed, then latest */
export function getActiveProject(
  proposal: ProposalWithVotes,
): ProjectSummary | undefined {
  const active = proposal.projects?.find((p) => {
    const s = getProjectDisplayStatus(p);
    return s === "BUILDING" || s === "LIVE";
  });
  return active ?? proposal.projects?.[0];
}

/** Get the effective status for display (project-based) */
export function getEffectiveStatus(proposal: ProposalWithVotes): string {
  const project = proposal.projects?.[0];
  if (project) return getProjectDisplayStatus(project) ?? proposal.status;
  return proposal.status;
}

import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getWorkspaceBackupRoot, getWorkspaceRoot } from "@/lib/control-plane";
import { buildProjectWorkspaceLabel } from "@/lib/project-identity";
import { resolveLoopSupport, runtimeConfigUsesRepoHead } from "@/lib/loop-support";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { getRetryableBlocker } from "@/lib/retry-backoff";
import { hasLegacyAgentProjectRecipe } from "@/lib/tg-spec-target";
// RA-237: old state-machine validation removed. New invariants are simpler.
// TODO: rewrite with new contracts when state machine core is rebuilt.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditViolation {
  projectId: string;
  projectName: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
}

export interface ProjectAuditResult {
  projectId: string;
  projectName: string;
  state: string;
  pass: boolean;
  violations: AuditViolation[];
}

export interface AuditReport {
  generatedAt: string;
  totalProjects: number;
  passCount: number;
  failCount: number;
  projects: ProjectAuditResult[];
  summary: { rule: string; count: number }[];
}

export interface AuditOptions {
  projectIds?: string[];
  includeArchived?: boolean;
  skipFilesystem?: boolean;
  /** RA-247: Run migration-readiness checks (repo, branch, workspace code, sourceConfig). Slower but comprehensive. */
  includeMigrationChecks?: boolean;
}

// ---------------------------------------------------------------------------
// Check registry
// ---------------------------------------------------------------------------

type ProjectRow = Awaited<ReturnType<typeof loadProjects>>[number];
type AuditCtx = { workspaceRoot: string; githubToken?: string; backupRoot?: string };
type AuditCheck = (project: ProjectRow, ctx: AuditCtx) => AuditViolation | AuditViolation[] | null | Promise<AuditViolation | AuditViolation[] | null>;

const TERMINAL_STATES = ["ARCHIVED", "CANCELED"];

function violation(project: ProjectRow, rule: string, message: string, severity: "error" | "warning" = "error"): AuditViolation {
  return { projectId: project.id, projectName: project.name, rule, severity, message };
}

function loopStateMigrationHint(component: NonNullable<ReturnType<typeof getPrimaryLifecycleComponent>>): string {
  const blockers = Array.isArray(component.blockers) ? component.blockers : [];
  const isMaintenanceSafeResidentRuntime =
    component.powerIntent === "ON"
    && component.runtimeState === "RUNNING"
    && component.agentState === "IDLE"
    && (
      blockers.length > 0
      || component.lastOutcome === "COMPLETED"
      || component.lastOutcome === "FAILED"
    );

  if (isMaintenanceSafeResidentRuntime) {
    return "use Recreate Runtime";
  }
  if (component.agentState === "RUNNING") {
    return "wait for a maintenance-safe window, then use Recreate Runtime";
  }
  return "clean on the next explicit relaunch or runtime recreate";
}

const AUDIT_CHECKS: Record<string, AuditCheck> = {
  /** Every non-terminal project with agent+agentImpl must have a valid agentLoopVersion with commandTemplate */
  "loop-version-ref": (p) => {
    if (p.archivedAt) return null;
    if (!p.agent || !p.agentImpl) return null;
    if (!p.agentLoopVersionId) {
      return violation(p, "loop-version-ref", `agentLoopVersionId is null (agent=${p.agent}, impl=${p.agentImpl})`);
    }
    if (!p.agentLoopVersion) {
      return violation(p, "loop-version-ref", `agentLoopVersionId="${p.agentLoopVersionId}" references missing AgentLoopVersion`);
    }
    if (!p.agentLoopVersion.commandTemplate) {
      return violation(p, "loop-version-ref", `AgentLoopVersion "${p.agentLoopVersionId}" has empty commandTemplate`);
    }
    return null;
  },

  /** Every agent loop project must carry explicit support-tier truth */
  "loop-support-tier": (p) => {
    if (p.archivedAt) return null;
    if (!p.agent || !p.agentImpl || !p.agentLoopVersionId || !p.agentLoopVersion) return null;

    const c = getPrimaryLifecycleComponent(p);
    const runtimeConfig =
      c?.runtimeConfig && typeof c.runtimeConfig === "object"
        ? (c.runtimeConfig as Record<string, unknown>)
        : null;
    const support = resolveLoopSupport({
      agentImpl: p.agentImpl,
      loopName: p.agentLoopVersion.agentLoop?.name ?? null,
      loopVersion: p.agentLoopVersion.version ?? null,
      supportTier: p.agentLoopVersion.supportTier,
      useRepoHead: runtimeConfigUsesRepoHead(runtimeConfig),
      hasLoopVersion: Boolean(p.agentLoopVersionId),
    });
    const violations: ReturnType<typeof violation>[] = [];

    if (support.supportStatus === "upgrade-required") {
      violations.push(violation(
        p,
        "loop-support-tier/upgrade-required",
        `${support.loopIdentity} is pinned. Upgrade to the bundled default runtime before the project is started or relaunched.`,
        "warning",
      ));
    }

    if (support.supportStatus === "unsupported") {
      violations.push(violation(
        p,
        "loop-support-tier/unsupported",
        support.mismatchReason
          ? `${support.loopIdentity} is unsupported: ${support.mismatchReason}`
          : `${support.loopIdentity} is unsupported for runtime actions`,
      ));
    }

    return violations.length > 0 ? violations : null;
  },

  /** Every non-terminal project must have a valid toolId */
  "tool-ref": (p) => {
    if (p.archivedAt) return null;
    if (!p.agent) return null;
    if (!p.toolId) {
      return violation(p, "tool-ref", `toolId is null (agent=${p.agent})`);
    }
    if (!p.tool) {
      return violation(p, "tool-ref", `toolId="${p.toolId}" references missing Tool`);
    }
    return null;
  },

  /** Every project must have at least one ProjectComponent */
  "component-exists": (p) => {
    if (p.components.length === 0) {
      return violation(p, "component-exists", "Project has no ProjectComponent");
    }
    return null;
  },

  /** RA-237: simplified invariant checks */
  "state-machine": (p) => {
    const c = getPrimaryLifecycleComponent(p);
    if (!c) return null;
    const violations: ReturnType<typeof violation>[] = [];
    const blockers = (c.blockers as string[]) ?? [];

    // Invariant: agentIntent=ON requires powerIntent=ON
    if (c.agentIntent === "ON" && c.powerIntent !== "ON") {
      violations.push(violation(p, "state-machine/agent-intent-needs-power", `agentIntent=ON but powerIntent=${c.powerIntent}`));
    }
    // Invariant: RUNNING agent needs RUNNING runtime
    if (c.agentState === "RUNNING" && c.runtimeState !== "RUNNING") {
      violations.push(violation(p, "state-machine/agent-needs-runtime", `agentState=RUNNING but runtimeState=${c.runtimeState}`));
    }
    // Invariant: RUNNING agent needs powerIntent=ON
    if (c.agentState === "RUNNING" && c.powerIntent !== "ON") {
      violations.push(violation(p, "state-machine/agent-needs-power", `agentState=RUNNING but powerIntent=${c.powerIntent}`));
    }
    if (c.runtimeState === "RUNNING" && !c.containerName) {
      violations.push(violation(
        p,
        "state-machine/running-runtime-needs-component-identity",
        "runtimeState=RUNNING but component.containerName is empty",
      ));
    }
    // Invariant: resident idle loop still needs a live runtime while unblocked
    if (
      c.agentIntent === "ON"
      && c.agentState === "IDLE"
      && blockers.length === 0
      && c.powerIntent === "ON"
      && c.runtimeState !== "RUNNING"
    ) {
      violations.push(violation(
        p,
        "state-machine/idle-agent-needs-runtime",
        `agentIntent=ON + agentState=IDLE + blockers=[] but runtimeState=${c.runtimeState}`,
      ));
    }
    // Invariant: RUNNING agent must not have blockers (blockers prevent running)
    if (blockers.length > 0 && c.agentState === "RUNNING") {
      violations.push(violation(p, "state-machine/running-has-blockers", `agentState=RUNNING but blockers=${JSON.stringify(blockers)}`));
    }
    const isParked =
      c.powerIntent === "OFF"
      && c.agentIntent === "OFF"
      && c.runtimeState === "ABSENT"
      && c.agentState === "IDLE";
    const retryableBlocker = getRetryableBlocker(blockers);
    if (retryableBlocker && !c.retryAt && !isParked) {
      violations.push(violation(
        p,
        "state-machine/retryable-blocker-needs-retry-at",
        `${retryableBlocker} blocker is present but retryAt is null`,
      ));
    }
    if (isParked) {
      if (blockers.length > 0) {
        violations.push(violation(
          p,
          "state-machine/parked-row-has-blockers",
          `parked row still carries blockers=${JSON.stringify(blockers)}`,
          "warning",
        ));
      }
      if (c.retryAt) {
        violations.push(violation(
          p,
          "state-machine/parked-row-has-retry-at",
          `parked row still carries retryAt=${new Date(c.retryAt).toISOString()}`,
          "warning",
        ));
      }
      if ((c.retryCount ?? 0) !== 0) {
        violations.push(violation(
          p,
          "state-machine/parked-row-has-retry-count",
          `parked row still carries retryCount=${c.retryCount}`,
          "warning",
        ));
      }
      const staleRuntimeIdentity = [
        c.containerName ? "containerName" : null,
        c.previewUrl ? "previewUrl" : null,
        c.workerHost ? "workerHost" : null,
        c.lastHeartbeat ? "lastHeartbeat" : null,
      ].filter(Boolean);
      if (staleRuntimeIdentity.length > 0) {
        violations.push(violation(
          p,
          "state-machine/parked-row-has-runtime-identity",
          `parked row still carries stale runtime identity: ${staleRuntimeIdentity.join(", ")}`,
          "warning",
        ));
      }
      if (c.previewHealth && c.previewHealth !== "UNKNOWN") {
        violations.push(violation(
          p,
          "state-machine/parked-row-preview-health-not-unknown",
          `parked row still carries previewHealth=${c.previewHealth}`,
          "warning",
        ));
      }
    }
    return violations.length > 0 ? violations : null;
  },

  /** RA-243: Detect ralph projects with internal state still in .arena/ (should be in .ralph/) */
  "loop-state-migration": (p, ctx) => {
    const c = getPrimaryLifecycleComponent(p);
    if (!c) return null;
    if (p.runnerBackend !== "local") return null;
    if (!p.agentImpl || !p.agentImpl.includes("ralph")) return null;

    const label = buildProjectWorkspaceLabel(p as Parameters<typeof buildProjectWorkspaceLabel>[0]);
    const wsPath = path.join(ctx.workspaceRoot, label);
    if (!existsSync(wsPath)) return null;

    const staleFiles = ["plan.json", "ralph-progress.json", "ralph-features.json", "decisions-log.json", "iteration-log.json"]
      .filter((f) => existsSync(path.join(wsPath, ".arena", f)));
    if (staleFiles.length === 0) return null;

    return violation(
      p,
      "loop-state-migration",
      `Ralph internal state in .arena/: ${staleFiles.join(", ")} (${loopStateMigrationHint(c)})`,
      "warning",
    );
  },

  /** For local projects with active runtime (powerIntent=ON or runtimeState!=ABSENT), workspace directory must exist */
  "workspace-exists": (p, ctx) => {
    const c = getPrimaryLifecycleComponent(p);
    if (!c) return null;
    if (c.powerIntent === "OFF" && c.runtimeState === "ABSENT") return null;
    if (p.runnerBackend !== "local") return null;

    const label = buildProjectWorkspaceLabel(p as Parameters<typeof buildProjectWorkspaceLabel>[0]);
    const wsPath = path.join(ctx.workspaceRoot, label);
    if (!existsSync(wsPath)) {
      return violation(p, "workspace-exists", `Workspace directory missing: ${label}`, "error");
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// RA-247: Migration readiness checks (opt-in, read-only)
// ---------------------------------------------------------------------------

const MIGRATION_CHECKS: Record<string, AuditCheck> = {
  /** repoUrl must be set */
  "migration/repo-url-set": (p) => {
    if (p.archivedAt) return null;
    if (!p.repoUrl) {
      return violation(p, "migration/repo-url-set", "repoUrl is empty", "warning");
    }
    return null;
  },

  /** repoUrl should follow arena-<slug> naming (not ralph-*) */
  "migration/repo-naming": (p) => {
    if (p.archivedAt || !p.repoUrl) return null;
    const repoName = p.repoUrl.split("/").pop() ?? "";
    if (repoName.startsWith("ralph-")) {
      return violation(p, "migration/repo-naming", `Repo uses old naming: ${repoName} (expected arena-*)`, "warning");
    }
    return null;
  },

  /** Repo must exist on GitHub */
  "migration/repo-exists": async (p, ctx) => {
    if (p.archivedAt || !p.repoUrl || !ctx.githubToken) return null;
    const match = p.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return violation(p, "migration/repo-exists", `Cannot parse repoUrl: ${p.repoUrl}`, "warning");
    try {
      const res = await fetch(`https://api.github.com/repos/${match[1]}`, {
        headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json" },
      });
      if (res.status === 404) {
        return violation(p, "migration/repo-exists", `Repo not found on GitHub: ${match[1]}`, "error");
      }
    } catch {
      return violation(p, "migration/repo-exists", `GitHub API error for ${match[1]}`, "warning");
    }
    return null;
  },

  /** Branch arena/project-<id> must exist in repo */
  "migration/branch-exists": async (p, ctx) => {
    if (p.archivedAt || !p.repoUrl || !ctx.githubToken) return null;
    const match = p.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return null;
    const branchName = `arena/project-${p.id}`;
    try {
      const res = await fetch(`https://api.github.com/repos/${match[1]}/branches/${encodeURIComponent(branchName)}`, {
        headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json" },
      });
      if (res.status === 404) {
        return violation(p, "migration/branch-exists", `Branch ${branchName} not found in ${match[1]}`, "warning");
      }
    } catch {
      return violation(p, "migration/branch-exists", `GitHub API error checking branch`, "warning");
    }
    return null;
  },

  /** Branch must have package.json (real code, not just seed) */
  "migration/branch-has-code": async (p, ctx) => {
    if (p.archivedAt || !p.repoUrl || !ctx.githubToken) return null;
    const match = p.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return null;
    const branchName = `arena/project-${p.id}`;
    try {
      const res = await fetch(`https://api.github.com/repos/${match[1]}/contents/package.json?ref=${encodeURIComponent(branchName)}`, {
        headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json" },
      });
      if (res.status === 404) {
        return violation(p, "migration/branch-has-code", `No package.json on branch ${branchName}`, "warning");
      }
    } catch {
      // Might fail if branch doesn't exist — skip silently (caught by branch-exists)
    }
    return null;
  },

  /** Workspace must have more than just seed files (README.md + spec.md) */
  "migration/workspace-has-code": (p, ctx) => {
    if (p.archivedAt) return null;
    if (p.runnerBackend !== "local") return null;
    const label = buildProjectWorkspaceLabel(p as Parameters<typeof buildProjectWorkspaceLabel>[0]);
    const wsPath = path.join(ctx.workspaceRoot, label);
    if (!existsSync(wsPath)) return null; // workspace-exists handles this
    const hasPackageJson = existsSync(path.join(wsPath, "package.json"));
    const hasStartSh = existsSync(path.join(wsPath, "arena-start.sh"));
    if (!hasPackageJson && !hasStartSh) {
      return violation(p, "migration/workspace-has-code", `Workspace ${label} has no package.json or arena-start.sh (seed files only?)`, "warning");
    }
    return null;
  },

  /** sourceConfig must not use legacy {recipe: ...} format */
  "migration/source-config-format": (p) => {
    if (p.archivedAt) return null;
    const c = getPrimaryLifecycleComponent(p);
    if (!c) return null;
    const cfg = c.sourceConfig as Record<string, unknown> | null;
    if (hasLegacyAgentProjectRecipe(cfg)) {
      return violation(p, "migration/source-config-format", `sourceConfig uses legacy recipe format: ${JSON.stringify(cfg)}`, "warning");
    }
    return null;
  },

  /** Project must have at least one spec */
  "migration/specs-exist": (p) => {
    if (p.archivedAt) return null;
    if (!p.specs || p.specs.length === 0) {
      return violation(p, "migration/specs-exist", "Project has no specs", "warning");
    }
    return null;
  },

  /** Workspace .git remote must match repoUrl */
  "migration/workspace-git-remote": (p, ctx) => {
    if (p.archivedAt) return null;
    if (p.runnerBackend !== "local" || !p.repoUrl) return null;
    const label = buildProjectWorkspaceLabel(p as Parameters<typeof buildProjectWorkspaceLabel>[0]);
    const wsPath = path.join(ctx.workspaceRoot, label);
    const gitConfigPath = path.join(wsPath, ".git", "config");
    if (!existsSync(gitConfigPath)) return null;
    try {
      const { execFileSync } = require("node:child_process");
      const remote = execFileSync("git", ["-C", wsPath, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 5000 }).trim();
      // Strip auth tokens from remote for comparison
      const cleanRemote = remote.replace(/\/\/[^@]+@/, "//");
      const cleanRepoUrl = p.repoUrl.replace(/\/\/[^@]+@/, "//");
      if (!cleanRemote.includes(cleanRepoUrl.replace("https://github.com/", ""))) {
        return violation(p, "migration/workspace-git-remote",
          `Workspace git remote (${cleanRemote}) doesn't match repoUrl (${p.repoUrl})`, "warning");
      }
    } catch {
      // git not available or not a git repo — skip
    }
    return null;
  },

  /** Optional project budgets must be valid when enabled */
  "migration/budget-exists": (p) => {
    if (p.archivedAt) return null;
    if (!p.budget?.isEnabled) return null;
    if ((p.budget.totalCreditsUsd ?? 0) <= 0) {
      return violation(p, "migration/budget-exists", "Project budget limit is enabled without positive credits", "warning");
    }
    return null;
  },

  /** Slug must produce a valid workspace label (no empty/dash-only slugs) */
  "migration/slug-valid": (p) => {
    if (p.archivedAt) return null;
    const label = buildProjectWorkspaceLabel(p as Parameters<typeof buildProjectWorkspaceLabel>[0]);
    // Bad patterns: starts with --, empty, only dashes, or doesn't contain alphanumeric
    if (!label || /^-+/.test(label) || !/[a-z0-9]/.test(label)) {
      return violation(p, "migration/slug-valid", `Workspace label "${label}" is invalid (slug=${p.slug}, name=${p.name})`, "error");
    }
    return null;
  },

  /** Check if code exists in backup (for projects without current workspace code) */
  "migration/backup-available": (p, ctx) => {
    if (p.archivedAt) return null;
    if (!ctx.backupRoot) return null;
    const label = buildProjectWorkspaceLabel(p as Parameters<typeof buildProjectWorkspaceLabel>[0]);
    // Check if workspace already has code — no need to check backup
    const wsPath = path.join(ctx.workspaceRoot, label);
    if (existsSync(path.join(wsPath, "package.json"))) return null;
    // Check backup
    const backupPath = path.join(ctx.backupRoot, "project-workspaces", label);
    if (existsSync(path.join(backupPath, "package.json"))) {
      return violation(p, "migration/backup-available",
        `Code found in backup at ${backupPath} (workspace is empty)`, "warning");
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadProjects(opts: AuditOptions) {
  return prisma.project.findMany({
    where: {
      ...(opts.projectIds?.length ? { id: { in: opts.projectIds } } : {}),
      ...(!opts.includeArchived ? { archivedAt: null } : {}),
    },
    include: {
      components: { where: { kind: "app" }, orderBy: { createdAt: "asc" }, take: 1 },
      agentLoopVersion: {
        select: {
          id: true,
          commandTemplate: true,
          supportTier: true,
          version: true,
          agentLoop: { select: { name: true } },
        },
      },
      tool: { select: { id: true, name: true } },
      proposal: { select: { title: true } },
      specs: { select: { id: true }, take: 1 },
      budget: true,
      runtimeIntents: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          action: true,
          state: true,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runProjectAudit(opts: AuditOptions = {}): Promise<AuditReport> {
  const projects = await loadProjects(opts);
  const workspaceRoot = getWorkspaceRoot();
  const backupRoot = getWorkspaceBackupRoot();
  const ctx: AuditCtx = {
    workspaceRoot,
    // GitHub API checks only for single-project audit (batch is too slow / rate-limited)
    githubToken: opts.includeMigrationChecks && opts.projectIds?.length
      ? (process.env.GITHUB_TOKEN?.trim() || undefined)
      : undefined,
    backupRoot: existsSync(backupRoot) ? backupRoot : undefined,
  };

  const checks: Record<string, AuditCheck> = { ...AUDIT_CHECKS };
  if (opts.includeMigrationChecks) {
    Object.assign(checks, MIGRATION_CHECKS);
    console.log(`[audit] RA-247 migration checks enabled (${Object.keys(MIGRATION_CHECKS).length} rules, githubToken=${!!ctx.githubToken})`);
  }

  const results: ProjectAuditResult[] = [];
  const ruleCounts = new Map<string, number>();

  for (const project of projects) {
    const violations: AuditViolation[] = [];

    for (const [name, check] of Object.entries(checks)) {
      const isFilesystemCheck = name === "workspace-exists" || name === "loop-state-migration" || name.startsWith("migration/workspace") || name === "migration/backup-available";
      if (opts.skipFilesystem && isFilesystemCheck) continue;
      const result = await check(project, ctx);
      if (result == null) continue;
      const items = Array.isArray(result) ? result : [result];
      for (const v of items) {
        violations.push(v);
        ruleCounts.set(v.rule, (ruleCounts.get(v.rule) ?? 0) + 1);
      }
    }

    results.push({
      projectId: project.id,
      projectName: project.name,
      state: project.archivedAt ? "ARCHIVED" : "ACTIVE",
      pass: violations.length === 0,
      violations,
    });
  }

  const passCount = results.filter((r) => r.pass).length;
  const summary = [...ruleCounts.entries()]
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    totalProjects: results.length,
    passCount,
    failCount: results.length - passCount,
    projects: results,
    summary,
  };
}

/**
 * RA-247: Pre-launch gate — run core audit checks for a single project.
 * Returns error messages if project fails validation, empty array if ok.
 * Only error-severity violations block launch. Warnings are informational.
 * Does NOT include migration checks — those are for planning, not blocking.
 */
export async function preLaunchCheck(projectId: string): Promise<string[]> {
  const report = await runProjectAudit({ projectIds: [projectId] });
  const project = report.projects[0];
  if (!project) return ["Project not found in audit"];

  return project.violations
    .filter(v => v.severity === "error")
    .map(v => `${v.rule}: ${v.message}`);
}

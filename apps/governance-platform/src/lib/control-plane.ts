import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeOperationalLogText } from "@arena/contracts";
import { prisma } from "@/lib/prisma";
import { buildWorkerParity } from "@/lib/worker-parity";
import { buildRuntimeGeneration } from "@/lib/runtime-generation";
import { resolveWorkerUrl } from "@/lib/worker-url";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";

const DEFAULT_WORKER_IMAGE = process.env.WORKER_IMAGE || "arena-public-worker:local";
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "";
const WORKER_SERVICE_GENERATION_PATHS = [
  "services/worker-agent",
  "services/arena-runner",
  "packages/loops/ralph-runtime",
  "packages/contracts",
] as const;

type RunLogEntry = {
  id: string;
  event: string;
  detail: string | null;
  createdAt: Date;
};

type TerminalSignalProjection = {
  trigger: string;
  reason: string | null;
  at: Date;
};

type FetchWorkerJsonResult = Awaited<ReturnType<typeof fetchWorkerJson>>;

/**
 * RA-269: Governance should compare worker-service generation against the latest
 * worker-affecting change, not against arbitrary docs-only or backlog commits.
 */
export function getExpectedRunnerVersion(): string | null {
  return readLocalWorkerServiceGitSha();
}

export function getWorkspaceRoot(): string {
  return path.resolve(
    process.env.ARENA_PROJECT_WORKSPACES_ROOT
      ?? getDefaultWorkspaceRoot(),
  );
}

export function getWorkspaceBackupRoot(): string {
  return path.resolve(
    process.env.ARENA_WORKSPACE_BACKUP_ROOT
      ?? path.join(path.dirname(path.dirname(getWorkspaceRoot())), "runtime-backup-pre-ra-237"),
  );
}

function getDefaultWorkspaceRoot(): string {
  const home = process.env.ARENA_HOME_PATH || process.env.HOME || os.homedir();
  return home
    ? path.join(home, ".arena-runtime", "project-workspaces")
    : path.join(process.cwd(), "..", "..", "runtime", "project-workspaces");
}

export async function resolveLoopAndTool(
  agentImpl: string,
  agent: string,
): Promise<{ agentLoopVersionId: string | null; toolId: string | null }> {
  const [loop, tool] = await Promise.all([
    (prisma as any).agentLoop.findUnique({
      where: { name: agentImpl },
      select: { currentVersionId: true },
    }),
    (prisma as any).tool.findUnique({
      where: { name: agent },
      select: { id: true },
    }),
  ]);

  return {
    agentLoopVersionId: loop?.currentVersionId ?? null,
    toolId: tool?.id ?? null,
  };
}

export async function getProjectState(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
      archivedAt: true,
      agent: true,
      agentImpl: true,
      model: true,
      runnerBackend: true,
      name: true,
      slug: true,
      repoUrl: true,
      repoBranch: true,
      requiredSecrets: true,
      createdAt: true,
      updatedAt: true,
      proposal: {
        select: {
          id: true,
          title: true,
          description: true,
        },
      },
      budget: true,
      secrets: {
        select: {
          id: true,
          key: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { key: "asc" },
      },
      specs: {
        select: {
          id: true,
          title: true,
          orderIndex: true,
        },
        orderBy: { orderIndex: "asc" },
      },
      components: {
        select: {
          id: true,
          name: true,
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
          lastOutcome: true,
          lastOutcomeAt: true,
          retryAt: true,
          previewHealth: true,
          previewCheckedAt: true,
          provisionedAt: true,
          sourceType: true,
          sourceConfig: true,
          runtimeConfig: true,
          containerName: true,
          previewUrl: true,
          workerHost: true,
          lastHeartbeat: true,
          retryCount: true,
        },
        orderBy: { createdAt: "asc" },
      },
      vpsHost: {
        select: {
          id: true,
          ip: true,
          status: true,
          previewDomain: true,
          providerServerId: true,
          serverType: true,
          region: true,
        },
      },
      progressJson: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostUsd: true,
      budgetDebitedUsd: true,
      toolId: true,
      agentLoopVersionId: true,
      envOverrides: true,
      claudeAuthMode: true,
      codexAuthMode: true,
      vpsServerType: true,
      runLogs: {
        select: {
          id: true,
          event: true,
          detail: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!project) return null;
  return {
    ...project,
    latestTerminalSignal: getLatestTerminalSignal(project.runLogs),
  };
}

export async function getProjectWorkerInfo(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      runnerBackend: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { kind: true, containerName: true, workerHost: true },
      },
      vpsHost: { select: { ip: true } },
    },
  });
  if (!project) return null;

  const primary = getPrimaryLifecycleComponent(project);
  const containerName = primary?.containerName ?? null;
  const workerHost = primary?.workerHost ?? null;
  const workerUrl = resolveWorkerUrl(workerHost, project.vpsHost?.ip) ?? null;

  return { projectId, containerName, workerUrl };
}

export async function getProjectSpecs(projectId: string) {
  return prisma.spec.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      content: true,
      orderIndex: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { orderIndex: "asc" },
  });
}

export async function getWorkerSnapshot(projectId: string, opts?: { tail?: number }) {
  const tail = clampTail(opts?.tail ?? 50);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      runnerBackend: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          containerName: true,
          workerHost: true,
        },
      },
      vpsHost: {
        select: {
          ip: true,
        },
      },
    },
  });

  if (!project) return null;

  const primaryComponent = getPrimaryLifecycleComponent(project);
  const containerName = primaryComponent?.containerName ?? null;
  const workerHost = primaryComponent?.workerHost ?? null;
  const workerUrl = resolveWorkerUrl(workerHost, project.vpsHost?.ip) ?? null;
  if (!workerUrl) {
    return {
      projectId,
      workerUrl: null,
      meta: null,
      health: null,
      capacity: null,
      inspect: null,
      logs: null,
      parity: null,
      errors: {
        meta: null,
        health: null,
        inspect: null,
        logs: null,
      },
      error: `Cannot resolve worker for host \"${workerHost}\"`,
    };
  }

  const metaResult = await fetchWorkerJson(`${workerUrl}/meta`);
  const healthResult = await fetchWorkerJson(`${workerUrl}/health`);
  const inspectResult = containerName
    ? await fetchWorkerJson(`${workerUrl}/containers/${encodeURIComponent(containerName)}/inspect`)
    : null;
  const logsResult = containerName
    ? await fetchWorkerJson(`${workerUrl}/containers/${encodeURIComponent(containerName)}/logs?tail=${tail}`)
    : null;
  const expectedWorkerImage = await getExpectedWorkerImageForProject(projectId);

  const logsBody = logsResult?.ok ? sanitizeWorkerLogsBody(logsResult.body) : null;

  return {
    projectId,
    workerUrl,
    meta: metaResult?.ok ? metaResult.body : null,
    health: healthResult?.ok ? healthResult.body : null,
    capacity: healthResult?.ok ? await buildWorkerCapacityDiagnostics(healthResult) : null,
    inspect: inspectResult?.ok ? inspectResult.body : null,
    logs: logsBody,
    parity: buildWorkerParity({
      environment: project.runnerBackend === "vps" ? "vps" : "local",
      expectedCommitSha: getExpectedRunnerVersion(),
      expectedWorkerImage,
      workerMeta: metaResult?.ok ? metaResult.body : null,
    }),
    runtimeGeneration: buildRuntimeGeneration({
      workerMeta: metaResult?.ok ? metaResult.body : null,
      containerInspect: inspectResult?.ok ? inspectResult.body : null,
    }),
    errors: {
      meta: metaResult?.ok ? null : metaResult,
      health: healthResult?.ok ? null : healthResult,
      inspect: inspectResult?.ok ? null : inspectResult,
      logs: logsResult?.ok ? null : logsResult,
    },
  };
}

function sanitizeWorkerLogsBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (typeof record.logs !== "string") return body;
  return {
    ...record,
    logs: sanitizeOperationalLogText(record.logs),
  };
}

async function buildWorkerCapacityDiagnostics(healthResult: FetchWorkerJsonResult) {
  if (!healthResult.ok || !healthResult.body || typeof healthResult.body !== "object") {
    return null;
  }

  const body = healthResult.body as Record<string, unknown>;
  if (
    !Array.isArray(body.activePreviewContainers)
    && readNumber(body.activePreviewContainerCount) == null
    && readNumber(body.availableStartCapacity) == null
    && readNumber(body.maxConcurrentRuns) == null
    && !isRecord(body.resourcePressure)
  ) {
    return null;
  }
  const resourcePressure = isRecord(body.resourcePressure) ? body.resourcePressure : null;
  const activePreviewContainers = Array.isArray(body.activePreviewContainers)
    ? body.activePreviewContainers.filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
  if (activePreviewContainers.length === 0) {
    return {
      maxConcurrentRuns: readNumber(body.maxConcurrentRuns),
      activePreviewContainerCount: readNumber(body.activePreviewContainerCount) ?? 0,
      availableStartCapacity: readNumber(body.availableStartCapacity),
      trackedActivePreviewContainerCount: 0,
      staleTrackedPreviewContainers: [],
      untrackedActivePreviewContainers: [],
      resourcePressure,
    };
  }

  const components = await prisma.projectComponent.findMany({
    where: {
      containerName: { in: activePreviewContainers },
    },
    select: {
      projectId: true,
      containerName: true,
      powerIntent: true,
      runtimeState: true,
    },
  });
  const trackedNames = new Set(
    components
      .map((component) => component.containerName)
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  );

  return {
    maxConcurrentRuns: readNumber(body.maxConcurrentRuns),
    activePreviewContainerCount: readNumber(body.activePreviewContainerCount) ?? activePreviewContainers.length,
    availableStartCapacity: readNumber(body.availableStartCapacity),
    trackedActivePreviewContainerCount: trackedNames.size,
    staleTrackedPreviewContainers: components
      .filter((component) => component.powerIntent !== "ON" || component.runtimeState !== "RUNNING")
      .map((component) => ({
        projectId: component.projectId,
        containerName: component.containerName,
        powerIntent: component.powerIntent,
        runtimeState: component.runtimeState,
      })),
    untrackedActivePreviewContainers: activePreviewContainers.filter((name) => !trackedNames.has(name)),
    resourcePressure,
  };
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function getExpectedWorkerImageForProject(projectId: string): Promise<string | null> {
  const component = await prisma.projectComponent.findFirst({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      runtimeConfig: true,
    },
  });

  if (!component || typeof component.runtimeConfig !== "object" || !component.runtimeConfig) {
    return DEFAULT_WORKER_IMAGE;
  }

  const runtimeConfig = component.runtimeConfig as Record<string, unknown>;
  return typeof runtimeConfig.cycleImage === "string" && runtimeConfig.cycleImage.trim()
    ? runtimeConfig.cycleImage
    : DEFAULT_WORKER_IMAGE;
}

type WorkerFetchResult =
  | { ok: true; body: any }
  | { ok: false; status?: number; body?: string; error?: string };

export async function fetchWorkerJson(url: string, opts?: { timeoutMs?: number }): Promise<WorkerFetchResult> {
  const headers: Record<string, string> = {};
  if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 10_000),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text().catch(() => "") };
    }
    return { ok: true, body: await res.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function postWorkerJson(
  url: string,
  body: unknown,
  opts?: { timeoutMs?: number },
): Promise<WorkerFetchResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 10_000),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text().catch(() => "") };
    }
    return { ok: true, body: await res.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function clampTail(value: number): number {
  if (!Number.isFinite(value)) return 500;
  return Math.min(Math.max(Math.trunc(value), 1), 5000);
}

function getLatestTerminalSignal(runLogs: RunLogEntry[]): TerminalSignalProjection | null {
  for (const log of runLogs) {
    const signal = parseTerminalSignal(log);
    if (signal) return signal;
  }
  return null;
}

function parseTerminalSignal(log: RunLogEntry): TerminalSignalProjection | null {
  if (!log.detail) return null;
  try {
    const parsed = JSON.parse(log.detail) as { trigger?: unknown; reason?: unknown };
    if (typeof parsed.trigger !== "string") return null;
    if (!isSemanticTerminalTrigger(parsed.trigger)) return null;
    return {
      trigger: parsed.trigger,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      at: log.createdAt,
    };
  } catch {
    return null;
  }
}

function isSemanticTerminalTrigger(trigger: string): boolean {
  return trigger === "terminal_pause"
    || trigger === "terminal_failed"
    || trigger === "terminal_canceled"
    || trigger === "terminal_deployed"
    || trigger === "terminal_agent_off"
    || trigger === "terminal_power_off"
    || trigger === "terminal_shutdown";
}

function readLocalRepoGitSha(): string | null {
  const direct = readGitShaFromNearestDotGit(process.cwd());
  if (direct) return direct;

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readLocalWorkerServiceGitSha(): string | null {
  const repoRoot = findNearestGitRepoRoot(process.cwd());
  if (!repoRoot) return readLocalRepoGitSha();

  try {
    const sha = execFileSync(
      "git",
      ["log", "-1", "--format=%H", "HEAD", "--", ...WORKER_SERVICE_GENERATION_PATHS],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (/^[0-9a-f]{12,40}$/i.test(sha)) {
      return sha.slice(0, 12);
    }
  } catch {
    // Intentionally fall through.
  }

  // If governance cannot read path-scoped worker history honestly (for example
  // because git CLI is unavailable inside the local dev container), prefer
  // incomplete parity truth over a misleading raw repo HEAD comparison.
  return null;
}

function findNearestGitRepoRoot(startCwd: string): string | null {
  let cwd = path.resolve(startCwd);

  while (true) {
    if (existsSync(path.join(cwd, ".git"))) {
      return cwd;
    }

    const parent = path.dirname(cwd);
    if (parent === cwd) return null;
    cwd = parent;
  }
}

function readGitShaFromNearestDotGit(startCwd: string): string | null {
  let cwd = path.resolve(startCwd);

  while (true) {
    const sha = readGitShaFromDotGit(cwd);
    if (sha) return sha;

    const parent = path.dirname(cwd);
    if (parent === cwd) return null;
    cwd = parent;
  }
}

function readGitShaFromDotGit(cwd: string): string | null {
  try {
    const gitEntry = path.join(cwd, ".git");
    if (!existsSync(gitEntry)) return null;

    const gitDir = resolveGitDir(gitEntry, cwd);
    if (!gitDir) return null;

    const headRaw = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(headRaw)) {
      return headRaw.slice(0, 12);
    }

    const match = headRaw.match(/^ref:\s+(.+)$/);
    if (!match) return null;

    const refPath = path.join(gitDir, match[1]);
    if (existsSync(refPath)) {
      const refSha = readFileSync(refPath, "utf8").trim();
      return /^[0-9a-f]{40}$/i.test(refSha) ? refSha.slice(0, 12) : null;
    }

    const packedRefsPath = path.join(gitDir, "packed-refs");
    if (!existsSync(packedRefsPath)) return null;

    const packedRefs = readFileSync(packedRefsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("^"));

    const packedLine = packedRefs.find((line) => line.endsWith(` ${match[1]}`));
    if (!packedLine) return null;

    const [sha] = packedLine.split(" ");
    return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 12) : null;
  } catch {
    return null;
  }
}

function resolveGitDir(gitEntry: string, cwd: string): string | null {
  const stat = statSync(gitEntry);
  if (stat.isDirectory()) {
    return gitEntry;
  }

  const raw = readFileSync(gitEntry, "utf8").trim();
  const match = raw.match(/^gitdir:\s+(.+)$/i);
  if (!match) return null;

  return path.resolve(cwd, match[1]);
}

import { prisma } from "@/lib/prisma";
import { getTokenManager, type Provider } from "@/lib/token-manager";
import { hasLiveAgentLoop, hasWorkingAgentLoop } from "@/lib/agent-loop-activity";
import { getPrimaryLifecycleComponent, getPublicDisplayStatus } from "@/lib/project-lifecycle";
import { computeOverviewMetrics } from "@/lib/overview-metrics";
import { getExpectedRunnerVersion } from "@/lib/control-plane";
import { buildWorkerParity, getActionableWorkerParityReasons } from "@/lib/worker-parity";
import { resolveWorkerUrl } from "@/lib/worker-url";

const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
const ACTIVITY_STALE_MS = 15 * 60 * 1000;
const BUDGET_HOT_RATIO = 0.8;
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "";

type TokenStatusSnapshot = ReturnType<ReturnType<typeof getTokenManager>["getStatus"]>;

export async function getSystemOverview() {
  const [projects, cronJobs] = await Promise.all([
    prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        mode: true,
        visibility: true,
        archivedAt: true,
        runnerBackend: true,
        progressJson: true,
        createdAt: true,
        updatedAt: true,
        estimatedCostUsd: true,
        inputTokens: true,
        outputTokens: true,
        components: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            kind: true,
            powerIntent: true,
            agentIntent: true,
            runtimeState: true,
            agentState: true,
            blockers: true,
            lastOutcome: true,
            previewHealth: true,
            provisionedAt: true,
            containerName: true,
            previewUrl: true,
            workerHost: true,
            lastHeartbeat: true,
          },
        },
        budget: {
          select: {
            isEnabled: true,
            totalCreditsUsd: true,
            usedCreditsUsd: true,
          },
        },
        vpsHost: {
          select: {
            id: true,
            ip: true,
            status: true,
            serverType: true,
            region: true,
          },
        },
      },
    }),
    prisma.cronJob.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        endpoint: true,
        intervalMin: true,
        enabled: true,
        lastRunAt: true,
        lastResult: true,
        updatedAt: true,
      },
    }).catch(() => []),
  ]);

  const now = Date.now();
  const attentionItems: Array<{
    severity: "high" | "medium";
    kind: string;
    projectId: string | null;
    workerHost?: string | null;
    message: string;
  }> = [];
  const workerBuckets = new Map<string, {
    host: string;
    backend: "local" | "vps";
    projectCount: number;
    activeProjectCount: number;
    staleHeartbeatCount: number;
    vpsIp: string | null;
    parityStatus: "clean" | "mismatch" | null;
    parityReasons: string[];
    actionableParityReasons: string[];
    expectedCommitSha: string | null;
    actualWorkerGitSha: string | null;
    actualRunnerGitSha: string | null;
  }>();

  const normalizedProjects = projects.map((project) => {
    const comp = getPrimaryLifecycleComponent(project);
    const workerHost = comp?.workerHost ?? null;
    const previewUrl = comp?.previewUrl ?? null;
    const containerName = comp?.containerName ?? null;
    const budget = project.budget;
    const heartbeatAgeMs = comp?.lastHeartbeat ? now - new Date(comp.lastHeartbeat).getTime() : null;
    const activityAgeMs = now - new Date(project.updatedAt).getTime();
    const budgetUsageRatio = budget && budget.totalCreditsUsd > 0
      ? budget.usedCreditsUsd / budget.totalCreditsUsd
      : null;

    // RA-192: Derive display status from component state
    const displayStatus = getPublicDisplayStatus(project);
    const hasLiveLoop = hasLiveAgentLoop(project);
    const hasWorkingLoop = hasWorkingAgentLoop(project);

    if (hasLiveLoop && heartbeatAgeMs !== null && heartbeatAgeMs > HEARTBEAT_STALE_MS) {
      attentionItems.push({
        severity: "high",
        kind: "stale_heartbeat",
        projectId: project.id,
        message: `Project ${project.name} is ${displayStatus} but heartbeat is ${Math.round(heartbeatAgeMs / 60000)}m old`,
      });
    }

    if (hasWorkingAgentLoop(project) && activityAgeMs > ACTIVITY_STALE_MS) {
      attentionItems.push({
        severity: "medium",
        kind: "stale_activity",
        projectId: project.id,
        message: `Project ${project.name} shows no state updates for ${Math.round(activityAgeMs / 60000)}m`,
      });
    }

    if (budget?.isEnabled && budgetUsageRatio !== null && budgetUsageRatio >= BUDGET_HOT_RATIO) {
      attentionItems.push({
        severity: budgetUsageRatio >= 0.95 ? "high" : "medium",
        kind: "budget_hot",
        projectId: project.id,
        message: `Project ${project.name} used ${(budgetUsageRatio * 100).toFixed(0)}% of budget`,
      });
    }

    const workerKey = workerHost || (project.runnerBackend === "vps" ? project.vpsHost?.ip || "unknown-vps" : "local");
    if (workerKey) {
      const bucket = workerBuckets.get(workerKey) ?? {
        host: workerHost || workerKey,
        backend: project.runnerBackend === "vps" ? "vps" : "local",
        projectCount: 0,
        activeProjectCount: 0,
        staleHeartbeatCount: 0,
        vpsIp: project.vpsHost?.ip ?? null,
        parityStatus: null,
        parityReasons: [],
        actionableParityReasons: [],
        expectedCommitSha: null,
        actualWorkerGitSha: null,
        actualRunnerGitSha: null,
      };
      bucket.projectCount += 1;
      if (hasWorkingLoop) bucket.activeProjectCount += 1;
      if (hasLiveLoop && heartbeatAgeMs !== null && heartbeatAgeMs > HEARTBEAT_STALE_MS) {
        bucket.staleHeartbeatCount += 1;
      }
      workerBuckets.set(workerKey, bucket);
    }

    return {
      ...project,
      app: comp
        ? {
          powerIntent: comp.powerIntent ?? null,
          agentIntent: comp.agentIntent ?? null,
          runtimeState: comp.runtimeState ?? null,
          agentState: comp.agentState ?? null,
          blockers: Array.isArray(comp.blockers) ? comp.blockers : [],
          lastOutcome: comp.lastOutcome ?? null,
          previewHealth: comp.previewHealth ?? null,
          provisionedAt: comp.provisionedAt ?? null,
          containerName: comp.containerName ?? null,
          previewUrl,
          workerHost,
          lastHeartbeat: comp.lastHeartbeat ?? null,
        }
        : null,
      previewUrl,
      containerName,
      workerHost,
      // RA-192: Add displayStatus for consumers that need a single status string
      status: displayStatus,
      heartbeatAgeMs,
      activityAgeMs,
      budgetUsageRatio,
    };
  });

  const expectedCommitSha = getExpectedRunnerVersion();
  await Promise.all(Array.from(workerBuckets.values()).map(async (bucket) => {
    const workerUrl = resolveWorkerUrl(bucket.host, bucket.vpsIp);
    if (!workerUrl) return;

    const workerMeta = await fetchWorkerMeta(workerUrl);
    const parity = buildWorkerParity({
      environment: bucket.backend,
      expectedCommitSha,
      expectedWorkerImage: null,
      workerMeta,
    });
    const actionableParityReasons = getActionableWorkerParityReasons(parity);

    bucket.parityStatus = parity.status === "clean" || parity.status === "mismatch"
      ? parity.status
      : null;
    bucket.parityReasons = parity.reasons;
    bucket.actionableParityReasons = actionableParityReasons;
    bucket.expectedCommitSha = parity.expectedCommitSha;
    bucket.actualWorkerGitSha = parity.actualWorkerGitSha;
    bucket.actualRunnerGitSha = parity.actualRunnerGitSha;

    if (bucket.parityStatus === "mismatch" && actionableParityReasons.length > 0) {
      attentionItems.push({
        severity: "medium",
        kind: "worker_service_generation_drift",
        projectId: null,
        workerHost: bucket.host,
        message: `Worker ${bucket.host} reports stale service generation: ${actionableParityReasons.join(", ")}`,
      });
    }
  }));

  const tm = getTokenManager();
  const tokenStatus = tm.getStatus();
  const providers: Provider[] = ["claude-api", "claude-sub", "openai-api", "openai-sub", "opencode-api", "github"];
  const tokens = Object.fromEntries(
    providers.map((provider) => [provider, tokenStatus.providers[provider]]),
  ) as TokenStatusSnapshot["providers"];
  const metrics = computeOverviewMetrics(normalizedProjects);

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    projects: normalizedProjects,
    attentionItems,
    workers: Array.from(workerBuckets.values()).sort((a, b) => {
      if (b.staleHeartbeatCount !== a.staleHeartbeatCount) return b.staleHeartbeatCount - a.staleHeartbeatCount;
      if (b.activeProjectCount !== a.activeProjectCount) return b.activeProjectCount - a.activeProjectCount;
      return a.host.localeCompare(b.host);
    }),
    cronJobs,
    tokens,
    tokenManager: {
      lastReadAt: tokenStatus.lastReadAt,
      lastRefreshAt: tokenStatus.lastRefreshAt,
      refreshInFlight: tokenStatus.refreshInFlight,
      envFilePaths: tokenStatus.envFilePaths,
    },
  };
}

async function fetchWorkerMeta(workerUrl: string): Promise<any | null> {
  const headers: Record<string, string> = {};
  if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;

  try {
    const res = await fetch(`${workerUrl}/meta`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

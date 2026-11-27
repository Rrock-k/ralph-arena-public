"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { buildProjectWorkspaceLabel, getProjectProposalPath } from "@/lib/project-identity";
import { getWorkspaceRoot } from "@/lib/control-plane";
import {
  deleteDnsRecords,
  deleteSshKey,
  destroyVps,
  listServers,
  listSshKeys,
  rebootServer,
  type HetznerServer,
} from "@/lib/vps/hetzner";
import { rm } from "node:fs/promises";
import path from "node:path";
import { requirePlatformCapability } from "@/lib/platform-access";
import { hasWorkingAgentLoop } from "@/lib/agent-loop-activity";
import { getPrimaryLifecycleComponent, getPublicDisplayStatus } from "@/lib/project-lifecycle";
import { isRetainedPreviewRow } from "@/lib/preview-state";
import { prepareRuntimeForFreshClaim } from "@/lib/project-state-effects";
import { resolveWorkerUrl } from "@/lib/worker-url";
import { requireProjectRuntimeActionAccess } from "@/lib/runtime-action-access";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

type ActionResult = {
  success: boolean;
  error?: string;
  details?: string;
};

const WORKER_AGENT_URL = process.env.WORKER_AGENT_URL ?? "http://localhost:4201";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "";

function getRunnerWorkRoot(): string {
  return getWorkspaceRoot();
}

function workerHeaders(): Record<string, string> {
  return WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {};
}

function isOperatorActiveComponent(
  component: {
    powerIntent?: string | null;
    agentIntent?: string | null;
    agentState?: string | null;
    lastOutcome?: string | null;
  } | null | undefined,
): boolean {
  if (!component) return false;
  if (component.powerIntent !== "ON") return false;
  return !isRetainedPreviewRow(component);
}

async function removeWorkerContainer(name: string): Promise<void> {
  const res = await fetch(`${WORKER_AGENT_URL}/containers/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: workerHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Worker-agent DELETE /containers/${name} failed (${res.status}): ${body}`);
  }
}

function isBenignRuntimeRecreateDeleteError(message: string): boolean {
  return message.includes("(404)")
    || message.includes("(409)")
    || message.includes("already in progress");
}

async function requireProjectRuntimeAccess(projectId: string): Promise<ActionResult | null> {
  return requireProjectRuntimeActionAccess(projectId);
}

async function requirePlatformRuntimeAccess(): Promise<ActionResult | null> {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (access.authorized) {
    return null;
  }
  return { success: false, error: access.error };
}

async function getActiveWorkingProjectsForWorker(workerHost: string): Promise<Array<{ id: string; name: string }>> {
  const projects = await (prisma as any).project.findMany({
    where: {
      components: {
        some: {
          kind: "app",
          workerHost,
        },
      },
    },
    select: {
      id: true,
      name: true,
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
        },
      },
    },
  });

  return projects
    .filter((project: any) => hasWorkingAgentLoop(project))
    .map((project: any) => ({
      id: project.id,
      name: project.name,
    }));
}

export async function restartWorkerServiceInternal(
  workerHost: string,
  opts: { vpsIp?: string | null; internalActionToken?: unknown } = {},
): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(opts.internalActionToken);
  if (internalGuard) return internalGuard;

  const normalizedHost = workerHost.trim();
  if (!normalizedHost) {
    return { success: false, error: "workerHost is required" };
  }

  const activeProjects = await getActiveWorkingProjectsForWorker(normalizedHost);
  if (activeProjects.length > 0) {
    const projectList = activeProjects.map((project) => `${project.name} (${project.id})`).join(", ");
    return {
      success: false,
      error: `Worker restart requires a safe window without active agent runs on ${normalizedHost}: ${projectList}`,
    };
  }

  const workerUrl = resolveWorkerUrl(normalizedHost, opts.vpsIp ?? null);
  if (!workerUrl) {
    return {
      success: false,
      error: `Cannot resolve worker URL for host ${normalizedHost}; provide vpsIp for non-local workers`,
    };
  }

  const res = await fetch(`${workerUrl}/maintenance/restart-self`, {
    method: "POST",
    headers: workerHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      success: false,
      error: `Worker service restart failed (${res.status})${body ? `: ${body}` : ""}`,
    };
  }

  revalidatePath("/admin");
  progressBus.notifyChanged();

  return {
    success: true,
    details: `Worker service restart scheduled for ${normalizedHost}`,
  };
}

export async function restartWorkerService(
  workerHost: string,
  opts: { vpsIp?: string | null } = {},
): Promise<ActionResult> {
  const guard = await requirePlatformRuntimeAccess();
  if (guard) return guard;
  return restartWorkerServiceInternal(workerHost, {
    ...opts,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function cleanupProjectRuntimeArtifacts(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      proposal: { select: { title: true } },
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { kind: true, powerIntent: true, agentIntent: true, runtimeState: true, agentState: true, lastOutcome: true },
      },
    },
  });

  if (!project) return { success: false, error: "Project not found" };
  const comp = getPrimaryLifecycleComponent(project);
  const isActive = isOperatorActiveComponent(comp);
  if (isActive) {
    return { success: false, error: "Cannot clean runtime artifacts while project is active" };
  }

  const label = buildProjectWorkspaceLabel(project);
  const containerName = `preview-${label}`;
  let removedContainers = 0;

  await removeWorkerContainer(containerName)
    .then(() => { removedContainers++; })
    .catch((e) => {
      console.log(`[runtime-maintenance] Container ${containerName} not found or already removed:`, e.message);
    });

  let removedWorkspace = false;
  const shouldPreserveWorkspace = isRetainedPreviewRow(comp);
  if (!shouldPreserveWorkspace) {
    await rm(path.join(getRunnerWorkRoot(), label), { recursive: true, force: true });
    removedWorkspace = true;
  }

  revalidatePath(`/admin/projects/${projectId}`);
  notifyProjectChanged(projectId);

  return {
    success: true,
    details: `${removedContainers} container(s) removed${removedWorkspace ? ", workspace removed" : ", workspace preserved"}`,
  };
}

export async function requestProjectPreviewRefreshInternal(
  projectId: string,
  opts: {
    source?: "admin" | "cron" | "system";
    reason?: string;
    maintenanceReason?: string;
    internalActionToken?: unknown;
  } = {},
): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(opts.internalActionToken);
  if (internalGuard) return internalGuard;

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          lastOutcome: true,
        },
      },
    },
  });

  if (!project) return { success: false, error: "Project not found" };
  const comp = getPrimaryLifecycleComponent(project);
  if (!comp || comp.powerIntent !== "ON" || comp.runtimeState !== "RUNNING") {
    return {
      success: false,
      error: "Preview refresh requires a running project runtime",
    };
  }

  await (prisma as any).projectEvent.create({
    data: {
        projectId,
        direction: "in",
        type: "preview_refresh_requested",
        payload: {
          source: opts.source ?? "admin",
          reason: opts.reason ?? "manual_refresh",
          maintenanceReason: opts.maintenanceReason ?? null,
        },
      },
    });

  progressBus.notifyChanged({
    type: "project_event",
    projectId,
  });
  revalidatePath(`/admin/projects/${projectId}`);

  return {
    success: true,
    details: "Preview refresh requested",
  };
}

export async function requestProjectPreviewRefresh(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;
  return requestProjectPreviewRefreshInternal(projectId, {
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function requestProjectRuntimeRecreateInternal(
  projectId: string,
  opts: {
    source?: "admin" | "cron" | "system";
    reason?: string;
    maintenanceReason?: string;
    internalActionToken?: unknown;
  } = {},
): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(opts.internalActionToken);
  if (internalGuard) return internalGuard;

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      proposalId: true,
      archivedAt: true,
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
          provisionedAt: true,
          previewUrl: true,
          containerName: true,
          workerHost: true,
          retryAt: true,
        },
      },
    },
  });

  if (!project) return { success: false, error: "Project not found" };
  const comp = getPrimaryLifecycleComponent(project);
  if (!comp || comp.powerIntent !== "ON") {
    return { success: false, error: "Runtime recreate requires App ON" };
  }
  if (comp.agentState === "RUNNING") {
    return { success: false, error: "Runtime recreate requires the agent to be idle or off" };
  }

  const source = opts.source ?? "admin";
  const reason = opts.reason ?? "manual_runtime_recreate";

  await (prisma as any).$transaction(async (tx: typeof prisma) => {
    await prepareRuntimeForFreshClaim(tx as any, projectId, {
      source: "system",
      trigger: "recreate_runtime",
      reason,
    }, {
      provisionedAt: null,
      clearInfraBlocker: true,
      preserveOutcome: true,
    });

    await (tx as any).runLog.create({
      data: {
        projectId,
        event: "RUNTIME_RECREATE",
        detail: JSON.stringify({
          source,
          trigger: "recreate_runtime",
          reason,
          before: {
            powerIntent: comp.powerIntent,
            agentIntent: comp.agentIntent,
            runtimeState: comp.runtimeState,
            agentState: comp.agentState,
            blockers: comp.blockers,
            provisionedAt: comp.provisionedAt,
            containerName: comp.containerName,
            previewUrl: comp.previewUrl,
            workerHost: comp.workerHost,
            retryAt: comp.retryAt,
            lastOutcome: comp.lastOutcome,
          },
        }),
      },
    });

    await (tx as any).projectEvent.create({
      data: {
        projectId,
        // RA-386: governance recreates the runtime itself a few lines below.
        // This row is not a command to anyone — it is the mark that the
        // blocked-maintenance cooldown reads, so it belongs in `internal`.
        direction: "internal",
        type: "runtime_recreate_requested",
        payload: {
          source,
          reason,
          maintenanceReason: opts.maintenanceReason ?? null,
        },
      },
    });
  });

  let deleteError: string | null = null;
  if (comp.containerName) {
    try {
      await removeWorkerContainer(comp.containerName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isBenignRuntimeRecreateDeleteError(message)) {
        deleteError = message;
      }
    }
  }

  revalidatePath("/");
  revalidatePath("/explore");
  revalidatePath("/admin");
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/my/projects/${projectId}`);
  const proposalPath = getProjectProposalPath(project);
  if (proposalPath) revalidatePath(proposalPath);
  notifyProjectChanged(projectId);

  if (deleteError) {
    return { success: false, error: deleteError };
  }

  return {
    success: true,
    details: "Runtime recreate requested",
  };
}

export async function requestProjectRuntimeRecreate(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;
  return requestProjectRuntimeRecreateInternal(projectId, {
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function destroyProjectVpsHost(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      proposalId: true,
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { kind: true, powerIntent: true, agentIntent: true, agentState: true, lastOutcome: true },
      },
      vpsHost: {
        select: {
          id: true,
          providerServerId: true,
          providerKeyId: true,
          previewDomain: true,
        },
      },
    },
  });

  if (!project) return { success: false, error: "Project not found" };
  if (!project.vpsHost) return { success: false, error: "Project has no VPS host" };
  const vpsComp = getPrimaryLifecycleComponent(project);
  const vpsIsActive = isOperatorActiveComponent(vpsComp);
  if (vpsIsActive) {
    return { success: false, error: "Cannot destroy VPS while project is active" };
  }

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { success: false, error: "HETZNER_API_TOKEN is not configured" };

  try {
    await destroyVps(
      apiToken,
      project.vpsHost.providerServerId,
      project.vpsHost.providerKeyId ?? undefined,
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to destroy VPS" };
  }

  const dnsToken = process.env.HETZNER_DNS_TOKEN;
  const dnsZoneId = process.env.HETZNER_DNS_ZONE_ID;
  const previewDomain = process.env.PREVIEW_DOMAIN;
  if (dnsToken && dnsZoneId && project.vpsHost.previewDomain && previewDomain) {
    const subdomain = project.vpsHost.previewDomain.replace(`.${previewDomain}`, "");
    await deleteDnsRecords(dnsToken, dnsZoneId, subdomain).catch((error) => {
      console.error("[runtime-maintenance] DNS cleanup failed:", error);
    });
  }

  await (prisma as any).vpsHost.delete({ where: { id: project.vpsHost.id } });

  revalidatePath("/admin");

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  const proposalPath = getProjectProposalPath(project);
  if (proposalPath) revalidatePath(proposalPath);
  notifyProjectChanged(projectId);

  return { success: true, details: "VPS host destroyed and detached from project" };
}

export async function rebootProjectVps(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      vpsHost: { select: { providerServerId: true } },
    },
  });

  if (!project) return { success: false, error: "Project not found" };
  if (!project.vpsHost) return { success: false, error: "Project has no VPS host" };

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { success: false, error: "HETZNER_API_TOKEN is not configured" };

  try {
    await rebootServer(apiToken, project.vpsHost.providerServerId);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reboot VPS" };
  }

  return { success: true, details: "VPS reboot initiated" };
}

export async function cleanupHetznerOrphans(): Promise<ActionResult> {
  const guard = await requirePlatformRuntimeAccess();
  if (guard) return guard;

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { success: false, error: "HETZNER_API_TOKEN is not configured" };

  const known = await (prisma as any).vpsHost.findMany({
    select: { providerServerId: true, providerKeyId: true },
  });
  const knownServerIds = new Set<string>(known.map((row: any) => String(row.providerServerId)));
  const knownKeyIds = new Set<string>(known.map((row: any) => String(row.providerKeyId)).filter(Boolean));

  const [servers, sshKeys] = await Promise.all([listServers(apiToken), listSshKeys(apiToken)]);
  const orphanServers = servers.filter((server) => server.name.startsWith("arena-") && !knownServerIds.has(server.id));
  const orphanKeys = sshKeys.filter((key) => key.name.startsWith("arena-") && !knownKeyIds.has(key.id));

  for (const server of orphanServers) {
    await destroyVps(apiToken, server.id).catch((error) => {
      console.error(`[runtime-maintenance] Failed to destroy orphan server ${server.id}:`, error);
    });
  }
  for (const key of orphanKeys) {
    await deleteSshKey(apiToken, key.id).catch((error) => {
      console.error(`[runtime-maintenance] Failed to delete orphan SSH key ${key.id}:`, error);
    });
  }

  revalidatePath("/admin");


  return {
    success: true,
    details: `${orphanServers.length} orphan server(s) and ${orphanKeys.length} orphan SSH key(s) cleaned`,
  };
}

// VPS fleet

import type { VpsFleetEntry } from "@/lib/action-types";

export async function getVpsFleet(): Promise<{ entries: VpsFleetEntry[]; error?: string }> {
  const guard = await requirePlatformRuntimeAccess();
  if (guard) return { entries: [], error: guard.error };

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { entries: [], error: "HETZNER_API_TOKEN is not configured" };

  const [hetznerServers, dbHosts] = await Promise.all([
    listServers(apiToken),
    (prisma as any).vpsHost.findMany({
      select: {
        id: true,
        providerServerId: true,
        status: true,
        region: true,
        serverType: true,
        previewDomain: true,
        projectId: true,
        project: {
          select: {
            name: true,
            archivedAt: true,
            proposal: { select: { title: true } },
            components: {
              orderBy: { createdAt: "asc" as const },
              take: 1,
              select: {
                kind: true,
                powerIntent: true,
                agentIntent: true,
                runtimeState: true,
                agentState: true,
                blockers: true,
                lastOutcome: true,
                previewUrl: true,
                previewHealth: true,
                containerName: true,
                provisionedAt: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const dbByServerId = new Map<string, any>();
  for (const host of dbHosts) {
    dbByServerId.set(String(host.providerServerId), host);
  }

  const entries: VpsFleetEntry[] = hetznerServers
    .filter((s: HetznerServer) => s.name.startsWith("arena-"))
    .map((s: HetznerServer) => {
      const db = dbByServerId.get(s.id);
      return {
        hetznerServerId: s.id,
        name: s.name,
        hetznerStatus: s.status,
        ip: s.ip,
        serverType: s.serverType,
        location: s.location,
        created: s.created,
        dbRecord: db ? {
          id: db.id,
          status: db.status,
          region: db.region,
          serverType: db.serverType,
          projectId: db.projectId,
          projectName: db.project?.proposal?.title ?? db.project?.name ?? null,
          projectStatus: db.project
            ? getPublicDisplayStatus({
                archivedAt: db.project.archivedAt ?? null,
                components: db.project.components ?? undefined,
              })
            : null,
          previewDomain: db.previewDomain,
        } : null,
        orphan: !db,
      };
    });

  return { entries };
}

export async function destroyVpsServer(hetznerServerId: string): Promise<ActionResult> {
  const guard = await requirePlatformRuntimeAccess();
  if (guard) return guard;

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { success: false, error: "HETZNER_API_TOKEN is not configured" };

  // Check if this server is linked to an active project
  const dbHost = await (prisma as any).vpsHost.findFirst({
    where: { providerServerId: hetznerServerId },
    select: {
      id: true,
      providerKeyId: true,
      previewDomain: true,
      projectId: true,
      project: {
        select: {
          archivedAt: true,
          components: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { kind: true, powerIntent: true, agentIntent: true, agentState: true, lastOutcome: true },
          },
        },
      },
    },
  });

  if (dbHost?.project) {
    const hComp = getPrimaryLifecycleComponent(dbHost.project);
    const hActive = isOperatorActiveComponent(hComp);
    if (hActive) {
      return { success: false, error: "Cannot destroy VPS while linked project is active" };
    }
  }

  try {
    await destroyVps(apiToken, hetznerServerId, dbHost?.providerKeyId ?? undefined);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to destroy VPS" };
  }

  // Cleanup DNS if applicable
  const dnsToken = process.env.HETZNER_DNS_TOKEN;
  const dnsZoneId = process.env.HETZNER_DNS_ZONE_ID;
  const previewDomain = process.env.PREVIEW_DOMAIN;
  if (dnsToken && dnsZoneId && dbHost?.previewDomain && previewDomain) {
    const subdomain = dbHost.previewDomain.replace(`.${previewDomain}`, "");
    await deleteDnsRecords(dnsToken, dnsZoneId, subdomain).catch((e) => {
      console.error("[vps-fleet] DNS cleanup failed:", e);
    });
  }

  // Remove DB record if exists
  if (dbHost) {
    await (prisma as any).vpsHost.delete({ where: { id: dbHost.id } });
  }

  revalidatePath("/admin");

  progressBus.notifyChanged();

  return { success: true, details: "VPS server destroyed" };
}

export async function rebootVpsServer(hetznerServerId: string): Promise<ActionResult> {
  const guard = await requirePlatformRuntimeAccess();
  if (guard) return guard;

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { success: false, error: "HETZNER_API_TOKEN is not configured" };

  try {
    await rebootServer(apiToken, hetznerServerId);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to reboot VPS" };
  }

  return { success: true, details: "VPS reboot initiated" };
}

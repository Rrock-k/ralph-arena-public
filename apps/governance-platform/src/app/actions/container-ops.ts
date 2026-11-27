"use server";

import { prisma } from "@/lib/prisma";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { resolveWorkerUrl } from "@/lib/worker-url";
import { revalidatePath } from "next/cache";
import { requirePlatformCapability } from "@/lib/platform-access";
import { requireProjectCapability } from "@/lib/project-access";
import { requireProjectRuntimeActionAccess } from "@/lib/runtime-action-access";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

type ActionResult = { success: boolean; error?: string };

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "";

function workerHeaders(): Record<string, string> {
  return WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {};
}

async function requireProjectRuntimeAccess(projectId: string): Promise<ActionResult | null> {
  return requireProjectRuntimeActionAccess(projectId);
}

async function requireProjectReadAccess(projectId: string): Promise<ActionResult | null> {
  const access = await requireProjectCapability(projectId, "project.view");
  if (access.authorized) {
    return null;
  }
  return { success: false, error: access.error };
}

async function requirePlatformRuntimeAccess(): Promise<ActionResult | null> {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (access.authorized) {
    return null;
  }
  return { success: false, error: access.error };
}

interface ProjectForWorker {
  containerName: string | null;
  workerHost: string | null;
  vpsHost: { ip: string } | null;
}

async function getProjectForWorker(projectId: string): Promise<ProjectForWorker | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      vpsHost: { select: { ip: true } },
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: { kind: true, containerName: true, workerHost: true },
      },
    },
  });
  if (!project) return null;
  const comp = getPrimaryLifecycleComponent(project);
  return {
    containerName: comp?.containerName ?? null,
    workerHost: comp?.workerHost ?? null,
    vpsHost: project.vpsHost,
  };
}

function requireWorkerUrl(project: ProjectForWorker): { url: string } | ActionResult {
  const url = resolveWorkerUrl(project.workerHost, project.vpsHost?.ip);
  if (!url) return { success: false, error: `Cannot reach worker for host "${project.workerHost}" (no VPS IP)` };
  return { url };
}

async function requireProjectContainerTarget(projectId: string): Promise<
  | { ok: true; project: ProjectForWorker & { containerName: string }; workerUrl: string }
  | { ok: false; error: string }
> {
  const project = await getProjectForWorker(projectId);
  if (!project?.containerName) return { ok: false, error: "No container name" };

  const resolved = requireWorkerUrl(project);
  if ("success" in resolved) return { ok: false, error: resolved.error || "Cannot reach worker" };

  return {
    ok: true,
    project: { ...project, containerName: project.containerName },
    workerUrl: resolved.url,
  };
}

import type { ContainerInfo } from "@/lib/action-types";

export async function inspectContainerInternal(projectId: string, internalActionToken?: unknown): Promise<ContainerInfo> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return { status: "error", error: internalGuard.error };

  const target = await requireProjectContainerTarget(projectId);
  if (!target.ok) {
    return target.error === "No container name"
      ? { status: "not_found" }
      : { status: "error", error: target.error };
  }
  try {
    const res = await fetch(
      `${target.workerUrl}/containers/${encodeURIComponent(target.project.containerName)}/inspect`,
      { headers: workerHeaders(), signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) {
      return { status: "error", error: `Worker returned ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function inspectContainer(projectId: string): Promise<ContainerInfo> {
  const guard = await requireProjectReadAccess(projectId);
  if (guard) return { status: "error", error: guard.error };

  return inspectContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
}

async function startContainerRequest(workerUrl: string, containerName: string): Promise<ActionResult> {
  try {
    const res = await fetch(
      `${workerUrl}/containers/${encodeURIComponent(containerName)}/start`,
      { method: "POST", headers: workerHeaders(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `Start failed (${res.status}): ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function stopContainerRequest(workerUrl: string, containerName: string): Promise<ActionResult> {
  try {
    const res = await fetch(
      `${workerUrl}/containers/${encodeURIComponent(containerName)}/stop`,
      { method: "POST", headers: workerHeaders(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `Stop failed (${res.status}): ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function restartContainerRequest(workerUrl: string, containerName: string): Promise<ActionResult> {
  try {
    const res = await fetch(
      `${workerUrl}/containers/${encodeURIComponent(containerName)}/restart`,
      { method: "POST", headers: workerHeaders(), signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `Restart failed (${res.status}): ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function removeContainerRequest(workerUrl: string, containerName: string): Promise<ActionResult> {
  try {
    const res = await fetch(
      `${workerUrl}/containers/${encodeURIComponent(containerName)}`,
      { method: "DELETE", headers: workerHeaders(), signal: AbortSignal.timeout(15_000) },
    );
    if (res.status === 404) {
      return { success: true };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `Remove failed (${res.status}): ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function startContainerInternal(projectId: string, internalActionToken?: unknown): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const target = await requireProjectContainerTarget(projectId);
  if (!target.ok) return { success: false, error: target.error };

  return startContainerRequest(target.workerUrl, target.project.containerName);
}

export async function stopContainerInternal(projectId: string, internalActionToken?: unknown): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const target = await requireProjectContainerTarget(projectId);
  if (!target.ok) return { success: false, error: target.error };

  return stopContainerRequest(target.workerUrl, target.project.containerName);
}

export async function restartContainerInternal(projectId: string, internalActionToken?: unknown): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const target = await requireProjectContainerTarget(projectId);
  if (!target.ok) return { success: false, error: target.error };

  return restartContainerRequest(target.workerUrl, target.project.containerName);
}

export async function removeContainerInternal(projectId: string, internalActionToken?: unknown): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const target = await requireProjectContainerTarget(projectId);
  if (!target.ok) return { success: false, error: target.error };

  return removeContainerRequest(target.workerUrl, target.project.containerName);
}

export async function startContainer(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  return startContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
}

export async function stopContainer(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  return stopContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
}

export async function restartContainer(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  return restartContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
}

export async function removeContainer(projectId: string): Promise<ActionResult> {
  const guard = await requireProjectRuntimeAccess(projectId);
  if (guard) return guard;

  return removeContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
}

// ── RA-247: Sleep All → Power OFF all running ────────────

export async function powerOffAllRunning(): Promise<{ stopped: number; errors: number }> {
  const guard = await requirePlatformRuntimeAccess();
  if (guard) return { stopped: 0, errors: 0 };

  const { setPowerIntentInternal } = await import("@/app/actions/power-intent");

  const projects = await prisma.project.findMany({
    where: {
      components: {
        some: {
          kind: "app",
          powerIntent: "ON",
          runtimeState: "RUNNING",
          containerName: { not: null },
        },
      },
    },
    select: { id: true },
  });

  let stopped = 0;
  let errors = 0;
  for (const p of projects) {
    const result = await setPowerIntentInternal(p.id, "OFF", INTERNAL_ACTION_TOKEN);
    if (result.success) stopped++;
    else errors++;
  }
  revalidatePath("/admin");

  return { stopped, errors };
}

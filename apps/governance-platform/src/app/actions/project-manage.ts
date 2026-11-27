"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { destroyVps, deleteDnsRecords } from "@/lib/vps/hetzner";
import { buildProjectWorkspaceLabel, getProjectProposalPath } from "@/lib/project-identity";
import { getWorkspaceRoot } from "@/lib/control-plane";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { rm } from "node:fs/promises";
import path from "node:path";
import { requireProjectCapability } from "@/lib/project-access";
import { resolveWorkerUrl } from "@/lib/worker-url";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "";

/* helpers */

async function removeDockerContainer(workerUrl: string, name: string): Promise<void> {
  const res = await fetch(`${workerUrl}/containers/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {},
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Worker-agent DELETE /containers/${name} failed (${res.status}): ${body}`);
  }
  console.log(`[project-manage] Removed container ${name} via worker-agent`);
}

async function removeWorkspace(label: string): Promise<void> {
  const ws = path.join(getWorkspaceRoot(), label);
  await rm(ws, { recursive: true, force: true });
  console.log(`[project-manage] Removed workspace ${ws}`);
}

/* action */

interface DeleteOptions {
  removeDocker?: boolean;
  removeWorkspace?: boolean;
  internalActionToken?: unknown;
}

export async function deleteProjectInternal(projectId: string, opts: DeleteOptions = {}) {
  const internalGuard = requireInternalActionToken(opts.internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        proposalId: true,
        proposal: { select: { title: true } },
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" as const },
          take: 1,
          select: {
            kind: true,
            containerName: true,
            workerHost: true,
          },
        },
        vpsHost: { select: { ip: true, providerServerId: true, providerKeyId: true, previewDomain: true } },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const label = buildProjectWorkspaceLabel(project);
    const primaryComponent = getPrimaryLifecycleComponent(project);
    const workerUrl = resolveWorkerUrl(primaryComponent?.workerHost ?? null, project.vpsHost?.ip);

    // Best-effort cleanup before DB delete
    if (opts.removeDocker && workerUrl) {
      await removeDockerContainer(workerUrl, `preview-${label}`).catch((e) =>
        console.error("[project-manage] Docker container cleanup failed:", `preview-${label}`, e.message),
      );
      if (primaryComponent?.containerName) {
        await removeDockerContainer(workerUrl, primaryComponent.containerName).catch((e) =>
          console.error("[project-manage] Docker container cleanup failed:", primaryComponent.containerName, e.message),
        );
      }
    }
    if (opts.removeWorkspace) {
      await removeWorkspace(label).catch((e) =>
        console.error("[project-manage] Workspace cleanup failed:", e),
      );
    }

    // RA-085 + RA-082: Destroy VPS + SSH key if provisioned
    if (project.vpsHost) {
      const apiToken = process.env.HETZNER_API_TOKEN;
      if (apiToken) {
        await destroyVps(apiToken, project.vpsHost.providerServerId, project.vpsHost.providerKeyId ?? undefined).catch((e) =>
          console.error("[project-manage] VPS destroy failed:", e),
        );
        // Clean up DNS records
        const dnsToken = process.env.HETZNER_DNS_TOKEN;
        const dnsZoneId = process.env.HETZNER_DNS_ZONE_ID;
        const previewDomain = process.env.PREVIEW_DOMAIN;
        if (dnsToken && dnsZoneId && project.vpsHost.previewDomain && previewDomain) {
          const subdomain = project.vpsHost.previewDomain.replace(`.${previewDomain}`, "");
          await deleteDnsRecords(dnsToken, dnsZoneId, subdomain).catch((e) =>
            console.error("[project-manage] DNS cleanup failed:", e),
          );
        }
        console.log(`[project-manage] VPS destroyed for project ${projectId}`);
      }
    }

    await prisma.project.delete({
      where: { id: projectId },
    });

    revalidatePath("/");
    revalidatePath("/my");
    revalidatePath("/admin");

    const proposalPath = getProjectProposalPath(project);
    if (proposalPath) revalidatePath(proposalPath);
    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Delete project error:", error);
    return { success: false, error: "Failed to delete project" };
  }
}

export async function deleteProject(projectId: string, opts: DeleteOptions = {}) {
  const access = await requireProjectCapability(projectId, "project.delete");
  if (!access.authorized) return { success: false, error: access.error };

  return deleteProjectInternal(projectId, {
    ...opts,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

/** RA-216: Safe rename — changes display name only, slug stays immutable. */
export async function renameProjectInternal(projectId: string, newName: string, internalActionToken?: unknown) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  const trimmed = newName.trim();
  if (!trimmed) return { success: false, error: "Name is required" };
  if (trimmed.length > 200) return { success: false, error: "Name too long" };

  await prisma.project.update({
    where: { id: projectId },
    data: { name: trimmed },
  });

  revalidatePath("/");
  revalidatePath("/admin");
  notifyProjectChanged(projectId);
  return { success: true };
}

export async function renameProject(projectId: string, newName: string) {
  const access = await requireProjectCapability(projectId, "project.settings.manage");
  if (!access.authorized) return { success: false, error: access.error };

  return renameProjectInternal(projectId, newName, INTERNAL_ACTION_TOKEN);
}

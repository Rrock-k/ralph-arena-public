"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { getProjectProposalPath } from "@/lib/project-identity";
import { requireProjectCapability } from "@/lib/project-access";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

type TransactionClient = Prisma.TransactionClient;
const TG_SPEC_MIRROR_READ_ONLY_ERROR = "Evolution mirror spec is read-only";

export async function createSpecInternal(
  projectId: string,
  input: { title?: string; content: string },
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: { id: true, proposalId: true },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const content = input.content?.trim();
    if (!content) {
      return { success: false, error: "Content is required" };
    }

    // Get next orderIndex
    const lastSpec = await (prisma as any).spec.findFirst({
      where: { projectId },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    const nextIndex = (lastSpec?.orderIndex ?? -1) + 1;

    const spec = await prisma.$transaction(async (tx: TransactionClient) => {
      const newSpec = await tx.spec.create({
        data: {
          projectId,
          title: input.title?.trim() || null,
          content,
          orderIndex: nextIndex,
        },
      });

      // Create initial version
      await tx.specVersion.create({
        data: {
          specId: newSpec.id,
          version: 1,
          content,
          message: "Initial version",
        },
      });

      return newSpec;
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/my/projects/${projectId}`);
    const proposalPath = getProjectProposalPath(project);
    if (proposalPath) revalidatePath(proposalPath);
    revalidatePath("/my");
    revalidatePath("/admin");
    notifyProjectChanged(projectId);


    // RA-107: Smart auto-relaunch — skip for RUNNING (runner already polls specs)
    autoRelaunchIfNeeded(projectId).catch((err) => {
      console.warn("[specs] auto-relaunch failed:", err);
    });

    return { success: true, specId: spec.id };
  } catch (error) {
    console.error("Create spec error:", error);
    return { success: false, error: "Failed to create spec" };
  }
}

export async function createSpec(
  projectId: string,
  input: { title?: string; content: string }
) {
  const access = await requireProjectCapability(projectId, "project.specs.write");
  if (!access.authorized) return { success: false, error: access.error };

  return createSpecInternal(projectId, input, INTERNAL_ACTION_TOKEN);
}

export async function updateSpecInternal(
  specId: string,
  input: { title?: string; content: string },
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const existingSpec = await (prisma as any).spec.findUnique({
      where: { id: specId },
      select: {
        id: true,
        projectId: true,
        title: true,
        content: true,
        project: { select: { proposalId: true, tgSpecMirrorSpecId: true } },
      },
    });

    if (!existingSpec) {
      return { success: false, error: "Spec not found" };
    }

    if (existingSpec.project.tgSpecMirrorSpecId === specId) {
      return { success: false, error: TG_SPEC_MIRROR_READ_ONLY_ERROR };
    }

    const content = input.content?.trim();
    if (!content) {
      return { success: false, error: "Content is required" };
    }

    // Skip if nothing changed
    if (content === existingSpec.content && (input.title?.trim() || null) === existingSpec.title) {
      return { success: true, specId };
    }

    await prisma.$transaction(async (tx: TransactionClient) => {
      // Update spec
      await tx.spec.update({
        where: { id: specId },
        data: {
          title: input.title?.trim() || null,
          content,
        },
      });

      // Get next version number
      const lastVersion = await tx.specVersion.findFirst({
        where: { specId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      // Create version record
      await tx.specVersion.create({
        data: {
          specId,
          version: nextVersion,
          content,
          message: null,
        },
      });
    });

    revalidatePath(`/projects/${existingSpec.projectId}`);
    revalidatePath(`/my/projects/${existingSpec.projectId}`);
    const proposalPath = getProjectProposalPath(existingSpec.project);
    if (proposalPath) revalidatePath(proposalPath);
    revalidatePath("/my");
    revalidatePath("/admin");
    notifyProjectChanged(existingSpec.projectId);


    // RA-107: Smart auto-relaunch
    autoRelaunchIfNeeded(existingSpec.projectId).catch((err) => {
      console.warn("[specs] auto-relaunch failed:", err);
    });

    return { success: true, specId };
  } catch (error) {
    console.error("Update spec error:", error);
    return { success: false, error: "Failed to update spec" };
  }
}

export async function updateSpec(
  specId: string,
  input: { title?: string; content: string }
) {
  const existingSpec = await (prisma as any).spec.findUnique({
    where: { id: specId },
    select: { projectId: true },
  });
  if (!existingSpec) {
    return { success: false, error: "Spec not found" };
  }

  const access = await requireProjectCapability(existingSpec.projectId, "project.specs.write");
  if (!access.authorized) return { success: false, error: access.error };

  return updateSpecInternal(specId, input, INTERNAL_ACTION_TOKEN);
}

export async function deleteSpec(specId: string) {
  try {
    const spec = await (prisma as any).spec.findUnique({
      where: { id: specId },
      select: {
        id: true,
        projectId: true,
        project: { select: { proposalId: true, tgSpecMirrorSpecId: true } },
      },
    });

    if (!spec) {
      return { success: false, error: "Spec not found" };
    }

    if (spec.project.tgSpecMirrorSpecId === specId) {
      return { success: false, error: TG_SPEC_MIRROR_READ_ONLY_ERROR };
    }
    const access = await requireProjectCapability(spec.projectId, "project.specs.write");
    if (!access.authorized) return { success: false, error: access.error };

    // Cascade delete handles SpecVersions
    await (prisma as any).spec.delete({ where: { id: specId } });

    revalidatePath(`/projects/${spec.projectId}`);
    revalidatePath(`/my/projects/${spec.projectId}`);
    const proposalPath = getProjectProposalPath(spec.project);
    if (proposalPath) revalidatePath(proposalPath);
    revalidatePath("/my");
    revalidatePath("/admin");
    notifyProjectChanged(spec.projectId);

    return { success: true };
  } catch (error) {
    console.error("Delete spec error:", error);
    return { success: false, error: "Failed to delete spec" };
  }
}

/**
 * RA-257: Spec edits never force a relaunch anymore.
 * The pending work is picked up by:
 * - a live runner (spec polling / idle supervisor),
 * - runtime-intents when runtime is absent but App+Agent are ON,
 * - the next power/agent enable when the project is currently OFF.
 */
async function autoRelaunchIfNeeded(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      archivedAt: true,
      components: {
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: { kind: true, powerIntent: true, agentIntent: true, runtimeState: true, agentState: true, lastOutcome: true },
      },
    },
  });
  if (!project) return;

  const comp = getPrimaryLifecycleComponent(project);
  const runnerPollsSpecs =
    comp &&
    comp.powerIntent === "ON" &&
    comp.runtimeState === "RUNNING" &&
    (comp.agentState === "RUNNING" || comp.agentState === "IDLE" || comp.agentIntent === "OFF");
  if (runnerPollsSpecs) {
    console.log(`[specs] Spec change for ${projectId} stays on live runner path`);
    return;
  }

  if (comp?.powerIntent === "ON" && comp.agentIntent === "ON") {
    console.log(`[specs] Spec change for ${projectId} stays on runtime-intent/provisioner path`);
    return;
  }

  console.log(`[specs] Spec change for ${projectId} recorded; pending work will be picked up on next enable`);
}

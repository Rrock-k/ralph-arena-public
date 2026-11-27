import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { revalidatePath } from "next/cache";
import { isCronAuthorized } from "@/lib/internal-auth";
import { parkInfraBlocked } from "@/lib/claim-blockers";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";

const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const ACTIVE_RUN_COMPONENT_SELECTOR = {
  kind: "app" as const,
  powerIntent: "ON" as const,
  runtimeState: "RUNNING" as const,
};

// RA-209: Zombie = claimed but container never started (runtimeState=ABSENT, agentState=IDLE)
const ZOMBIE_COMPONENT_SELECTOR = {
  kind: "app" as const,
  powerIntent: "ON" as const,
  runtimeState: "ABSENT" as const,
  blockers: { isEmpty: true as const },
  provisionedAt: { not: null as unknown as Date },
  workerHost: { not: null as unknown as string },
};

// RA-387: staleness is a property of the runtime, not of the agent. Preview-only
// runtimes report `agentState=IDLE` and still send heartbeats, so filtering on
// `RUNNING`/`null` left every AGENT OFF preview outside the reaper's reach — a
// runner that stopped supervising kept its container `Up` and its component
// `RUNNING/HEALTHY` indefinitely. A live runtime heartbeats; silence means it is
// gone regardless of what the agent was doing.
function staleRunningSelector(cutoff: Date) {
  return {
    archivedAt: null as Date | null,
    OR: [
      {
        components: {
          some: {
            ...ACTIVE_RUN_COMPONENT_SELECTOR,
            lastHeartbeat: { lt: cutoff },
          },
        },
      },
      {
        components: {
          some: {
            ...ACTIVE_RUN_COMPONENT_SELECTOR,
            provisionedAt: { lt: cutoff },
            lastHeartbeat: null,
          },
        },
      },
    ],
  };
}

// RA-209: Projects claimed by worker but container never started, stale heartbeat
function zombieSelector(cutoff: Date) {
  return {
    archivedAt: null as Date | null,
    OR: [
      {
        components: {
          some: {
            ...ZOMBIE_COMPONENT_SELECTOR,
            OR: [
              { agentState: "IDLE" as const },
              { agentState: null },
            ],
            lastHeartbeat: { lt: cutoff },
          },
        },
      },
      {
        components: {
          some: {
            ...ZOMBIE_COMPONENT_SELECTOR,
            OR: [
              { agentState: "IDLE" as const },
              { agentState: null },
            ],
            provisionedAt: { lt: cutoff },
            lastHeartbeat: null,
          },
        },
      },
    ],
  };
}

async function parkZombieProject(tx: Prisma.TransactionClient, projectId: string) {
  const row = await requirePrimaryComponentRow(tx, projectId);

  if (row.runtimeState !== "ABSENT") {
    await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "ABSENT" }, {
      source: "system",
      trigger: "zombie_recovery_timeout",
    });
  }

  await parkInfraBlocked(
    tx,
    projectId,
    "Container never started before heartbeat timeout",
    "zombie_recovery_timeout",
    { source: "system" },
  );

  await updateComponentMetadata(tx, projectId, {
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    workerHost: null,
    lastHeartbeat: null,
    containerName: null,
    previewUrl: null,
  }, {
    source: "system",
    trigger: "zombie_recovery_timeout",
  });
}

/**
 * POST /api/cron/reaper
 *
 * Finds stale active runtimes and parks them as INFRA through the core blocker plane.
 * No worker-driven recovery/reconcile pass exists anymore.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  const cronCtx = { source: "cron" as const, trigger: "reaper" };

  const staleProjects = await prisma.project.findMany({
    where: staleRunningSelector(cutoff),
    select: {
      id: true,
    },
  });

  const reaped: string[] = [];

  for (const project of staleProjects) {
    await prisma.$transaction(async (tx) => {
      await parkInfraBlocked(
        tx,
        project.id,
        "Runtime stopped reporting (no heartbeat for 15 min)",
        "reaper_timeout",
        { source: "cron" },
      );

      // RA-387: the blocker alone left `previewHealth=HEALTHY` standing on a
      // runtime we just declared unreachable. Health is an observation, and the
      // last one is 15 minutes stale — say we do not know instead of repeating
      // a stale success.
      await updateComponentMetadata(tx, project.id, {
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
      }, {
        source: "system",
        trigger: "reaper_timeout",
      });
    });

    notifyProjectChanged(project.id);

    reaped.push(project.id);
  }

  // RA-209: Re-queue zombie projects (claimed but container never started)
  const zombieProjects = await prisma.project.findMany({
    where: zombieSelector(cutoff),
    select: {
      id: true,
      components: {
        where: {
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          OR: [
            { agentState: "IDLE" },
            { agentState: null },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { retryCount: true },
      },
    },
  });

  for (const project of zombieProjects) {
    await prisma.$transaction(async (tx) => {
      await parkZombieProject(tx, project.id);
    });
    reaped.push(project.id);
  }

  const changed = reaped.length;
  if (changed > 0) {
    revalidatePath("/");
    revalidatePath("/admin");

  }

  if (reaped.length > 0) console.log(`[reaper] Paused ${reaped.length} stale projects: ${reaped.join(", ")}`);

  return NextResponse.json({ reaped: reaped.length, requeued: 0, projectIds: reaped });
}

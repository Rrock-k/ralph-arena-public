import { NextResponse } from "next/server";
import { RuntimeIntentClaimRequestSchema, type RuntimeIntentClaimed } from "@arena/contracts";
import { prisma } from "@/lib/prisma";
import { isWorkerAuthorized } from "@/lib/internal-auth";
import { prepareRuntimeLaunch } from "@/lib/agent-run-launch";
import { parkAuthUnavailable, parkBudgetBlocked } from "@/lib/claim-blockers";
import {
  getRuntimeIntentAttempt,
  listRuntimeIntentClaimCandidates,
  normalizeActivePreviewContainers,
  resolveRuntimeIntentCandidateDecision,
  RUNTIME_INTENT_LEASE_MS,
  RUNTIME_INTENT_MAX_ATTEMPTS,
} from "@/lib/runtime-intent-claim-projection";

const CLAIM_TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 30_000,
} as const;

async function claimRuntimeIntent(
  host: string,
  capacity: number,
  activePreviewContainers: string[] | null,
): Promise<RuntimeIntentClaimed | null> {
  const backend = host === "local" ? "local" : "vps";
  const lockedUntil = new Date(Date.now() + RUNTIME_INTENT_LEASE_MS);
  const normalizedActivePreviewContainers = normalizeActivePreviewContainers(activePreviewContainers);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE "RuntimeIntent"
       SET state = 'FAILED',
           error = COALESCE(error, 'Runtime intent lease expired'),
           "updatedAt" = NOW()
       WHERE state = 'CLAIMED'
         AND "lockedUntil" IS NOT NULL
         AND "lockedUntil" <= NOW()`,
    );

    const candidates = await listRuntimeIntentClaimCandidates(tx, {
      host,
      backend,
      activePreviewContainers: normalizedActivePreviewContainers,
      lockCandidates: true,
      limit: 20,
    });

    for (const candidate of candidates) {
      const {
        decision: claimedIntent,
        workspaceLabel,
      } = resolveRuntimeIntentCandidateDecision(candidate, {
        host,
        capacity,
        activePreviewContainers: normalizedActivePreviewContainers,
        maxAttempts: RUNTIME_INTENT_MAX_ATTEMPTS,
      });
      if (!claimedIntent) {
        continue;
      }

      let launchPayload: Awaited<ReturnType<typeof prepareRuntimeLaunch>> | null = null;
      if (claimedIntent.action === "ensure_running") {
        const project = await tx.project.findUnique({
          where: { id: candidate.projectId },
          include: {
            budget: true,
            secrets: true,
            components: {
              orderBy: { createdAt: "asc" },
              take: 1,
            },
            proposal: { select: { title: true } },
          },
        });
        if (!project) {
          continue;
        }

        launchPayload = await prepareRuntimeLaunch(project as any, backend, claimedIntent.runnerMode);
        if (!launchPayload.ok) {
          if (launchPayload.kind === "budget_blocked") {
            await parkBudgetBlocked(tx, candidate.projectId, launchPayload.message, "runtime_intent_budget_blocked");
          } else {
            await parkAuthUnavailable(tx, candidate.projectId, launchPayload.message, "runtime_intent_auth_unavailable");
          }
          continue;
        }
      }

      const attempt = getRuntimeIntentAttempt(candidate, claimedIntent.action);

      const lease = await tx.runtimeIntent.create({
        data: {
          projectId: candidate.projectId,
          componentId: candidate.componentId,
          host,
          action: claimedIntent.action,
          runnerMode: claimedIntent.runnerMode,
          state: "CLAIMED",
          attempt,
          lockedUntil,
        },
        select: { id: true },
      });

      if (claimedIntent.action === "ensure_running") {
        if (!launchPayload?.ok) {
          throw new Error("ensure_running intent missing launch payload");
        }

        const runningClaim = {
          intentId: lease.id,
          projectId: candidate.projectId,
          action: "ensure_running" as const,
          containerName: candidate.containerName,
          workspaceLabel: launchPayload.payload.workspaceLabel || workspaceLabel,
          workerImage: launchPayload.payload.workerImage,
          attempt,
          ...(launchPayload.payload.resources ? { resources: launchPayload.payload.resources } : {}),
          env: launchPayload.payload.env,
        };

        if (claimedIntent.runnerMode === "agent_run") {
          const claim: RuntimeIntentClaimed = {
            ...runningClaim,
            runnerMode: "agent_run",
          };
          return claim;
        }

        const claim: RuntimeIntentClaimed = {
          ...runningClaim,
          runnerMode: "preview_only",
        };
        return claim;
      }

      const claim: RuntimeIntentClaimed = {
        intentId: lease.id,
        projectId: candidate.projectId,
        action: claimedIntent.action,
        runnerMode: "preview_only",
        containerName: candidate.containerName,
        workspaceLabel,
        workerImage: null,
        attempt,
      };
      return claim;
    }
    return null;
  }, CLAIM_TRANSACTION_OPTIONS);
}

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => ({}));
  const { host, capacity, activePreviewContainers } = RuntimeIntentClaimRequestSchema.parse(raw);
  const intent = await claimRuntimeIntent(
    host,
    Math.max(capacity ?? 1, 0),
    activePreviewContainers ?? null,
  );

  return NextResponse.json(intent);
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { isCronAuthorized } from "@/lib/internal-auth";
import {
  applyStateChange,
  updateComponentMetadata,
  requirePrimaryComponentRow,
} from "@/lib/project-state-effects";
import {
  getMaxRetries,
  getRetryableBlocker,
} from "@/lib/retry-backoff";
import { fetchProviderQuotaSnapshot, type ProviderQuotaResponse } from "@/lib/provider-quotas";
import {
  platformSubscriptionQuotaProvider,
  providerQuotaAvailability,
} from "@/lib/provider-quota-unpark";

/**
 * POST /api/cron/auto-retry
 *
 * RA-192: Finds projects with retryable blockers (RATE_LIMIT, INFRA, API)
 * whose backoff has elapsed, and clears the due blocker so the normal
 * runtime-intent / runner paths can resume work.
 *
 * RA-382: A `RATE_LIMIT` row may also be unparked before its `retryAt`, but
 * only on live evidence — the provider's own quota window reporting headroom
 * for the shared platform subscription that row runs on.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find projects with blockers and powerIntent=ON (they want to run but are blocked)
  const blockedProjects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      components: {
        some: {
          kind: "app",
          powerIntent: "ON",
          blockers: { isEmpty: false },
        },
      },
    },
    select: {
      id: true,
      agent: true,
      providerBillingMode: true,
      claudeAuthMode: true,
      codexAuthMode: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: { blockers: true, retryAt: true, retryCount: true },
      },
    },
  });

  if (!blockedProjects.length) {
    return NextResponse.json({ retried: 0 });
  }

  const retried: string[] = [];
  const cronCtx = { source: "cron" as const, trigger: "auto-retry" };

  // One snapshot per cron pass, fetched only if a rate-limited row actually
  // asks for it. A failed probe is not evidence of headroom, so it degrades to
  // the plain `retryAt` wait rather than unparking optimistically.
  let quotaSnapshot: Promise<ProviderQuotaResponse | null> | null = null;
  const loadQuotaSnapshot = () => {
    if (!quotaSnapshot) {
      quotaSnapshot = fetchProviderQuotaSnapshot().catch((error: unknown) => {
        console.warn(
          `[auto-retry] provider quota snapshot unavailable, falling back to retryAt: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });
    }
    return quotaSnapshot;
  };

  for (const project of blockedProjects) {
    const primaryComponent = project.components[0] ?? null;
    const blockers = primaryComponent?.blockers ?? [];
    const retryableBlocker = getRetryableBlocker(blockers);
    if (!retryableBlocker) continue;

    const retryCount = primaryComponent?.retryCount ?? 0;
    const maxRetries = getMaxRetries(retryableBlocker);

    if (retryableBlocker !== "RATE_LIMIT" && retryCount >= maxRetries) {
      await prisma.$transaction(async (tx) => {
        await requirePrimaryComponentRow(tx, project.id);
        await updateComponentMetadata(tx, project.id, {
          retryAt: null,
        }, { ...cronCtx, reason: "max_retries_exceeded" });
      });
      console.log(
        `[auto-retry] Project ${project.id} exceeded max retries (${retryCount}/${maxRetries}), left paused for manual intervention`,
      );
      continue;
    }

    const retryAt = primaryComponent?.retryAt
      ? new Date(primaryComponent.retryAt)
      : null;

    if (!retryAt) {
      continue;
    }

    let quotaFreedEarly = false;

    if (retryAt.getTime() > Date.now()) {
      if (retryableBlocker !== "RATE_LIMIT") continue;

      const quotaProvider = platformSubscriptionQuotaProvider(project);
      if (!quotaProvider) continue;

      const snapshot = await loadQuotaSnapshot();
      if (!snapshot) continue;
      if (providerQuotaAvailability(snapshot, quotaProvider) !== "free") continue;

      quotaFreedEarly = true;
      console.log(
        `[auto-retry] Project ${project.id} unparked early: ${quotaProvider} quota window is free, provider-declared retryAt was ${retryAt.toISOString()}`,
      );
    }

    await prisma.$transaction(async (tx) => {
      const row = await requirePrimaryComponentRow(tx, project.id);

      await applyStateChange(
        tx,
        project.id,
        { type: "removeBlocker", blocker: retryableBlocker },
        { ...cronCtx, reason: quotaFreedEarly ? "auto_retry_quota_window_free" : "auto_retry" },
      );

      await updateComponentMetadata(tx, project.id, {
        retryCount: retryCount + 1,
        retryAt: null,
      }, {
        ...cronCtx,
        reason: row.runtimeState === "RUNNING"
          ? "auto_retry_supervisor_resume"
          : "auto_retry_resume_claimable",
      });
    });

    retried.push(project.id);
  }

  if (retried.length > 0) {
    revalidatePath("/");
    revalidatePath("/admin");

    console.log(`[auto-retry] Retried ${retried.length} projects: ${retried.join(", ")}`);
  }

  return NextResponse.json({ retried: retried.length });
}

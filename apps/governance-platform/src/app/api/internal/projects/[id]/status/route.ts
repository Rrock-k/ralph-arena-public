import { NextResponse } from "next/server";
import { acceptedSpecArtifactRequiresLoopWork, parseAcceptedSpecArtifact } from "@arena/contracts";
import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import {
  buildRunAuthSnapshot,
  buildRunAuthSnapshotFresh,
  narrowRunAuthModesForAgent,
  RuntimeAuthUnavailableError,
  type RunAuthSnapshot,
} from "@/lib/run-auth";
import { getPrimaryComponentRow, updateComponentMetadata, type PrimaryComponentRow } from "@/lib/project-state-effects";
import { getExpectedRunnerVersion } from "@/lib/control-plane";
import { getRunnerStopReason } from "@/lib/project-lifecycle";
import { userProviderCredentialOwnerId } from "@/lib/user-provider-credentials";
import {
  buildProviderProxyAuthEnv,
  resolveApiProxyUrlForBackend,
} from "@/lib/provider-proxy-auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function shouldRefreshResidentRunnerHeartbeat(input: {
  shouldStop: boolean;
  reason?: string;
  state: string | null;
  component: PrimaryComponentRow | null;
}): boolean {
  if (input.state === "verification") return false;
  if (!input.shouldStop) return true;
  if (!input.component) return false;
  if (input.component.runtimeState !== "RUNNING") return false;
  if (input.state !== "idle" && input.state !== "paused") return false;

  switch (input.reason) {
    case "power_off":
    case "status_archived":
    case "not_found":
    case "no_component":
    case "stale_runtime_identity":
      return false;
    default:
      return true;
  }
}

function getPendingLoopWork(
  component: PrimaryComponentRow,
  hasPendingAcceptedInputWork: boolean,
): boolean {
  if (component.powerIntent !== "ON") return false;
  if (component.agentIntent !== "ON") return false;
  if (component.runtimeState !== "RUNNING") return false;
  if (component.agentState === "RUNNING") return false;
  if (component.blockers.length > 0) return false;
  if (component.lastOutcomeAt) return hasPendingAcceptedInputWork;
  return component.lastOutcome == null;
}

type PendingWorkSpec = {
  updatedAt: Date | string | null;
  versions?: Array<{
    updatedAt: Date | string | null;
    acceptedArtifact: unknown;
  }>;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function specInputUpdatedAt(spec: PendingWorkSpec): Date | null {
  const specUpdatedAt = toDate(spec.updatedAt);
  const versionUpdatedAt = toDate(spec.versions?.[0]?.updatedAt);
  if (!specUpdatedAt) return versionUpdatedAt;
  if (!versionUpdatedAt) return specUpdatedAt;
  return versionUpdatedAt.getTime() > specUpdatedAt.getTime()
    ? versionUpdatedAt
    : specUpdatedAt;
}

function specRequiresLoopWork(latestSpec: PendingWorkSpec): boolean {
  const acceptedArtifact = latestSpec.versions?.[0]?.acceptedArtifact;
  if (!acceptedArtifact) return true;
  return acceptedSpecArtifactRequiresLoopWork(parseAcceptedSpecArtifact(acceptedArtifact));
}

function hasPendingAcceptedInputWork(
  component: PrimaryComponentRow,
  specs: PendingWorkSpec[],
): boolean {
  if (!component.lastOutcomeAt) return component.lastOutcome == null;
  return specs.some((spec) => {
    const updatedAt = specInputUpdatedAt(spec);
    return !!updatedAt
      && updatedAt.getTime() > component.lastOutcomeAt!.getTime()
      && specRequiresLoopWork(spec);
  });
}

function shouldResolvePendingLoopWork(component: PrimaryComponentRow | null): component is PrimaryComponentRow {
  if (!component) return false;
  if (component.powerIntent !== "ON") return false;
  if (component.agentIntent !== "ON") return false;
  if (component.runtimeState !== "RUNNING") return false;
  if (component.agentState === "RUNNING") return false;
  if (component.blockers.length > 0) return false;
  return true;
}

function getStatusObservedComponent(
  component: PrimaryComponentRow,
  runnerState: string | null,
): PrimaryComponentRow {
  // A resident preview runner polling as `idle` is the authoritative writer for
  // loop activity. Do not let a stale DB RUNNING bit hide pending loop work.
  if (runnerState === "idle" && component.runtimeState === "RUNNING" && component.agentState !== "IDLE") {
    return { ...component, agentState: "IDLE" };
  }
  return component;
}

function shouldBuildPassiveRunAuthSnapshot(input: {
  refreshAuth: boolean;
  shouldStop: boolean;
  state: string | null;
  component: PrimaryComponentRow | null;
}): boolean {
  if (input.refreshAuth) return true;
  if (input.shouldStop) return false;
  if (!input.component) return true;
  if (input.component.runtimeState !== "RUNNING") return true;
  if (input.component.agentState !== "IDLE") return true;
  if (input.state === "idle" || input.state === "paused") {
    return false;
  }
  return true;
}

/**
 * GET /api/internal/projects/:id/status
 *
 * RA-098: Runner polls this every 10s to check for stop/archive signals.
 * RA-237: Uses new component model (powerIntent, runtimeState, agentState, blockers).
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  const refreshAuth = searchParams.get("refreshAuth") === "1";
  const runnerVersion = searchParams.get("runnerVersion");
  const now = new Date();

  const resolved = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      agent: true,
      claudeAuthMode: true,
      codexAuthMode: true,
      ownerScopeType: true,
      ownerScopeId: true,
      providerBillingMode: true,
      runnerBackend: true,
    },
  });

  if (!resolved) {
    return NextResponse.json({ shouldStop: true, reason: "not_found" });
  }

  const primaryComponent = await getPrimaryComponentRow(prisma, id).catch(() => null);

  let shouldStop = false;
  let reason: string | undefined;

  if (primaryComponent) {
    const stopReason = getRunnerStopReason(primaryComponent);
    if (stopReason) {
      shouldStop = true;
      reason = stopReason;
    }
  } else {
    // No component = legacy or broken project — stop it
    shouldStop = true;
    reason = "no_component";
  }

  if (!shouldStop && resolved.providerBillingMode === "platform_credits") {
    const budget = await prisma.projectBudget.findUnique({
      where: { projectId: id },
      select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
    });

    if (!budget?.isEnabled || budget.usedCreditsUsd >= budget.totalCreditsUsd) {
      shouldStop = true;
      reason = "budget_exhausted";
    }
  }

  const statusObservedComponent = primaryComponent
    ? getStatusObservedComponent(primaryComponent, state)
    : null;
  const pendingLoopWorkComponent = !shouldStop && shouldResolvePendingLoopWork(statusObservedComponent)
    ? statusObservedComponent
    : null;
  const latestSpecs = pendingLoopWorkComponent
    ? await prisma.spec.findMany({
        where: { projectId: id },
        orderBy: { orderIndex: "asc" },
        select: {
          updatedAt: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { updatedAt: true, acceptedArtifact: true },
          },
        },
      })
    : [];
  const pendingLoopWork = pendingLoopWorkComponent
    ? getPendingLoopWork(
        pendingLoopWorkComponent,
        hasPendingAcceptedInputWork(pendingLoopWorkComponent, latestSpecs),
      )
    : false;

  // Refresh heartbeat only for runners that are still authoritative for this component.
  if (shouldRefreshResidentRunnerHeartbeat({
    shouldStop,
    reason,
    state,
    component: primaryComponent,
  })) {
    await updateComponentMetadata(prisma, id, { lastHeartbeat: now }, {
      source: "runner",
      trigger: "heartbeat",
    }).catch(() => null);
  }

  let authSnapshot: RunAuthSnapshot | null = null;
  const shouldBuildAuthSnapshot = shouldBuildPassiveRunAuthSnapshot({
    refreshAuth,
    shouldStop,
    state,
    component: primaryComponent,
  });
  if (shouldBuildAuthSnapshot) {
    try {
      const authModes = narrowRunAuthModesForAgent(resolved.agent, {
        claudeAuthMode: resolved.claudeAuthMode,
        codexAuthMode: resolved.codexAuthMode,
      });
      if (resolved.providerBillingMode === "platform_credits") {
        authSnapshot = {
          auth: buildProviderProxyAuthEnv({
            projectId: resolved.id,
            agent: resolved.agent,
            apiProxyUrl: resolveApiProxyUrlForBackend(resolved.runnerBackend),
          }),
        };
      } else {
        authSnapshot = await (refreshAuth ? buildRunAuthSnapshotFresh : buildRunAuthSnapshot)({
          claudeAuthMode: authModes.claudeAuthMode,
          codexAuthMode: authModes.codexAuthMode,
        }, {
          agent: resolved.agent,
          userId: resolved.providerBillingMode === "byok"
            ? userProviderCredentialOwnerId(resolved.ownerScopeType, resolved.ownerScopeId)
            : null,
        });
      }
    } catch (error) {
      if (error instanceof RuntimeAuthUnavailableError) {
        if (refreshAuth) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.warn(`[status] auth snapshot unavailable for ${id}: ${error.message}`);
        authSnapshot = null;
      } else {
        throw error;
      }
    }
  }

  // RA-247: Soft version check — runner reports version, governance flags mismatch
  let runnerOutdated: boolean | undefined;
  if (runnerVersion && runnerVersion !== "unknown") {
    const expected = getExpectedRunnerVersion();
    if (expected && !runnerVersion.startsWith(expected) && !expected.startsWith(runnerVersion)) {
      runnerOutdated = true;
    }
  }

  return NextResponse.json({
    shouldStop,
    reason,
    ...(primaryComponent ? { agentIntent: primaryComponent.agentIntent } : {}),
    ...(!shouldStop && pendingLoopWork ? { pendingLoopWork: true } : {}),
    ...(authSnapshot ? { auth: authSnapshot.auth, authVersion: authSnapshot.version } : {}),
    ...(runnerOutdated ? { runnerOutdated } : {}),
  });
}

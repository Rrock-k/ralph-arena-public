import type { RuntimeIntentAction, RuntimeIntentRunnerMode } from "@arena/contracts";
import {
  prepareRuntimeLaunchDryRun,
  type AgentRunLaunchDryRunResult,
} from "@/lib/agent-run-launch";
import {
  getRuntimeIntentAttempt,
  listRuntimeIntentClaimCandidates,
  normalizeActivePreviewContainers,
  resolveRuntimeIntentCandidateDecision,
  type RuntimeIntentCandidateRow,
} from "@/lib/runtime-intent-claim-projection";
import type { RuntimeIntentPolicyRejectionReason } from "@/lib/runtime-intents";
import { prisma } from "@/lib/prisma";

export const RUNTIME_INTENT_CLAIM_DRY_RUN_SCHEMA_VERSION = "ra-356.runtime-claim-dry-run.v1" as const;

export type RuntimeIntentClaimDryRun = {
  schemaVersion: typeof RUNTIME_INTENT_CLAIM_DRY_RUN_SCHEMA_VERSION;
  projectId: string;
  host: string;
  backend: "local" | "vps";
  capacity: number;
  activePreviewContainersSupplied: boolean;
  evaluatedAt: string;
  candidate: null | {
    componentId: string;
    runtimeMissingFromWorker: boolean;
    tuple: {
      powerIntent: RuntimeIntentCandidateRow["powerIntent"];
      agentIntent: RuntimeIntentCandidateRow["agentIntent"];
      runtimeState: RuntimeIntentCandidateRow["runtimeState"];
      agentState: RuntimeIntentCandidateRow["agentState"];
      blockers: string[];
      provisionedAt: string | null;
      pendingLoopWork: boolean;
      allowPreviewOnlyRestore: boolean;
      workerHost: string | null;
      containerName: string | null;
    };
    loopSupport: {
      status: string | null;
      agentStartAllowed: boolean | null;
    };
    lastIntent: {
      action: RuntimeIntentAction | null;
      state: RuntimeIntentCandidateRow["lastState"];
      attempt: number | null;
    };
  };
  policyDecision: null | {
    action: RuntimeIntentAction;
    runnerMode: RuntimeIntentRunnerMode;
    attempt: number;
    workspaceLabel: string;
    preferredContainerName: string;
  };
  policyRejectionReasons: RuntimeIntentPolicyRejectionReason[];
  wouldCreateLease: boolean;
  wouldClaim: null | {
    action: RuntimeIntentAction;
    runnerMode: RuntimeIntentRunnerMode;
    attempt: number;
    containerName: string | null;
    workspaceLabel: string;
    workerImage: string | null;
    resources?: { memoryMb?: number; cpuCount?: number };
  };
  launch: {
    required: boolean;
    status: "not_required" | "ready" | "budget_blocked" | "project_missing";
    sanitized: true;
    payload: null | Extract<AgentRunLaunchDryRunResult, { ok: true }>["payload"];
    message: string | null;
  };
  blockingReasons: string[];
  evidenceNotes: string[];
};

export async function buildRuntimeIntentClaimDryRun(input: {
  projectId: string;
  host?: string;
  capacity?: number;
  activePreviewContainers?: string[] | null;
  now?: Date;
}): Promise<RuntimeIntentClaimDryRun> {
  const host = input.host?.trim() || "local";
  const backend = host === "local" ? "local" : "vps";
  const capacity = Math.max(input.capacity ?? 1, 0);
  const activePreviewContainers = normalizeActivePreviewContainers(input.activePreviewContainers);
  const evaluatedAt = (input.now ?? new Date()).toISOString();
  const candidates = await listRuntimeIntentClaimCandidates(prisma, {
    host,
    backend,
    activePreviewContainers,
    projectId: input.projectId,
    lockCandidates: false,
    limit: 1,
  });
  const candidate = candidates[0] ?? null;

  if (!candidate) {
    return baseDryRun({
      projectId: input.projectId,
      host,
      backend,
      capacity,
      activePreviewContainers,
      evaluatedAt,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
      evidenceNotes: [
        "Dry-run used the governance runtime-intent candidate query without locking or creating a lease.",
        "No claim candidate was visible for this project under the supplied worker context.",
      ],
    });
  }

  const resolved = resolveRuntimeIntentCandidateDecision(candidate, {
    host,
    capacity,
    activePreviewContainers,
  });
  const dryRunCandidate = serializeCandidate(candidate);

  if (!resolved.decision) {
    return {
      ...baseDryRun({
        projectId: input.projectId,
        host,
        backend,
        capacity,
        activePreviewContainers,
        evaluatedAt,
        blockingReasons: ["candidate_rejected_by_runtime_intent_policy"],
        evidenceNotes: [
          "Dry-run used the governance runtime-intent candidate query without locking or creating a lease.",
          "Candidate was visible but getClaimableRuntimeIntent returned no action.",
        ],
      }),
      candidate: dryRunCandidate,
      policyRejectionReasons: resolved.policyRejectionReasons,
    };
  }

  const attempt = getRuntimeIntentAttempt(candidate, resolved.decision.action);
  const policyDecision = {
    action: resolved.decision.action,
    runnerMode: resolved.decision.runnerMode,
    attempt,
    workspaceLabel: resolved.workspaceLabel,
    preferredContainerName: resolved.preferredContainerName,
  };

  if (resolved.decision.action !== "ensure_running") {
    return {
      ...baseDryRun({
        projectId: input.projectId,
        host,
        backend,
        capacity,
        activePreviewContainers,
        evaluatedAt,
        evidenceNotes: [
          "Dry-run used the governance runtime-intent candidate query without locking or creating a lease.",
          "No launch envelope is required for stop/remove runtime intents.",
        ],
      }),
      candidate: dryRunCandidate,
      policyDecision,
      policyRejectionReasons: [],
      wouldCreateLease: true,
      wouldClaim: {
        action: resolved.decision.action,
        runnerMode: "preview_only",
        attempt,
        containerName: candidate.containerName,
        workspaceLabel: resolved.workspaceLabel,
        workerImage: null,
      },
      launch: {
        required: false,
        status: "not_required",
        sanitized: true,
        payload: null,
        message: null,
      },
    };
  }

  const project = await prisma.project.findUnique({
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
    return {
      ...baseDryRun({
        projectId: input.projectId,
        host,
        backend,
        capacity,
        activePreviewContainers,
        evaluatedAt,
        blockingReasons: ["project_missing_for_launch_summary"],
        evidenceNotes: [
          "Dry-run used the governance runtime-intent candidate query without locking or creating a lease.",
          "Project disappeared before launch summary could be prepared.",
        ],
      }),
      candidate: dryRunCandidate,
      policyDecision,
      policyRejectionReasons: [],
      launch: {
        required: true,
        status: "project_missing",
        sanitized: true,
        payload: null,
        message: "Project not found while preparing sanitized launch summary.",
      },
    };
  }

  const launchDryRun = prepareRuntimeLaunchDryRun(project as any, backend, resolved.decision.runnerMode);
  if (!launchDryRun.ok) {
    return {
      ...baseDryRun({
        projectId: input.projectId,
        host,
        backend,
        capacity,
        activePreviewContainers,
        evaluatedAt,
        blockingReasons: ["launch_budget_blocked"],
        evidenceNotes: [
          "Dry-run used the governance runtime-intent candidate query without locking or creating a lease.",
          "Sanitized launch summary stopped before auth, secret decryption or env value materialization.",
        ],
      }),
      candidate: dryRunCandidate,
      policyDecision,
      policyRejectionReasons: [],
      launch: {
        required: true,
        status: "budget_blocked",
        sanitized: true,
        payload: null,
        message: launchDryRun.message,
      },
    };
  }

  return {
    ...baseDryRun({
      projectId: input.projectId,
      host,
      backend,
      capacity,
      activePreviewContainers,
      evaluatedAt,
      evidenceNotes: [
        "Dry-run used the governance runtime-intent candidate query without locking or creating a lease.",
        "Sanitized launch summary stopped before auth, secret decryption or env value materialization.",
      ],
    }),
    candidate: dryRunCandidate,
    policyDecision,
    policyRejectionReasons: [],
    wouldCreateLease: true,
    wouldClaim: {
      action: "ensure_running",
      runnerMode: resolved.decision.runnerMode,
      attempt,
      containerName: candidate.containerName,
      workspaceLabel: launchDryRun.payload.workspaceLabel || resolved.workspaceLabel,
      workerImage: launchDryRun.payload.workerImage,
      ...(launchDryRun.payload.resources ? { resources: launchDryRun.payload.resources } : {}),
    },
    launch: {
      required: true,
      status: "ready",
      sanitized: true,
      payload: launchDryRun.payload,
      message: null,
    },
  };
}

function baseDryRun(input: {
  projectId: string;
  host: string;
  backend: "local" | "vps";
  capacity: number;
  activePreviewContainers: string[] | null;
  evaluatedAt: string;
  blockingReasons?: string[];
  evidenceNotes?: string[];
}): RuntimeIntentClaimDryRun {
  return {
    schemaVersion: RUNTIME_INTENT_CLAIM_DRY_RUN_SCHEMA_VERSION,
    projectId: input.projectId,
    host: input.host,
    backend: input.backend,
    capacity: input.capacity,
    activePreviewContainersSupplied: input.activePreviewContainers !== null,
    evaluatedAt: input.evaluatedAt,
    candidate: null,
    policyDecision: null,
    policyRejectionReasons: [],
    wouldCreateLease: false,
    wouldClaim: null,
    launch: {
      required: false,
      status: "not_required",
      sanitized: true,
      payload: null,
      message: null,
    },
    blockingReasons: input.blockingReasons ?? [],
    evidenceNotes: input.evidenceNotes ?? [],
  };
}

function serializeCandidate(candidate: RuntimeIntentCandidateRow): NonNullable<RuntimeIntentClaimDryRun["candidate"]> {
  return {
    componentId: candidate.componentId,
    runtimeMissingFromWorker: candidate.runtimeMissingFromWorker === true,
    tuple: {
      powerIntent: candidate.powerIntent,
      agentIntent: candidate.agentIntent,
      runtimeState: candidate.runtimeState,
      agentState: candidate.agentState,
      blockers: candidate.blockers,
      provisionedAt: candidate.provisionedAt ? candidate.provisionedAt.toISOString() : null,
      pendingLoopWork: candidate.pendingLoopWork,
      allowPreviewOnlyRestore: candidate.allowPreviewOnlyRestore,
      workerHost: candidate.workerHost,
      containerName: candidate.containerName,
    },
    lastIntent: {
      action: candidate.lastAction,
      state: candidate.lastState,
      attempt: candidate.lastAttempt,
    },
    loopSupport: {
      status: candidate.loopSupportStatus ?? null,
      agentStartAllowed: candidate.agentStartAllowed ?? null,
    },
  };
}

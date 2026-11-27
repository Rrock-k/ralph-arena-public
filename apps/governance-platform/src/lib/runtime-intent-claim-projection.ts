import type {
  RuntimeIntentAction,
  RuntimeIntentRunnerMode,
} from "@arena/contracts";
import { buildProjectWorkspaceLabel } from "@/lib/project-identity";
import { resolveLoopSupport, runtimeConfigUsesRepoHead } from "@/lib/loop-support";
import {
  evaluateRuntimeIntentClaimability,
  type RuntimeIntentPolicyRejectionReason,
  type RuntimeIntentCandidate as ClaimDecisionCandidate,
} from "@/lib/runtime-intents";

export const RUNTIME_INTENT_MAX_ATTEMPTS = 5;
export const RUNTIME_INTENT_LEASE_MS = 90_000;

type RuntimeIntentLeaseState = "SUCCEEDED" | "FAILED" | "CLAIMED" | "ABANDONED" | null;

export type RuntimeIntentCandidateRow = ClaimDecisionCandidate & {
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  proposalId: string | null;
  proposalTitle: string | null;
  agentImpl: string | null;
  runtimeConfig: unknown;
  loopName: string | null;
  loopVersion: string | null;
  loopSupportTier: string | null;
  loopSupportStatus?: string | null;
  agentStartAllowed?: boolean | null;
  componentId: string;
  runtimeMissingFromWorker?: boolean | null;
  lastAction: RuntimeIntentAction | null;
  lastState: RuntimeIntentLeaseState;
};

type RuntimeIntentCandidateQueryTx = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

export function normalizeActivePreviewContainers(activePreviewContainers: string[] | null | undefined): string[] | null {
  if (!activePreviewContainers) return null;
  return activePreviewContainers.map((name) => name.trim()).filter(Boolean);
}

export async function listRuntimeIntentClaimCandidates(
  tx: RuntimeIntentCandidateQueryTx,
  input: {
    host: string;
    backend: "local" | "vps";
    activePreviewContainers: string[] | null;
    projectId?: string | null;
    lockCandidates: boolean;
    limit?: number;
  },
): Promise<RuntimeIntentCandidateRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const lockClause = input.lockCandidates ? "FOR UPDATE OF p SKIP LOCKED" : "";

  const rows = await tx.$queryRawUnsafe<RuntimeIntentCandidateRow[]>(
    `SELECT p.id AS "projectId",
            p.name AS "projectName",
            p.slug AS "projectSlug",
            p."proposalId" AS "proposalId",
            pr.title AS "proposalTitle",
            p."agentImpl" AS "agentImpl",
            pc."runtimeConfig" AS "runtimeConfig",
            al.name AS "loopName",
            alv.version AS "loopVersion",
            alv."supportTier" AS "loopSupportTier",
            pc.id AS "componentId",
            pc."powerIntent" AS "powerIntent",
            pc."agentIntent" AS "agentIntent",
            pc."runtimeState" AS "runtimeState",
            pc."agentState" AS "agentState",
            CASE
              WHEN $3::text[] IS NOT NULL
               AND pc."runtimeState" = 'RUNNING'
               AND pc."containerName" IS NOT NULL
               AND pc."containerName" <> ''
               AND NOT (pc."containerName" = ANY($3::text[]))
                THEN TRUE
              ELSE FALSE
            END AS "runtimeMissingFromWorker",
            pc."provisionedAt" AS "provisionedAt",
            CASE
              WHEN pc."agentIntent" <> 'ON' THEN FALSE
              WHEN pc."lastOutcome" IS NULL THEN TRUE
              WHEN pc."lastOutcome" = 'FAILED'
               AND COALESCE(spec_state."hasPendingAcceptedInputWork", FALSE)
                THEN TRUE
              WHEN pc."lastOutcome" = 'COMPLETED'
               AND COALESCE(spec_state."hasPendingAcceptedInputWork", FALSE)
                THEN TRUE
              ELSE FALSE
            END AS "pendingLoopWork",
            CASE
              WHEN pc."agentIntent" = 'ON'
               AND pc."lastOutcome" IN ('COMPLETED', 'FAILED')
               AND NOT (
                 COALESCE(spec_state."hasPendingAcceptedInputWork", FALSE)
               )
                THEN TRUE
              ELSE FALSE
            END AS "allowPreviewOnlyRestore",
            pc."blockers" AS "blockers",
            pc."workerHost" AS "workerHost",
            pc."containerName" AS "containerName",
            pc."sourceConfig" AS "sourceConfig",
            p."tgSpecLastImportedVersion" AS "tgSpecLastImportedVersion",
            last_ri.action AS "lastAction",
            last_ri.state AS "lastState",
            last_ri.attempt AS "lastAttempt"
     FROM "Project" p
     JOIN LATERAL (
       SELECT id,
              "powerIntent",
              "agentIntent",
              "runtimeState",
              "agentState",
              "provisionedAt",
              "lastOutcome",
              "lastOutcomeAt",
              "blockers",
              "workerHost",
              "containerName",
              "sourceConfig",
              "runtimeConfig"
       FROM "ProjectComponent"
       WHERE "projectId" = p.id
         AND kind = 'app'
       ORDER BY "createdAt" ASC
       LIMIT 1
     ) pc ON TRUE
     LEFT JOIN "Proposal" pr ON pr.id = p."proposalId"
     LEFT JOIN "AgentLoopVersion" alv ON alv.id = p."agentLoopVersionId"
     LEFT JOIN "AgentLoop" al ON al.id = alv."agentLoopId"
     LEFT JOIN LATERAL (
       SELECT EXISTS (
         SELECT 1
         FROM "Spec" s
         LEFT JOIN LATERAL (
           SELECT MAX(sv."updatedAt") AS "latestUpdatedAt"
           FROM "SpecVersion" sv
           WHERE sv."specId" = s.id
         ) version_clock ON TRUE
         WHERE s."projectId" = p.id
           AND GREATEST(s."updatedAt", COALESCE(version_clock."latestUpdatedAt", s."updatedAt")) > pc."lastOutcomeAt"
           AND (
             NOT EXISTS (
               SELECT 1
               FROM "SpecVersion" any_version
               WHERE any_version."specId" = s.id
             )
             OR EXISTS (
               SELECT 1
               FROM "SpecVersion" pending_version
               WHERE pending_version."specId" = s.id
                 AND pending_version."updatedAt" > pc."lastOutcomeAt"
                 AND (
                   pending_version."acceptedArtifact" IS NULL
                   OR EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(
                       COALESCE(pending_version."acceptedArtifact"->'acceptedDiff'->'items', '[]'::jsonb)
                     ) AS diff_item
                     WHERE diff_item->>'workImpact' = 'requires_loop_work'
                   )
                 )
             )
           )
       ) AS "hasPendingAcceptedInputWork"
     ) spec_state ON TRUE
     LEFT JOIN LATERAL (
       SELECT id, action, state, attempt
       FROM "RuntimeIntent"
       WHERE "componentId" = pc.id
       ORDER BY "createdAt" DESC
       LIMIT 1
     ) last_ri ON TRUE
     WHERE p."runnerBackend" = $2
       AND ($4::text IS NULL OR p.id = $4::text)
       AND (
         -- stop: power OFF but container still running
         (
           pc."powerIntent" = 'OFF'
           AND pc."runtimeState" = 'RUNNING'
           AND pc."containerName" IS NOT NULL
           AND pc."containerName" <> ''
         )
         -- start: power ON but container not running; runtime-intents own both parked
         -- preview restore and unfinished/provisioned agent bootstrap
         OR (
           p."archivedAt" IS NULL
           AND pc."powerIntent" = 'ON'
           AND (
             pc."runtimeState" IN ('ABSENT', 'STOPPED')
             OR (
               $3::text[] IS NOT NULL
               AND pc."runtimeState" = 'RUNNING'
               AND pc."containerName" IS NOT NULL
               AND pc."containerName" <> ''
               AND NOT (pc."containerName" = ANY($3::text[]))
             )
           )
           AND (
             pc."agentIntent" = 'OFF'
             OR COALESCE(cardinality(pc."blockers"), 0) > 0
             OR (
               pc."agentIntent" = 'ON'
               AND COALESCE(pc."agentState", 'IDLE') = 'IDLE'
               AND (
                 pc."provisionedAt" IS NOT NULL
                 OR pc."runtimeState" = 'STOPPED'
               )
             )
             OR (
               pc."agentIntent" = 'ON'
               AND $3::text[] IS NOT NULL
               AND pc."runtimeState" = 'RUNNING'
               AND pc."containerName" IS NOT NULL
               AND pc."containerName" <> ''
               AND NOT (pc."containerName" = ANY($3::text[]))
             )
           )
         )
       )
       AND (pc."workerHost" IS NULL OR pc."workerHost" = $1)
       AND NOT EXISTS (
         SELECT 1
         FROM "RuntimeIntent" active_ri
         WHERE active_ri."componentId" = pc.id
           AND active_ri.state = 'CLAIMED'
           AND (active_ri."lockedUntil" IS NULL OR active_ri."lockedUntil" > NOW())
       )
     ORDER BY CASE
       WHEN pc."powerIntent" = 'OFF' THEN 0
       WHEN p."archivedAt" IS NULL
        AND pc."powerIntent" = 'ON'
        AND pc."agentIntent" = 'ON'
        AND COALESCE(cardinality(pc."blockers"), 0) = 0
        AND (
          pc."lastOutcome" IS NULL
          OR (
            pc."lastOutcome" IN ('COMPLETED', 'FAILED')
            AND COALESCE(spec_state."hasPendingAcceptedInputWork", FALSE)
          )
        )
        AND (
          pc."runtimeState" IN ('ABSENT', 'STOPPED')
          OR (
            $3::text[] IS NOT NULL
            AND pc."runtimeState" = 'RUNNING'
            AND pc."containerName" IS NOT NULL
            AND pc."containerName" <> ''
            AND NOT (pc."containerName" = ANY($3::text[]))
          )
        )
         THEN 1
       ELSE 2
     END,
     p."createdAt" ASC
     LIMIT ${limit}
     ${lockClause}`,
    input.host,
    input.backend,
    input.activePreviewContainers,
    input.projectId ?? null,
  );

  return rows.map(withLoopSupportProjection);
}

function withLoopSupportProjection(row: RuntimeIntentCandidateRow): RuntimeIntentCandidateRow {
  const support = resolveLoopSupport({
    agentImpl: row.agentImpl,
    loopName: row.loopName,
    loopVersion: row.loopVersion,
    supportTier: row.loopSupportTier,
    useRepoHead: runtimeConfigUsesRepoHead(row.runtimeConfig),
    hasLoopVersion: Boolean(row.loopVersion),
  });

  return {
    ...row,
    loopSupportStatus: support.supportStatus,
    agentStartAllowed: support.agentStartAllowed,
  };
}

export function resolveRuntimeIntentCandidateDecision(
  candidate: RuntimeIntentCandidateRow,
  input: {
    host: string;
    capacity: number;
    activePreviewContainers: string[] | null;
    maxAttempts?: number;
  },
): {
  candidate: RuntimeIntentCandidateRow;
  effectiveCandidate: RuntimeIntentCandidateRow;
  decision: { action: RuntimeIntentAction; runnerMode: RuntimeIntentRunnerMode } | null;
  policyRejectionReasons: RuntimeIntentPolicyRejectionReason[];
  workspaceLabel: string;
  preferredContainerName: string;
} {
  const workspaceLabel = buildProjectWorkspaceLabel({
    id: candidate.projectId,
    name: candidate.projectName,
    slug: candidate.projectSlug,
    proposalId: candidate.proposalId,
    proposal: candidate.proposalTitle ? { title: candidate.proposalTitle } : null,
  });
  const preferredContainerName = candidate.containerName || `preview-${workspaceLabel}`;
  const activePreviewContainerSet = new Set(input.activePreviewContainers ?? []);
  const effectiveCandidate = candidate.runtimeMissingFromWorker
    ? {
      ...candidate,
      runtimeState: "STOPPED" as const,
      agentState: candidate.agentState === "RUNNING" ? "IDLE" as const : candidate.agentState,
    }
    : candidate;
  const evaluation = evaluateRuntimeIntentClaimability(effectiveCandidate, {
    host: input.host,
    capacity: input.capacity,
    maxAttempts: input.maxAttempts ?? RUNTIME_INTENT_MAX_ATTEMPTS,
    canReplaceExistingRuntime: activePreviewContainerSet.has(preferredContainerName),
  });

  return {
    candidate,
    effectiveCandidate,
    decision: evaluation.decision,
    policyRejectionReasons: evaluation.rejectionReasons,
    workspaceLabel,
    preferredContainerName,
  };
}

export function getRuntimeIntentAttempt(candidate: RuntimeIntentCandidateRow, action: RuntimeIntentAction): number {
  const reusesFailedAttempt =
    candidate.lastState === "FAILED"
    && candidate.lastAction === action
    && (
      action === "ensure_running"
      || action === "ensure_stopped"
      || action === "ensure_removed"
    );

  return reusesFailedAttempt
    ? (candidate.lastAttempt ?? 0) + 1
    : 1;
}

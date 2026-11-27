import type { FeedbackEvidence, ProjectConfig, Task, TaskProofExpectation, VerificationResult } from '../config/types.js';

export const CONCRETE_CLOSURE_EVIDENCE_KINDS: FeedbackEvidence['kind'][] = [
  'test',
  'unit_test',
  'integration_test',
  'post_deploy_smoke',
  'screenshot',
  'vision_qa',
  'manual_note',
  'code_inspection',
];

const CONCRETE_CLOSURE_KINDS = new Set<FeedbackEvidence['kind']>(CONCRETE_CLOSURE_EVIDENCE_KINDS);

export function buildTaskProofExpectations(
  _projectConfig: Pick<ProjectConfig, 'techStack'>,
  _task: Pick<Task, 'feedbackItemRefs' | 'requiredRolePasses'>,
): TaskProofExpectation[] {
  // Screenshot proof review is intentionally disabled until the workflow is redesigned.
  return [];
}

export function collectTaskVerificationEvidence(
  task: Task,
  verificationResult: VerificationResult,
  observedAt = new Date().toISOString(),
): FeedbackEvidence[] {
  const feedbackItemIds = unique((task.feedbackItemRefs ?? []).map((ref) => ref.itemId));
  if (feedbackItemIds.length === 0) return [];

  const evidence: FeedbackEvidence[] = [];

  const unitTests = verificationResult.unitTests;
  if (unitTests) {
    if (unitTests.total > 0) {
      evidence.push({
        kind: 'unit_test',
        ref: 'verification:unit-tests',
        result: unitTests.passed ? 'pass' : 'fail',
        feedbackItemIds,
        taskId: task.id,
        observedAt,
        summary: `Unit tests ${unitTests.passed ? 'passed' : 'failed'} (${unitTests.passed_count}/${unitTests.total}).`,
        recordedBy: 'executor',
      });
    }

    for (const hint of unitTests.evidenceHints ?? []) {
      evidence.push({
        kind: hint.kind,
        ref: hint.ref,
        result: unitTests.passed ? 'pass' : 'fail',
        feedbackItemIds,
        taskId: task.id,
        observedAt,
        summary: hint.summary,
        command: hint.command,
        artifactPath: hint.artifactPath,
        artifactSha256: hint.artifactSha256,
        recordedBy: 'executor',
        screenshotProof: hint.screenshotProof,
        target: hint.target,
      });
    }
  }

  if (verificationResult.integrationTests && verificationResult.integrationTests.total > 0) {
    evidence.push({
      kind: 'integration_test',
      ref: 'verification:integration-tests',
      result: verificationResult.integrationTests.passed ? 'pass' : 'fail',
      feedbackItemIds,
      taskId: task.id,
      observedAt,
      summary: `Integration tests ${verificationResult.integrationTests.passed ? 'passed' : 'failed'} (${verificationResult.integrationTests.passed_count}/${verificationResult.integrationTests.total}).`,
      recordedBy: 'executor',
    });
  }

  if (verificationResult.postDeploy && !verificationResult.postDeploy.infraUnavailable) {
    evidence.push({
      kind: 'post_deploy_smoke',
      ref: 'verification:post-deploy',
      result: verificationResult.postDeploy.passed ? 'pass' : 'fail',
      feedbackItemIds,
      taskId: task.id,
      observedAt,
      summary: verificationResult.postDeploy.summary,
      artifactPath: verificationResult.postDeploy.screenshotDir ?? undefined,
      recordedBy: 'executor',
    });
  }

  return evidence;
}

export function mergeFeedbackEvidence(
  existing: FeedbackEvidence[] = [],
  incoming: FeedbackEvidence[] = [],
): FeedbackEvidence[] {
  const merged = [...existing];
  const seen = new Set(existing.map(feedbackEvidenceKey));
  for (const evidence of incoming) {
    const key = feedbackEvidenceKey(evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(evidence);
  }
  return merged;
}

export function hasPositiveFeedbackEvidenceForItem(
  itemId: string,
  evidence: FeedbackEvidence[] = [],
  options: { allowImplicitItemLink?: boolean } = {},
): boolean {
  return evidence.some((row) => isPositiveFeedbackEvidenceForItem(itemId, row, options));
}

export function isPositiveFeedbackEvidenceForItem(
  itemId: string,
  evidence: FeedbackEvidence,
  options: { allowImplicitItemLink?: boolean } = {},
): boolean {
  if (!CONCRETE_CLOSURE_KINDS.has(evidence.kind)) return false;
  if (evidence.result === 'fail' || evidence.result === 'inconclusive') return false;

  const itemIds = evidence.feedbackItemIds ?? [];
  if (itemIds.length > 0) return itemIds.includes(itemId);

  return options.allowImplicitItemLink === true;
}

function feedbackEvidenceKey(evidence: FeedbackEvidence): string {
  return [
    evidence.kind,
    evidence.ref,
    evidence.taskId ?? '',
    evidence.result ?? '',
    [...(evidence.feedbackItemIds ?? [])].sort().join(','),
    evidence.summary,
  ].join('|');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export type WorkerParityEnvironment = "local" | "vps";

export type WorkerParityInput = {
  environment: WorkerParityEnvironment;
  expectedCommitSha: string | null;
  expectedWorkerImage: string | null;
  workerMeta: any;
};

type WorkerParityLike = {
  status?: unknown;
  reasons?: unknown;
} | null | undefined;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isActionableWorkerParityReason(reason: string): boolean {
  return reason.startsWith("worker_sha_mismatch:")
    || reason.startsWith("runner_sha_mismatch:")
    || reason.startsWith("worker_image_mismatch:");
}

export function getWorkerParityReasons(parity: WorkerParityLike): string[] {
  return Array.isArray(parity?.reasons)
    ? parity.reasons.filter(isNonEmptyString)
    : [];
}

export function getActionableWorkerParityReasons(parity: WorkerParityLike): string[] {
  return getWorkerParityReasons(parity).filter(isActionableWorkerParityReason);
}

export function hasActionableWorkerParityDrift(parity: WorkerParityLike): boolean {
  return parity?.status === "mismatch"
    && getActionableWorkerParityReasons(parity).length > 0;
}

export function buildWorkerParity(input: WorkerParityInput) {
  const actualWorkerGitSha = typeof input.workerMeta?.worker?.gitSha === "string"
    ? input.workerMeta.worker.gitSha
    : null;
  const actualRunnerGitSha = typeof input.workerMeta?.runner?.gitSha === "string"
    ? input.workerMeta.runner.gitSha
    : null;
  const actualWorkerImage = typeof input.workerMeta?.worker?.image === "string"
    ? input.workerMeta.worker.image
    : null;

  const reasons: string[] = [];
  if (!input.workerMeta) reasons.push("worker_meta_missing");
  if (!input.expectedCommitSha) reasons.push("expected_commit_missing");
  if (!actualWorkerGitSha) reasons.push("worker_git_sha_missing");
  if (!actualRunnerGitSha) reasons.push("runner_git_sha_missing");

  if (
    input.expectedCommitSha
    && actualWorkerGitSha
    && !actualWorkerGitSha.startsWith(input.expectedCommitSha)
  ) {
    reasons.push(`worker_sha_mismatch:${actualWorkerGitSha}`);
  }
  if (
    input.expectedCommitSha
    && actualRunnerGitSha
    && !actualRunnerGitSha.startsWith(input.expectedCommitSha)
  ) {
    reasons.push(`runner_sha_mismatch:${actualRunnerGitSha}`);
  }
  if (
    input.expectedWorkerImage
    && actualWorkerImage
    && input.expectedWorkerImage !== actualWorkerImage
  ) {
    reasons.push(`worker_image_mismatch:${actualWorkerImage}`);
  }

  return {
    environment: input.environment,
    expectedCommitSha: input.expectedCommitSha,
    expectedWorkerImage: input.expectedWorkerImage,
    actualWorkerGitSha,
    actualRunnerGitSha,
    actualWorkerImage,
    status: reasons.length > 0 ? "mismatch" : "clean",
    reasons,
  };
}

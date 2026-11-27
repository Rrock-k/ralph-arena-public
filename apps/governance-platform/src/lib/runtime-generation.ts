type RuntimeGenerationLike = {
  status?: unknown;
  reasons?: unknown;
} | null | undefined;

export type RuntimeGenerationInput = {
  workerMeta: any;
  containerInspect: any;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isActionableRuntimeGenerationReason(reason: string): boolean {
  return reason.startsWith("runtime_runner_version_mismatch:");
}

export function getRuntimeGenerationReasons(parity: RuntimeGenerationLike): string[] {
  return Array.isArray(parity?.reasons)
    ? parity.reasons.filter(isNonEmptyString)
    : [];
}

export function getActionableRuntimeGenerationReasons(parity: RuntimeGenerationLike): string[] {
  return getRuntimeGenerationReasons(parity).filter(isActionableRuntimeGenerationReason);
}

export function hasActionableRuntimeGenerationDrift(parity: RuntimeGenerationLike): boolean {
  return parity?.status === "mismatch"
    && getActionableRuntimeGenerationReasons(parity).length > 0;
}

export function buildRuntimeGeneration(input: RuntimeGenerationInput) {
  const currentRunnerGitSha = typeof input.workerMeta?.runner?.gitSha === "string"
    ? input.workerMeta.runner.gitSha
    : null;
  const actualRuntimeRunnerVersion = typeof input.containerInspect?.runnerVersion === "string"
    ? input.containerInspect.runnerVersion
    : null;

  const reasons: string[] = [];
  if (!currentRunnerGitSha) reasons.push("current_runner_git_sha_missing");
  if (!actualRuntimeRunnerVersion) reasons.push("runtime_runner_version_missing");

  if (
    currentRunnerGitSha
    && actualRuntimeRunnerVersion
    && !actualRuntimeRunnerVersion.startsWith(currentRunnerGitSha)
    && !currentRunnerGitSha.startsWith(actualRuntimeRunnerVersion)
  ) {
    reasons.push(`runtime_runner_version_mismatch:${actualRuntimeRunnerVersion}`);
  }

  return {
    currentRunnerGitSha,
    actualRuntimeRunnerVersion,
    status: reasons.length > 0 ? "mismatch" : "clean",
    reasons,
  };
}

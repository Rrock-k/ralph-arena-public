export type RecoveryCohort =
  | "healthy"
  | "parked"
  | "needs_recovery"
  | "garbage";

export type RecoverySuggestedAction =
  | "none"
  | "preview_restore"
  | "recreate_runtime";

export type RecoveryPreviewReachabilityClassification =
  | "reachable"
  | "auth_gated"
  | "down"
  | "unreachable";

export type RecoveryExecutableAction = Exclude<RecoverySuggestedAction, "none">;

export type RecoveryAttemptInput = {
  projectId: string;
  action: RecoveryExecutableAction;
};

export type RecoverySnapshot = {
  archivedAt: string | null;
  component: {
    id: string | null;
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
    blockers: string[];
    lastOutcome: string | null;
    retryAt: string | null;
    retryCount: number | null;
    provisionedAt: string | null;
    previewHealth: string | null;
    previewUrl: string | null;
    containerName: string | null;
    workerHost: string | null;
  };
  worker: {
    workerUrl: string | null;
    inspectStatus: "running" | "stopped" | "not_found" | "missing_worker" | "error";
    parityStatus: "clean" | "mismatch" | null;
    parityReasons: string[];
    actionableParityReasons: string[];
    runtimeGenerationStatus: "clean" | "mismatch" | null;
    runtimeGenerationReasons: string[];
    actionableRuntimeGenerationReasons: string[];
  };
  previewReachability: {
    classification: RecoveryPreviewReachabilityClassification;
    status: number | null;
  };
};

export type RecoveryDiagnosis = {
  cohort: RecoveryCohort;
  mismatches: string[];
  suggestedAction: RecoverySuggestedAction;
};

export type RecoveryAttemptRecord = {
  executed: boolean;
  executedSteps: string[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
};

export type RecoveryAttemptResult = {
  projectId: string;
  input: RecoveryAttemptInput;
  diagnosis: RecoveryDiagnosis;
  snapshotBefore: RecoverySnapshot;
  attempt: RecoveryAttemptRecord;
  snapshotAfter: RecoverySnapshot;
};

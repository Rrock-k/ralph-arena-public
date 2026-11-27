import { z } from 'zod';

// ─── Agent types ───────────────────────────────────────────────

export const AgentType = z.enum(['claude-code', 'codex', 'antigravity', 'opencode']);
export type AgentType = z.infer<typeof AgentType>;

// ─── Loop state ────────────────────────────────────────────────

export const LoopState = z.enum([
  'initializing',
  'planning',
  'context_building', 
  'coding',
  'verification',
  'committing',
  'pushing',
  'waiting_deploy',
  'deploy_verification',
  'controlling',
  'recovery',
  'completed',
  'paused',
  'failed',
  'idle'
]);
export type LoopState = z.infer<typeof LoopState>;

// ─── Verification level ────────────────────────────────────────

export const VerificationLevel = z.enum(['none', 'minimal', 'standard', 'full']);
export type VerificationLevel = z.infer<typeof VerificationLevel>;

// ─── Task status ───────────────────────────────────────────────

export const TaskStatus = z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskIdSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/,
  'Task id must be path-safe: letters, numbers, dot, underscore and dash only',
);
export type TaskId = z.infer<typeof TaskIdSchema>;

export const TaskRolePassSchema = z.enum(['product', 'ux']);
export type TaskRolePass = z.infer<typeof TaskRolePassSchema>;

export const VisualEvidenceModeSchema = z.enum(['off', 'required', 'new_tasks_only']);
export type VisualEvidenceMode = z.infer<typeof VisualEvidenceModeSchema>;

// ─── Phase status ──────────────────────────────────────────────

export const PhaseStatus = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type PhaseStatus = z.infer<typeof PhaseStatus>;

// ─── Feedback evidence (RA-286) ────────────────────────────────
// Execution evidence only: these fields explain how Ralph handled current
// accepted feedback, but do not replace the accepted spec as product truth.

export const FeedbackSourceEvidenceSchema = z.object({
  sourceRef: z.string(),
  quote: z.string().optional(),
  intent: z.string().optional(),
});
export type FeedbackSourceEvidence = z.infer<typeof FeedbackSourceEvidenceSchema>;

export const FeedbackItemRefSchema = z.object({
  itemId: z.string(),
  diffItemId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  changeType: z.string().optional(),
  workImpact: z.string().optional(),
  workSurface: z.string().optional(),
  status: z.string().nullable().optional(),
  summary: z.string().optional(),
  sourceRefs: z.array(z.string()).optional(),
  sourceEvidence: z.array(FeedbackSourceEvidenceSchema).optional(),
  specFile: z.string().optional(),
  specHash: z.string().optional(),
  migrationId: z.string().optional(),
  fingerprint: z.string().optional(),
});
export type FeedbackItemRef = z.infer<typeof FeedbackItemRefSchema>;

export const TaskProofExpectationSchema = z.object({
  kind: z.literal('before_after_screenshot'),
  reason: z.enum([
    'ordinary_web_ui_ux_task',
    'ordinary_web_accepted_frontend_work_task',
  ]),
  source: z.enum([
    'projectConfig.techStack.web+task.requiredRolePasses.ux',
    'projectConfig.techStack.web+task.feedbackItemRefs.workSurface.frontend',
  ]),
});
export type TaskProofExpectation = z.infer<typeof TaskProofExpectationSchema>;

export const ScreenshotProofEvidenceSchema = z.object({
  expectationKind: z.literal('before_after_screenshot'),
  role: z.enum(['before', 'after', 'before_after', 'after_only']),
});
export type ScreenshotProofEvidence = z.infer<typeof ScreenshotProofEvidenceSchema>;

export const ScreenshotProofTargetSchema = z.object({
  route: z.string(),
  viewport: z.object({
    width: z.number().int(),
    height: z.number().int(),
  }).strict(),
  claim: z.string().optional(),
  state: z.string().optional(),
  interaction: z.string().optional(),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).optional(),
}).strict();
export type ScreenshotProofTarget = z.infer<typeof ScreenshotProofTargetSchema>;

export const FeedbackEvidenceSchema = z.object({
  kind: z.enum([
    'test',
    'unit_test',
    'integration_test',
    'post_deploy_smoke',
    'screenshot',
    'video',
    'vision_qa',
    'manual_note',
    'code_inspection',
    'commit',
    'other',
  ]),
  ref: z.string(),
  observedAt: z.string().optional(),
  summary: z.string(),
  result: z.enum(['pass', 'fail', 'inconclusive']).optional(),
  feedbackItemIds: z.array(z.string()).optional(),
  diffItemIds: z.array(z.string()).optional(),
  taskId: z.string().optional(),
  sourceEvidenceRef: z.string().optional(),
  command: z.string().optional(),
  artifactPath: z.string().optional(),
  artifactSha256: z.string().optional(),
  recordedBy: z.enum(['executor', 'controller', 'planner', 'agent', 'manual']).optional(),
  screenshotProof: ScreenshotProofEvidenceSchema.optional(),
  target: ScreenshotProofTargetSchema.optional(),
});
export type FeedbackEvidence = z.infer<typeof FeedbackEvidenceSchema>;

export type VerificationEvidenceHint = Pick<FeedbackEvidence, 'kind' | 'ref' | 'summary'>
  & Partial<Pick<FeedbackEvidence, 'command' | 'artifactPath' | 'artifactSha256' | 'screenshotProof' | 'target'>>;

export const SpecMigrationSourceSchema = z.object({
  kind: z.enum(['accepted_artifact', 'extracted_current_feedback', 'none', 'legacy_bootstrap']).optional(),
  system: z.string().optional(),
  projectId: z.string().optional(),
  version: z.union([z.string(), z.number()]).optional(),
  specVersionId: z.string().optional(),
  specVersion: z.union([z.string(), z.number()]).optional(),
  baseVersion: z.union([z.string(), z.number()]).nullable().optional(),
  acceptedAt: z.string().optional(),
  artifactHash: z.string().optional(),
  itemCount: z.coerce.number().optional(),
  coveredSourceVersions: z.array(z.union([z.string(), z.number()])).optional(),
});
export type SpecMigrationSource = z.infer<typeof SpecMigrationSourceSchema>;

export const SpecMigrationFeedbackItemSchema = z.object({
  itemId: z.string(),
  diffItemId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  kind: z.string(),
  changeType: z.string(),
  workImpact: z.string().optional(),
  workSurface: z.string().optional(),
  status: z.string().nullable().optional(),
  summary: z.string(),
  sourceRefs: z.array(z.string()).optional(),
  sourceEvidence: z.array(FeedbackSourceEvidenceSchema).optional(),
  fingerprint: z.string().optional(),
});
export type SpecMigrationFeedbackItem = z.infer<typeof SpecMigrationFeedbackItemSchema>;

export const SpecFeedbackDispositionSchema = z.object({
  itemId: z.string(),
  feedbackStatus: z.string().nullable().optional(),
  disposition: z.enum([
    'addTask',
    'updateOpenTask',
    'coveredByOpenTask',
    'closedByEvidence',
    'needsJudgment',
    'blocked',
  ]),
  taskIds: z.array(z.string()).optional(),
  relatedCompletedTaskIds: z.array(z.string()).optional(),
  evidence: z.array(FeedbackEvidenceSchema).optional(),
  judgmentIds: z.array(z.string()).optional(),
  reason: z.string(),
});
export type SpecFeedbackDisposition = z.infer<typeof SpecFeedbackDispositionSchema>;

export const FeedbackEvidenceMatrixRowSchema = z.object({
  itemId: z.string(),
  diffItemId: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  changeType: z.string().optional(),
  workImpact: z.string().optional(),
  workSurface: z.string().optional(),
  feedbackStatus: z.string().nullable().optional(),
  summary: z.string().optional(),
  sourceRefs: z.array(z.string()).optional(),
  sourceEvidence: z.array(FeedbackSourceEvidenceSchema).optional(),
  specFile: z.string().optional(),
  specHash: z.string().optional(),
  migrationId: z.string().optional(),
  fingerprint: z.string().optional(),
  status: z.enum([
    'needs_disposition',
    'open_task',
    'implemented_unverified',
    'closed_by_evidence',
    'blocked',
    'needs_judgment',
  ]),
  disposition: z.string().optional(),
  linkedTaskIds: z.array(z.string()).optional(),
  closureAllowed: z.boolean(),
  operatorSummary: z.string(),
});
export type FeedbackEvidenceMatrixRow = z.infer<typeof FeedbackEvidenceMatrixRowSchema>;

// ─── Task schema (extended for plan-based mode) ────────────────

export const TaskSchema = z.object({
  id: TaskIdSchema,
  displayTitle: z.string().trim().min(1).max(80).optional(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  status: TaskStatus.default('pending'),
  attempts: z.coerce.number().default(0),
  lastError: z.string().optional(),
  /** RA-373: heavy detail moved to .ralph/plan-archive.jsonl; stub retained. */
  archivedDetail: z.boolean().optional(),
  // New fields for plan-based mode (optional for backward compat)
  // Priority scale: lower number = higher priority (1 critical, 3 high, 5 medium/default).
  priority: z.coerce.number().optional(),
  dependencies: z.array(z.string()).default([]),
  estimatedComplexity: z.enum(['low', 'medium', 'high']).optional(),
  addedBy: z.enum(['planner', 'controller', 'human', 'qa-planner']).optional(),
  requiredRolePasses: z.array(TaskRolePassSchema).optional(),
  visualEvidenceRequired: z.boolean().optional(),
  feedbackItemRefs: z.array(FeedbackItemRefSchema).optional(),
  verificationEvidence: z.array(FeedbackEvidenceSchema).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ─── Phase schema ──────────────────────────────────────────────

export const PhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  order: z.coerce.number(),
  status: PhaseStatus.default('pending'),
  tasks: z.array(TaskSchema),
  /** When true, this phase has no tasks yet — the planner will expand it
   *  into concrete tasks once all earlier phases are done. */
  planLater: z.boolean().default(false),
});
export type Phase = z.infer<typeof PhaseSchema>;

// ─── Judgment (суждение) ───────────────────────────────────────
// Решение, принятое при неоднозначности или неполноте спека.
// Public assumptions are only spec-gap interpretations; verification gaps stay loop evidence.
// Аналог: Assumptions Log + Decision Log в PM.

export const PublicAssumptionCandidateSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_:\-]{1,119}$/),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(8000),
  sourceRefs: z.array(z.string()).default([]),
}).strict();
export type PublicAssumptionCandidate = z.infer<typeof PublicAssumptionCandidateSchema>;

export const JudgmentSchema = z.object({
  id: z.string(),                    // judgment-001
  timestamp: z.string(),
  phaseId: z.string().nullable().optional(),    // к какой фазе относится
  taskId: z.string().nullable().optional(),     // к какому таску (null если общее)
  ambiguity: z.string(),             // что неясно
  options: z.array(z.string()),      // варианты решения
  chosen: z.coerce.number(),                // индекс выбранного варианта (0-based)
  reasoning: z.string(),             // почему именно это
  madeBy: z.enum(['planner', 'executor', 'controller']),
  revisedBy: z.enum(['controller']).optional(),
  previousChoice: z.number().optional(), // индекс до пересмотра
  publicAssumption: PublicAssumptionCandidateSchema.optional(),
});
export type Judgment = z.infer<typeof JudgmentSchema>;

// ─── Spec migration (incremental specs) ──────────────────────────
// Tracks which spec files/hashes were already applied to the plan.

export const SpecMigrationSchema = z.object({
  id: z.string(),             // spec-001
  specFile: z.string(),       // path to spec file (relative to workDir)
  specHash: z.string(),       // sha256 of spec content at apply time
  appliedAt: z.string(),      // ISO timestamp
  summary: z.string().optional(),
  specChangeSource: SpecMigrationSourceSchema.optional(),
  requiredFeedbackItems: z.array(SpecMigrationFeedbackItemSchema).optional(),
  feedbackDispositions: z.array(SpecFeedbackDispositionSchema).optional(),
  /** RA-373: heavy payload moved to .ralph/plan-archive.jsonl; index row retained. */
  archivedDetail: z.boolean().optional(),
});
export type SpecMigration = z.infer<typeof SpecMigrationSchema>;

// ─── Plan compaction (RA-373) ─────────────────────────────────
// Long-lived plans archive historical detail out of the hot plan.json.
// The feedback ledger keeps the LATEST tracked accepted-feedback item and
// disposition per itemId, so planner fresh-disposition checks and controller
// matrix lookups survive migration payload archiving without scanning history.

export const FeedbackLedgerEntrySchema = z.object({
  itemId: z.string(),
  migrationId: z.string(),
  appliedAt: z.string(),
  item: SpecMigrationFeedbackItemSchema,
  disposition: SpecFeedbackDispositionSchema.optional(),
});
export type FeedbackLedgerEntry = z.infer<typeof FeedbackLedgerEntrySchema>;

export const PlanCompactionStateSchema = z.object({
  lastCompactedAt: z.string(),
  archiveFile: z.string(),
  archivedMigrationDetails: z.coerce.number().default(0),
  archivedJudgments: z.coerce.number().default(0),
  archivedTaskDetails: z.coerce.number().default(0),
  /** Highest numeric judgment id ever archived; keeps judgment-NNN ids monotonic after pruning. */
  judgmentIdWatermark: z.coerce.number().default(0),
});
export type PlanCompactionState = z.infer<typeof PlanCompactionStateSchema>;

// ─── Plan schema ───────────────────────────────────────────────
// Живой документ: фазы + задачи + суждения. Мутируется Planner'ом и Controller'ом.

export const PlanSchema = z.object({
  version: z.number().default(1),
  specFile: z.string(),              // path to spec.md (relative to workDir)
  specHash: z.string().optional(),   // sha256 of spec content (for change detection)
  projectGoal: z.string().optional(), // LLM-generated 2-3 sentence summary of what the project is building
  createdAt: z.string(),
  updatedAt: z.string(),
  phases: z.array(PhaseSchema),
  judgments: z.array(JudgmentSchema).default([]),
  specMigrations: z.array(SpecMigrationSchema).default([]),
  /** Whether Playwright e2e tests are applicable for this project. Decided by controller at startup. */
  e2eApplicable: z.boolean().optional(),
  /** RA-373: latest tracked accepted-feedback item + disposition per itemId. */
  feedbackLedger: z.record(z.string(), FeedbackLedgerEntrySchema).optional(),
  /** RA-373: compaction bookkeeping; present once the plan has been compacted at least once. */
  compaction: PlanCompactionStateSchema.optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

// ─── Controller verdict ────────────────────────────────────────

export const ControllerVerdict = z.enum(['continue', 'revise', 'escalate']);
export type ControllerVerdict = z.infer<typeof ControllerVerdict>;

// ─── Plan change operations (from Controller) ──────────────────

export const PlanChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('addTask'),
    phaseId: z.string(),
    task: TaskSchema,
  }),
  z.object({
    action: z.literal('removeTask'),
    taskId: z.string(),
  }),
  z.object({
    action: z.literal('updateTask'),
    taskId: z.string(),
    changes: z.object({
      displayTitle: z.string().trim().min(1).max(80).optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      priority: z.coerce.number().optional(),
      dependencies: z.array(z.string()).optional(),
      requiredRolePasses: z.array(TaskRolePassSchema).optional(),
      visualEvidenceRequired: z.boolean().optional(),
      status: TaskStatus.optional(),
    }),
  }),
  z.object({
    action: z.literal('addPhase'),
    phase: PhaseSchema,
  }),
  z.object({
    action: z.literal('reorderTasks'),
    phaseId: z.string(),
    taskIds: z.array(z.string()),
  }),
]);
export type PlanChange = z.infer<typeof PlanChangeSchema>;

// ─── Controller report ─────────────────────────────────────────

export const RevisedJudgmentSchema = z.object({
  id: z.string(),
  newChoice: z.number(),
  reasoning: z.string(),
});
export type RevisedJudgment = z.infer<typeof RevisedJudgmentSchema>;

export const ControllerReportSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  trigger: z.enum(['phase_complete', 'periodic', 'failure_threshold', 'replan', 'manual', 'final', 'startup', 'spec_migration']),
  reportType: z.enum(['semantic_audit', 'startup_e2e_enforcer', 'replan_audit']).optional(),
  semanticAudit: z.boolean().optional(),
  verdict: ControllerVerdict,
  summary: z.string(),
  planChanges: z.array(PlanChangeSchema).default([]),
  newJudgments: z.array(JudgmentSchema).default([]),
  revisedJudgments: z.array(RevisedJudgmentSchema).default([]),
  feedbackMatrix: z.array(FeedbackEvidenceMatrixRowSchema).optional(),
  overclaimWarnings: z.array(z.string()).optional(),
});
export type ControllerReport = z.infer<typeof ControllerReportSchema>;

// ─── Project config schema ─────────────────────────────────────

export const ProjectConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  techStack: z.object({
    language: z.string(),
    framework: z.string().optional(),
    runtime: z.string().optional(),
  }),
  repository: z.object({
    url: z.string(),
    branch: z.string().default('main'),
    deployBranch: z.string().default('main'),
  }),
  deploy: z.object({
    enabled: z.boolean().default(true),
    waitForDeploy: z.boolean().default(true),
    healthCheckUrl: z.string().optional(),
    timeoutMinutes: z.number().default(15),
    localDocker: z.object({
      enabled: z.boolean().default(false),
      composeFile: z.string().default('docker-compose.yml'),
      serviceName: z.string().optional(),
    }).optional(),
  }).optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ─── Ralph config schema (extended) ────────────────────────────

export const E2EEnforcerConfigSchema = z.object({
  /** false = default off; true = force on; null = explicitly ask controller once based on project type */
  enabled: z.boolean().nullable().default(false),
});
export type E2EEnforcerConfig = z.infer<typeof E2EEnforcerConfigSchema>;

export const ControllerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  runAfterPhase: z.boolean().default(true),
  runAfterNTasks: z.number().default(5),
  runOnConsecutiveFailures: z.number().default(3),
});
export type ControllerConfig = z.infer<typeof ControllerConfigSchema>;

export const VisionQAConfigSchema = z.object({
  enabled: z.boolean().default(false),
  openaiApiKey: z.string().optional(),
  model: z.string().default('gpt-4o'),
  fps: z.number().default(2),
  maxFramesPerTest: z.number().default(8),
});
export type VisionQAConfig = z.infer<typeof VisionQAConfigSchema>;

export const VisualWorkbenchExecutorCaptureShellConfigSchema = z.object({
  mode: z.enum(['disabled', 'allowlisted']).default('disabled'),
  allowedServeCommands: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  allowedBaseUrlEnv: z.array(z.string().trim().min(1).max(120).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(20).default([]),
}).strict().superRefine((config, ctx) => {
  if (config.mode !== 'allowlisted') return;
  if (config.allowedServeCommands.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowedServeCommands'],
      message: 'Visual Workbench executor capture shell policy requires allowedServeCommands when mode is allowlisted.',
    });
  }
  if (config.allowedBaseUrlEnv.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowedBaseUrlEnv'],
      message: 'Visual Workbench executor capture shell policy requires allowedBaseUrlEnv when mode is allowlisted.',
    });
  }
});
export type VisualWorkbenchExecutorCaptureShellConfig = z.infer<typeof VisualWorkbenchExecutorCaptureShellConfigSchema>;

export const VisualWorkbenchConfigSchema = z.object({
  visualEvidenceMode: VisualEvidenceModeSchema.default('off'),
  executorCaptureShell: VisualWorkbenchExecutorCaptureShellConfigSchema.default({
    mode: 'disabled',
    allowedServeCommands: [],
    allowedBaseUrlEnv: [],
  }),
}).strict().default({
  visualEvidenceMode: 'off',
  executorCaptureShell: {
    mode: 'disabled',
    allowedServeCommands: [],
    allowedBaseUrlEnv: [],
  },
});
export type VisualWorkbenchConfig = z.infer<typeof VisualWorkbenchConfigSchema>;

export const RalphConfigSchema = z.object({
  agent: AgentType.default('claude-code'),
  model: z.string().optional(),
  
  // Planning
  planning: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),

  // Controller
  controller: ControllerConfigSchema.default({
    enabled: true,
    runAfterPhase: true,
    runAfterNTasks: 5,
    runOnConsecutiveFailures: 3,
  }),

  // E2E test enforcer — opt-in; auto-generated e2e tasks are too expensive/noisy for default launches.
  // null remains an explicit legacy/experimental mode where the controller decides once at startup.
  e2eEnforcer: E2EEnforcerConfigSchema.default({ enabled: false }),

  // Vision QA (final e2e video analysis)
  visionQA: VisionQAConfigSchema.default({ enabled: false }),

  // Visual Workbench executor automation gates.
  // Source-owned manifests describe how to run Workbench; Ralph config owns whether executor automation may run it.
  visualWorkbench: VisualWorkbenchConfigSchema,

  verificationLevel: VerificationLevel.default('standard'),
  buildCommand: z.string().optional(),
  buildTimeoutMs: z.number().optional(),
  maxIterations: z.number().optional(), // undefined = unlimited
  maxRetries: z.number().default(3),
  maxDeployRetries: z.number().default(2),
  skipDeployOnFailure: z.boolean().default(true),
  iterationTimeoutMinutes: z.number().default(15),
  // RA-373: keep long-lived plan.json bounded. Compaction archives historical
  // detail (old migration payloads, old judgments, old completed-task detail)
  // into append-only .ralph/plan-archive.jsonl on save once the plan exceeds
  // minPlanChars. Retention values must stay >= the widest prompt projection
  // windows (controller: 12 completed / 20 judgments / 8 migrations).
  planCompaction: z.object({
    enabled: z.boolean().default(true),
    /** Skip compaction entirely while serialized plan is below this size. */
    minPlanChars: z.coerce.number().default(300_000),
    /** Keep full requiredFeedbackItems/feedbackDispositions payload on the most recent N migrations. */
    migrationDetailRetention: z.coerce.number().default(12),
    /** Keep the most recent N judgments in plan.json (full history stays in decisions-log + archive). */
    judgmentRetention: z.coerce.number().default(40),
    /** Keep full detail on the most recent N completed/skipped tasks; older non-feedback tasks become stubs. */
    completedTaskDetailRetention: z.coerce.number().default(30),
  }).default({}),
  completionPromise: z.string().default('TASK_COMPLETE'),
  autoCommit: z.boolean().default(true),
  autoPush: z.boolean().default(true),
  verbose: z.boolean().default(true),
});
export type RalphConfig = z.infer<typeof RalphConfigSchema>;

// Feature schema (for tracking)
export const FeatureSchema = z.object({
  id: z.string(),
  category: z.string(),
  displayTitle: z.string().optional(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']),
  completedAt: z.string().optional(),
  commitHash: z.string().optional(),
  tests: z.array(z.string()).optional(),
  feedbackItemRefs: z.array(FeedbackItemRefSchema).optional(),
  proofExpectations: z.array(TaskProofExpectationSchema).optional(),
  verificationEvidence: z.array(FeedbackEvidenceSchema).optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

// Progress schema
export const ProgressSchema = z.object({
  projectName: z.string(),
  startedAt: z.string(),
  lastUpdated: z.string(),
  totalIterations: z.number(),
  currentState: LoopState,
  metrics: z.object({
    testsPassing: z.number(),
    testsTotal: z.number(),
    coveragePercent: z.number().optional(),
  }),
});
export type Progress = z.infer<typeof ProgressSchema>;

// Verification result
export interface VerificationTestResult {
  passed: boolean;
  total: number;
  passed_count: number;
  errors: string[];
}

export interface VerificationUnitTestResult extends VerificationTestResult {
  evidenceHints?: VerificationEvidenceHint[];
}

export interface VerificationResult {
  passed: boolean;
  lint?: { passed: boolean; errors: string[] };
  typecheck?: { passed: boolean; errors: string[] };
  build?: { passed: boolean; errors: string[] };
  unitTests?: VerificationUnitTestResult;
  integrationTests?: VerificationTestResult;
  postDeploy?: {
    passed: boolean;
    infraUnavailable?: boolean;
    summary: string;
    errors: string[];
    screenshotDir?: string | null;
  };
}

// Deploy result
export interface DeployResult {
  success: boolean;
  url?: string;
  error?: string;
  duration?: number;
}

// Structured agent error — adapters classify errors from provider-specific
// events (JSONL stream, exit codes) so the executor doesn't have to regex-parse
// the full output blob.
export type AgentErrorCategory = 'rate_limit' | 'auth' | 'config' | 'budget' | 'infra' | 'timeout' | 'tooling' | 'unknown';

export interface AgentError {
  category: AgentErrorCategory;
  message: string;
  /** For rate_limit: seconds to wait before retrying. */
  retryAfterSec?: number;
  /** Absolute retry horizon when the provider exposes one. */
  retryAt?: string;
}

// Agent signals — the agent can emit these to request control flow changes
// instead of just failing/succeeding.
export type AgentSignal = 'needs_replan';

export interface AgentProviderSession {
  id: string;
  resumedFrom?: string;
  resumeFallbackReason?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Agent result
export interface AgentResult {
  success: boolean;
  output: string;
  filesChanged: string[];
  completionPromiseFound: boolean;
  /** Structured error from the adapter. When present, the executor should
   *  prefer this over regex-based classification of `output`. */
  error?: AgentError;
  /** Signal from the agent requesting a control flow change (e.g. replan). */
  signal?: AgentSignal;
  /** Provider CLI session metadata, used only for loop-internal best-effort continuation. */
  providerSession?: AgentProviderSession;
  /** Token usage reported by the provider/CLI for this model call. */
  usage?: AgentUsage;
}

export type ExecutorActionReportStatus =
  | 'completion_signal'
  | 'work_without_completion_signal'
  | 'no_op'
  | 'needs_replan_signal'
  | 'agent_failed';

export type ExecutorActionReportVisualWorkbenchCoverage =
  | 'changed'
  | 'missing_expected'
  | 'not_expected';

export type ExecutorActionReportWarningCode =
  | 'visual_workbench_coverage_gap'
  | 'expected_visual_story_gap'
  | 'ad_hoc_proof_like_file'
  | 'forbidden_changed_file'
  | 'malformed_completion';

export interface ExecutorActionReportSummary {
  filesChangedCount: number;
  changedProductFiles: string[];
  changedTaskWorkspaceFiles: string[];
  changedVisualWorkbenchFiles: string[];
  forbiddenChangedFiles: string[];
  adHocProofLikeFiles: string[];
  expectedVisualWorkbenchStoryIds: string[];
  coveredExpectedVisualWorkbenchStoryIds: string[];
  missingExpectedVisualWorkbenchStoryIds: string[];
  visualWorkbenchCoverage: ExecutorActionReportVisualWorkbenchCoverage;
}

export interface ExecutorActionReportWarning {
  code: ExecutorActionReportWarningCode;
  message: string;
}

export interface ExecutorActionReportVisualExpectation {
  hasStructuredVisualExpectation: boolean;
  sources: string[];
}

export interface ExecutorActionReportOutput {
  ownerBoundary: 'ralph.executor-observer';
  status: ExecutorActionReportStatus;
  visualEvidenceMode: VisualEvidenceMode;
  visualExpectation: ExecutorActionReportVisualExpectation;
  summary: ExecutorActionReportSummary;
  detectedCompletionPromiseFound: boolean;
  needsReplanSignalDetected: boolean;
  malformedCompletion: string | null;
  warnings: ExecutorActionReportWarning[];
}

export interface VisualWorkbenchAutomationIterationReadback {
  ownerBoundary: 'ralph.visual-workbench-evidence-automation';
  status: string;
  taskId: string;
  sourceRef: string;
  reportPath: string;
  diagnosticReportPath: string;
  selectorStatus: string;
  selectedStories: number;
  selectedViewports: number;
  shellPolicyStatus: string;
  browserReadinessStatus: string;
  captureStatus: string | null;
  exportedEvidenceRefs: number;
  publishedRows: number;
  blockers: string[];
}

// Iteration log entry — short summary of what happened in each iteration
export interface IterationLog {
  iteration: number;
  taskId: string;
  timestamp: string;
  outcome: 'verification_failed' | 'deploy_failed' | 'completed' | 'skipped' | 'error';
  filesChanged: string[];
  verificationPassed: boolean;
  errors?: string[];       // short error summaries (first line each)
  summary?: string;        // 1-2 sentence summary extracted from agent output
  /** Optional structured executor readback. Telemetry only; not lifecycle, retry, proof or task truth. */
  executorOutput?: ExecutorActionReportOutput;
  /** Optional post-task Workbench telemetry. Not screenshot availability, proof truth or Arena readback. */
  visualWorkbenchAutomation?: VisualWorkbenchAutomationIterationReadback;
}

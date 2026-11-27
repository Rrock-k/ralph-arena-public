import { z } from "zod";
import { AcceptedDiffItemChangeTypeSchema } from "./accepted-spec-artifact.js";
import { EventDirectionSchema } from "./events.js";

const IsoDateTimeSchema = z.string();

export const ProjectInteractionVersionSchema = z.literal("ra-287.project-interaction.v2");

export const ProjectInteractionVisibilitySchema = z.enum(["featured", "public", "private"]);
export const ProjectInteractionPublicStatusSchema = z.enum(["BUILDING", "LIVE", "PAUSED"]);
export const ProjectInteractionIntentSchema = z.enum(["ON", "OFF"]);
export const ProjectInteractionRuntimeStateSchema = z.enum(["ABSENT", "RUNNING", "STOPPED"]);
export const ProjectInteractionAgentStateSchema = z.enum(["IDLE", "RUNNING", "FAILED"]);
export const ProjectInteractionLastOutcomeSchema = z.enum(["COMPLETED", "FAILED"]);
export const ProjectInteractionPreviewHealthSchema = z.enum(["UNKNOWN", "HEALTHY", "UNHEALTHY"]);
export const ProjectInteractionBlockerSchema = z.enum([
  "MANUAL",
  "BUDGET",
  "RATE_LIMIT",
  "SECRETS",
  "INFRA",
  "API",
]);
export const ProjectInteractionLoopSupportStatusSchema = z.enum([
  "supported",
  "upgrade-required",
  "unsupported",
]);
export const ProjectInteractionSurfaceSchema = z.enum(["arena", "telegram"]);
export const ProjectInteractionAudienceSchema = z.enum(["admin", "contributor", "public"]);
export const ProjectInteractionTaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
]);
export const ProjectInteractionTaskChangeTypeSchema = AcceptedDiffItemChangeTypeSchema;
export const ProjectInteractionProofReviewStatusSchema = z.enum([
  "expected",
  "ready",
  "unavailable",
]);
export const ProjectInteractionProofArtifactRoleSchema = z.enum(["before", "after"]);
export const ProjectInteractionProofArtifactKindSchema = z.enum(["screenshot"]);
export const ProjectInteractionProofArtifactAvailabilitySchema = z.enum([
  "available",
  "unavailable",
]);
export const ProjectInteractionProofArtifactUnavailableReasonSchema = z.enum([
  "missing",
  "unsafe_path",
  "not_project_asset",
  "unsupported_source",
]);
export const ProjectInteractionProofReviewActionKindSchema = z.enum(["review_screenshots"]);
export const ProjectInteractionProofReviewActionSchema = z.object({
  kind: ProjectInteractionProofReviewActionKindSchema,
  label: z.literal("Проверить скриншоты"),
}).strict();
export const ProjectInteractionVisualEvidenceReviewStatusSchema = z.enum([
  "unassessed",
  "passed",
  "failed",
  "inconclusive",
  "conflict",
]);
export const ProjectInteractionVisualEvidenceArtifactAvailabilitySchema = z.enum([
  "available",
  "unavailable",
]);
export const ProjectInteractionVisualEvidenceArtifactUnavailableReasonSchema = z.enum([
  "missing_digest",
  "missing_artifact",
  "digest_mismatch",
  "non_image_artifact",
  "ambiguous_artifact",
]);
export const ProjectInteractionVisualEvidenceArtifactUrlSchema = z.string().regex(
  /^\/api\/projects\/[A-Za-z0-9._~%:-]+\/visual-evidence\/[A-Za-z0-9._~%:-]+\/artifact$/,
);
export const ProjectInteractionVisualEvidenceReviewActionKindSchema = z.enum(["review_visual_evidence"]);
export const ProjectInteractionVisualEvidenceReviewActionHrefSchema = z.string().regex(
  /^\/my\/projects\/[A-Za-z0-9._~%:-]+(?:\?[^#\s]*)#project-visual-evidence$/,
);
export const ProjectInteractionVisualEvidenceReviewActionSchema = z.object({
  kind: ProjectInteractionVisualEvidenceReviewActionKindSchema,
  label: z.literal("Проверить скриншоты"),
  href: ProjectInteractionVisualEvidenceReviewActionHrefSchema,
}).strict();
export const ProjectExecutionEventTypeSchema = z.enum([
  "planning.started",
  "plan.ready",
  "work.started",
  "progress.updated",
  "preview.ready",
  "action.required",
  "work.completed",
  "work.failed",
]);
export const ProjectInteractionExecutionEventToneSchema = z.enum([
  "neutral",
  "active",
  "success",
  "warning",
  "danger",
]);
export const ProjectInteractionExecutionActionKindSchema = z.enum([
  "open_preview",
  "open_work",
  "manage_secrets",
  "review",
  "wait",
]);
export const ProjectInteractionChangeBatchStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);
export const ProjectInteractionStatusSummaryStageSchema = z.enum([
  "planning",
  "working",
  "waiting",
  "completed",
  "failed",
  "preview",
  "idle",
]);
export const ProjectInteractionFeedbackStateSchema = z.enum([
  "open",
  "handled",
  "reopened",
  "accepted_closed",
  "superseded",
]);
export const ProjectInteractionFeedbackResolutionKindSchema = z.enum([
  "accepted_fixed",
  "not_a_bug",
  "superseded",
]);
export const ProjectInteractionAssumptionStateSchema = z.enum([
  "proposed",
  "accepted",
  "corrected",
  "disputed",
  "visible_caveat",
  "superseded",
]);
export const ProjectInteractionAssumptionOutcomeKindSchema = z.enum([
  "accepted_as_spec",
  "corrected_into_spec",
  "disputed_not_spec",
]);
export const ProjectInteractionAssumptionReviewSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_:-]{1,119}$/),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(8000),
  sourceRefs: z.array(z.string().regex(/^[A-Z][A-Z0-9_:-]{1,119}$/)),
}).strict();

export const ProjectInteractionAcceptedUpdateSchema = z.object({
  sourceVersion: z.number().int().positive().nullable(),
  targetSpecVersion: z.number().int().positive(),
  artifactId: z.string(),
  diffId: z.string(),
  summary: z.string(),
  diffItemCount: z.number().int().min(0),
  workItemCount: z.number().int().min(0),
  acceptedAt: IsoDateTimeSchema,
}).strict();

export const ProjectInteractionAccessCapabilitySchema = z.enum([
  "project.view",
  "project.runtime.manage",
  "project.specs.write",
  "project.assets.manage",
  "project.secrets.manage",
  "project.secrets.reveal",
  "project.required_secrets.manage",
  "project.budget.view",
  "project.budget.manage",
  "project.settings.manage",
  "project.access.manage",
  "project.delete",
  "platform.ops.view",
  "platform.projects.view",
  "platform.projects.manage",
  "platform.registry.manage",
  "platform.governance.manage",
  "platform.finance.manage",
  "platform.flags.manage",
  "platform.runtime.manage",
  "platform.access.manage",
]);

export const ProjectInteractionAllowedActionsSchema = z.object({
  view: z.boolean(),
  startApp: z.boolean(),
  stopApp: z.boolean(),
  startAgent: z.boolean(),
  pauseAgent: z.boolean(),
  relaunch: z.boolean(),
  launchSetup: z.boolean(),
  writeSpecs: z.boolean(),
  manageAssets: z.boolean(),
  manageSecrets: z.boolean(),
  revealSecrets: z.boolean(),
  manageRequiredSecrets: z.boolean(),
  viewBudget: z.boolean(),
  manageBudget: z.boolean(),
  manageSettings: z.boolean(),
  manageAccess: z.boolean(),
  deleteProject: z.boolean(),
});

export const ProjectInteractionSectionAccessSchema = z.object({
  status: z.boolean(),
  preview: z.boolean(),
  tasks: z.boolean(),
  feedback: z.boolean(),
  assumptions: z.boolean(),
  progress: z.boolean(),
  specs: z.boolean(),
  assets: z.boolean(),
  secrets: z.boolean(),
  budget: z.boolean(),
  activity: z.boolean(),
  settings: z.boolean(),
  access: z.boolean(),
});

export const ProjectInteractionIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  mode: z.string(),
  visibility: ProjectInteractionVisibilitySchema,
  archivedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  tgSpec: z.object({
    sourceProjectId: z.string().nullable(),
    mirrorSpecId: z.string().nullable(),
    lastImportedVersion: z.number().int().nullable(),
  }),
});

export const ProjectInteractionViewerSchema = z.object({
  userId: z.string().nullable(),
  surface: ProjectInteractionSurfaceSchema,
  audience: ProjectInteractionAudienceSchema,
  canView: z.boolean(),
  canManage: z.boolean(),
  sections: ProjectInteractionSectionAccessSchema,
  effectiveCapabilities: z.array(ProjectInteractionAccessCapabilitySchema),
  allowedActions: ProjectInteractionAllowedActionsSchema,
});

export const ProjectInteractionAppSchema = z.object({
  publicStatus: ProjectInteractionPublicStatusSchema,
  componentId: z.string().nullable(),
  powerIntent: ProjectInteractionIntentSchema.nullable(),
  agentIntent: ProjectInteractionIntentSchema.nullable(),
  runtimeState: ProjectInteractionRuntimeStateSchema.nullable(),
  agentState: ProjectInteractionAgentStateSchema.nullable(),
  blockers: z.array(ProjectInteractionBlockerSchema),
  lastOutcome: ProjectInteractionLastOutcomeSchema.nullable(),
  previewHealth: ProjectInteractionPreviewHealthSchema.nullable(),
  previewCheckedAt: IsoDateTimeSchema.nullable(),
  retryAt: IsoDateTimeSchema.nullable(),
  retryCount: z.number().int(),
  lastHeartbeat: IsoDateTimeSchema.nullable(),
  loopRuntime: z.string().nullable(),
  loopSupportStatus: ProjectInteractionLoopSupportStatusSchema.nullable(),
  loopSupportLabel: z.string().nullable(),
  loopSupportHint: z.string().nullable(),
});

export const ProjectInteractionPreviewSchema = z.object({
  url: z.string().nullable(),
  health: ProjectInteractionPreviewHealthSchema.nullable(),
  checkedAt: IsoDateTimeSchema.nullable(),
});

export const ProjectInteractionMacBuildStatusSchema = z.enum([
  "not_available",
  "building",
  "build_failed",
  "available",
]);
export const ProjectInteractionMacBuildDownloadUrlSchema = z.string().regex(
  /^\/api\/projects\/[A-Za-z0-9._~%:-]+\/release-artifacts\/[A-Za-z0-9._~%:-]+\/download$/,
);
export const ProjectInteractionMacBuildArtifactSchema = z.object({
  id: z.string(),
  version: z.string().nullable(),
  tag: z.string().nullable(),
  commitSha: z.string().nullable(),
  filename: z.string().min(1).max(200),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: IsoDateTimeSchema,
  downloadUrl: ProjectInteractionMacBuildDownloadUrlSchema,
}).strict();
export const ProjectInteractionMacBuildSchema = z.object({
  status: ProjectInteractionMacBuildStatusSchema,
  latestArtifact: ProjectInteractionMacBuildArtifactSchema.nullable(),
  failureSummary: z.string().nullable(),
  builderLabel: z.string().nullable(),
  updatedAt: IsoDateTimeSchema.nullable(),
}).strict();

export const ProjectInteractionProgressSummarySchema = z.object({
  state: z.string().nullable(),
  message: z.string().nullable(),
  iteration: z.number().int().nullable(),
  featuresCompleted: z.number().int().nullable(),
  featuresTotal: z.number().int().nullable(),
  currentFeature: z.string().nullable(),
});

export const ProjectInteractionTaskSourceSchema = z.object({
  sourceVersion: z.number().int().positive().nullable(),
  targetSpecVersion: z.number().int().positive(),
  artifactId: z.string(),
  diffId: z.string(),
  diffItemIds: z.array(z.string()),
  changeType: ProjectInteractionTaskChangeTypeSchema.nullable(),
  feedbackId: z.string().nullable(),
}).strict();

export const ProjectInteractionTaskSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
  status: ProjectInteractionTaskStatusSchema,
  orderIndex: z.number().int(),
  source: ProjectInteractionTaskSourceSchema.nullable(),
});

export const ProjectInteractionProofAssetUrlSchema = z.string().regex(
  /^\/api\/internal\/projects\/[A-Za-z0-9._~%:-]+\/assets\/[A-Za-z0-9._~%:-]+\/download$/,
);

export const ProjectInteractionProofArtifactSchema = z.object({
  role: ProjectInteractionProofArtifactRoleSchema,
  kind: ProjectInteractionProofArtifactKindSchema,
  availability: ProjectInteractionProofArtifactAvailabilitySchema,
  url: ProjectInteractionProofAssetUrlSchema.nullable(),
  assetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/).nullable(),
  contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).nullable(),
  sha256: z.string().regex(/^[A-Za-z0-9:_-]{1,160}$/).nullable(),
  capturedAt: IsoDateTimeSchema.nullable(),
  unavailableReason: ProjectInteractionProofArtifactUnavailableReasonSchema.nullable(),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.availability === "available") {
    if (!artifact.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "available proof artifacts require a safe Arena URL",
      });
    }
    if (artifact.unavailableReason !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["unavailableReason"],
        message: "available proof artifacts cannot carry an unavailable reason",
      });
    }
    return;
  }

  if (artifact.url !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["url"],
      message: "unavailable proof artifacts cannot carry a URL",
    });
  }
  if (artifact.unavailableReason === null) {
    ctx.addIssue({
      code: "custom",
      path: ["unavailableReason"],
      message: "unavailable proof artifacts require an unavailable reason",
    });
  }
});

export const ProjectInteractionProofReviewSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/),
  taskId: z.string().min(1).max(160),
  taskLabel: z.string().min(1).max(400),
  status: ProjectInteractionProofReviewStatusSchema,
  action: ProjectInteractionProofReviewActionSchema,
  source: ProjectInteractionTaskSourceSchema,
  before: ProjectInteractionProofArtifactSchema,
  after: ProjectInteractionProofArtifactSchema,
}).strict();

export const ProjectInteractionVisualEvidenceTargetSchema = z.object({
  route: z.string().min(1).max(240).regex(/^\/[^\\]*$/),
  viewport: z.object({
    width: z.number().int().min(1).max(10000),
    height: z.number().int().min(1).max(10000),
  }).strict(),
  claim: z.string().min(1).max(500).nullable(),
  state: z.string().min(1).max(500).nullable(),
  interaction: z.string().min(1).max(500).nullable(),
}).strict();

export const ProjectInteractionVisualEvidenceAssessmentSchema = z.object({
  ref: z.string().min(1).max(420).regex(/^[A-Za-z0-9._:-]+$/),
  result: z.enum(["pass", "fail", "inconclusive"]),
  observedAt: IsoDateTimeSchema.nullable(),
  summary: z.string().min(1).max(1000),
  recordedBy: z.string().min(1).max(40).nullable(),
}).strict();

export const ProjectInteractionVisualEvidenceArtifactSchema = z.object({
  availability: ProjectInteractionVisualEvidenceArtifactAvailabilitySchema,
  url: ProjectInteractionVisualEvidenceArtifactUrlSchema.nullable(),
  contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).nullable(),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  unavailableReason: ProjectInteractionVisualEvidenceArtifactUnavailableReasonSchema.nullable(),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.availability === "available") {
    if (!artifact.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "available visual evidence artifacts require a safe Arena URL",
      });
    }
    if (!artifact.contentType) {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: "available visual evidence artifacts require an image content type",
      });
    }
    if (!artifact.sha256) {
      ctx.addIssue({
        code: "custom",
        path: ["sha256"],
        message: "available visual evidence artifacts require a digest",
      });
    }
    if (artifact.unavailableReason !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["unavailableReason"],
        message: "available visual evidence artifacts cannot carry an unavailable reason",
      });
    }
    return;
  }

  if (artifact.url !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["url"],
      message: "unavailable visual evidence artifacts cannot carry a URL",
    });
  }
  if (artifact.unavailableReason === null) {
    ctx.addIssue({
      code: "custom",
      path: ["unavailableReason"],
      message: "unavailable visual evidence artifacts require an unavailable reason",
    });
  }
});

export const ProjectInteractionVisualEvidenceReviewSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/),
  taskId: z.string().min(1).max(160),
  taskLabel: z.string().min(1).max(400),
  status: ProjectInteractionVisualEvidenceReviewStatusSchema,
  action: ProjectInteractionVisualEvidenceReviewActionSchema,
  sourceEvidenceRef: z.string().min(1).max(420).regex(/^[A-Za-z0-9._:-]+$/),
  feedbackItemIds: z.array(z.string().min(1).max(160).regex(/^[A-Za-z0-9_:\-./]+$/)).min(1).max(20),
  diffItemIds: z.array(z.string().min(1).max(160).regex(/^[A-Za-z0-9_:\-./]+$/)).min(1).max(20),
  sourceKind: z.enum(["visual_workbench", "visual_scenario"]),
  target: ProjectInteractionVisualEvidenceTargetSchema,
  observedAt: IsoDateTimeSchema.nullable(),
  summary: z.string().min(1).max(1000),
  artifactSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  artifact: ProjectInteractionVisualEvidenceArtifactSchema,
  assessments: z.array(ProjectInteractionVisualEvidenceAssessmentSchema).max(20),
}).strict();

export const ProjectInteractionExecutionProgressSchema = z.object({
  completed: z.number().int().min(0).nullable(),
  total: z.number().int().min(0).nullable(),
  percent: z.number().int().min(0).max(100).nullable(),
}).strict();

export const ProjectInteractionExecutionActionSchema = z.object({
  kind: ProjectInteractionExecutionActionKindSchema,
  label: z.string(),
}).strict();

export const ProjectInteractionChangeBatchCountsSchema = z.object({
  added: z.number().int().min(0),
  updated: z.number().int().min(0),
  reopened: z.number().int().min(0),
  corrected: z.number().int().min(0),
  removed: z.number().int().min(0),
  superseded: z.number().int().min(0),
  other: z.number().int().min(0),
}).strict();

export const ProjectInteractionChangeBatchSchema = z.object({
  id: z.string(),
  sourceVersion: z.number().int().positive().nullable(),
  targetSpecVersion: z.number().int().positive(),
  artifactId: z.string(),
  diffId: z.string(),
  summary: z.string(),
  acceptedAt: IsoDateTimeSchema,
  status: ProjectInteractionChangeBatchStatusSchema,
  workItemCount: z.number().int().min(0),
  completedItemCount: z.number().int().min(0),
  pendingItemCount: z.number().int().min(0),
  changeCounts: ProjectInteractionChangeBatchCountsSchema,
}).strict();

export const ProjectInteractionStatusSummarySchema = z.object({
  stage: ProjectInteractionStatusSummaryStageSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(280).nullable(),
  lines: z.array(z.string().min(1).max(220)).max(5),
  currentTaskLabel: z.string().min(1).max(160).nullable(),
  activeBatchCount: z.number().int().min(0),
  activeWorkItemCount: z.number().int().min(0),
  completedWorkItemCount: z.number().int().min(0).nullable(),
  action: ProjectInteractionExecutionActionSchema.nullable(),
}).strict();

export const ProjectInteractionExecutionEventSchema = z.object({
  id: z.string(),
  type: ProjectExecutionEventTypeSchema,
  title: z.string(),
  summary: z.string().nullable(),
  tone: ProjectInteractionExecutionEventToneSchema,
  createdAt: IsoDateTimeSchema.nullable(),
  task: ProjectInteractionTaskSchema.nullable(),
  progress: ProjectInteractionExecutionProgressSchema.nullable(),
  acceptedUpdate: ProjectInteractionAcceptedUpdateSchema.nullable(),
  previewUrl: z.string().nullable(),
  action: ProjectInteractionExecutionActionSchema.nullable(),
}).strict();

export const ProjectInteractionExecutionSchema = z.object({
  current: ProjectInteractionExecutionEventSchema.nullable(),
  feed: z.array(ProjectInteractionExecutionEventSchema),
  latestAcceptedUpdate: ProjectInteractionAcceptedUpdateSchema.nullable(),
  activeChangeBatches: z.array(ProjectInteractionChangeBatchSchema),
  statusSummary: ProjectInteractionStatusSummarySchema,
}).strict();

export const ProjectInteractionCollectionMetaSchema = z.object({
  total: z.number().int().min(0),
  visible: z.number().int().min(0),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
}).strict();

export const ProjectInteractionCollectionsSchema = z.object({
  tasks: ProjectInteractionCollectionMetaSchema,
  feedback: ProjectInteractionCollectionMetaSchema,
  assumptions: ProjectInteractionCollectionMetaSchema,
}).strict();

export const ProjectInteractionFeedbackSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  state: ProjectInteractionFeedbackStateSchema,
  reopenCount: z.number().int().min(0),
  orderIndex: z.number().int(),
  resolution: z.object({
    kind: ProjectInteractionFeedbackResolutionKindSchema,
    summary: z.string(),
  }).nullable(),
}).strict();

export const ProjectInteractionAssumptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  statement: z.string(),
  state: ProjectInteractionAssumptionStateSchema,
  orderIndex: z.number().int(),
  outcome: z.object({
    kind: ProjectInteractionAssumptionOutcomeKindSchema,
    correctionSummary: z.string().nullable(),
  }).nullable(),
}).strict();

export const ProjectInteractionProgressFeatureSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
}).strict();

export const ProjectInteractionProgressRawSchema = z.object({
  state: z.string().optional(),
  message: z.string().optional(),
  iteration: z.number().int().optional(),
  featuresCompleted: z.number().int().optional(),
  featuresTotal: z.number().int().optional(),
  currentFeature: ProjectInteractionProgressFeatureSchema.optional(),
  recentFeatures: z.array(ProjectInteractionProgressFeatureSchema).optional(),
  steps: z.array(ProjectInteractionTaskSchema).optional(),
  assumptionReviews: z.array(ProjectInteractionAssumptionReviewSchema).optional(),
}).strict();

export const ProjectInteractionProgressSchema = z.object({
  summary: ProjectInteractionProgressSummarySchema,
  raw: ProjectInteractionProgressRawSchema.nullable(),
});

export const ProjectInteractionSpecSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  content: z.string(),
  orderIndex: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  versions: z.array(z.object({
    id: z.string(),
    version: z.number().int(),
    content: z.string(),
    message: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  })),
  latestVersion: z.object({
    version: z.number().int(),
    message: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  }).nullable(),
});

export const ProjectInteractionAssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  originalName: z.string(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  uploadedById: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ProjectInteractionRequiredSecretSchema = z.object({
  key: z.string(),
  description: z.string().optional(),
  blocking: z.boolean(),
  requestedAt: IsoDateTimeSchema.optional(),
  requestedByRunId: z.string().optional(),
  provided: z.boolean(),
  providedAt: IsoDateTimeSchema.nullable(),
});

export const ProjectInteractionProvidedSecretSchema = z.object({
  id: z.string(),
  key: z.string(),
  description: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ProjectInteractionSecretsSchema = z.object({
  required: z.array(ProjectInteractionRequiredSecretSchema),
  provided: z.array(ProjectInteractionProvidedSecretSchema),
});

export const ProjectInteractionBudgetSchema = z.object({
  isEnabled: z.boolean(),
  totalCreditsUsd: z.number(),
  usedCreditsUsd: z.number(),
}).nullable();

export const ProjectInteractionRunEventCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_:-]{0,63}$/);
export const ProjectInteractionProjectEventTypeSchema = z.string().regex(/^[a-z][a-z0-9_:-]{0,63}$/);
export const ProjectInteractionActivityLabelSchema = z.string().min(1).max(80);

export const ProjectInteractionRunEventSchema = z.object({
  id: z.string(),
  event: ProjectInteractionRunEventCodeSchema,
  label: ProjectInteractionActivityLabelSchema,
  createdAt: IsoDateTimeSchema,
});

export const ProjectInteractionProjectEventSchema = z.object({
  id: z.string(),
  direction: EventDirectionSchema,
  type: ProjectInteractionProjectEventTypeSchema,
  label: ProjectInteractionActivityLabelSchema,
  userId: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});

export const ProjectInteractionActivitySchema = z.object({
  runEvents: z.array(ProjectInteractionRunEventSchema),
  projectEvents: z.array(ProjectInteractionProjectEventSchema),
});

export const ProjectInteractionSnapshotSchema = z.object({
  version: ProjectInteractionVersionSchema,
  project: ProjectInteractionIdentitySchema,
  viewer: ProjectInteractionViewerSchema,
  app: ProjectInteractionAppSchema,
  preview: ProjectInteractionPreviewSchema,
  macBuild: ProjectInteractionMacBuildSchema,
  progress: ProjectInteractionProgressSchema,
  execution: ProjectInteractionExecutionSchema,
  collections: ProjectInteractionCollectionsSchema,
  tasks: z.array(ProjectInteractionTaskSchema),
  proofReviews: z.array(ProjectInteractionProofReviewSchema),
  visualEvidenceReviews: z.array(ProjectInteractionVisualEvidenceReviewSchema),
  feedback: z.array(ProjectInteractionFeedbackSchema),
  assumptions: z.array(ProjectInteractionAssumptionSchema),
  specs: z.array(ProjectInteractionSpecSchema),
  assets: z.array(ProjectInteractionAssetSchema),
  secrets: ProjectInteractionSecretsSchema,
  budget: ProjectInteractionBudgetSchema,
  activity: ProjectInteractionActivitySchema,
});

export type ProjectInteractionAllowedActions = z.infer<typeof ProjectInteractionAllowedActionsSchema>;
export type ProjectInteractionAccessCapability = z.infer<typeof ProjectInteractionAccessCapabilitySchema>;
export type ProjectExecutionEventType = z.infer<typeof ProjectExecutionEventTypeSchema>;
export type ProjectInteractionAcceptedUpdate = z.infer<typeof ProjectInteractionAcceptedUpdateSchema>;
export type ProjectInteractionChangeBatch = z.infer<typeof ProjectInteractionChangeBatchSchema>;
export type ProjectInteractionExecution = z.infer<typeof ProjectInteractionExecutionSchema>;
export type ProjectInteractionExecutionEvent = z.infer<typeof ProjectInteractionExecutionEventSchema>;
export type ProjectInteractionCollectionMeta = z.infer<typeof ProjectInteractionCollectionMetaSchema>;
export type ProjectInteractionCollections = z.infer<typeof ProjectInteractionCollectionsSchema>;
export type ProjectInteractionProgressRaw = z.infer<typeof ProjectInteractionProgressRawSchema>;
export type ProjectInteractionProgress = z.infer<typeof ProjectInteractionProgressSchema>;
export type ProjectInteractionSurface = z.infer<typeof ProjectInteractionSurfaceSchema>;
export type ProjectInteractionAudience = z.infer<typeof ProjectInteractionAudienceSchema>;
export type ProjectInteractionSectionAccess = z.infer<typeof ProjectInteractionSectionAccessSchema>;
export type ProjectInteractionStatusSummary = z.infer<typeof ProjectInteractionStatusSummarySchema>;
export type ProjectInteractionMacBuild = z.infer<typeof ProjectInteractionMacBuildSchema>;
export type ProjectInteractionFeedback = z.infer<typeof ProjectInteractionFeedbackSchema>;
export type ProjectInteractionAssumption = z.infer<typeof ProjectInteractionAssumptionSchema>;
export type ProjectInteractionAssumptionReview = z.infer<typeof ProjectInteractionAssumptionReviewSchema>;
export type ProjectInteractionProofArtifact = z.infer<typeof ProjectInteractionProofArtifactSchema>;
export type ProjectInteractionProofReview = z.infer<typeof ProjectInteractionProofReviewSchema>;
export type ProjectInteractionProofReviewAction = z.infer<typeof ProjectInteractionProofReviewActionSchema>;
export type ProjectInteractionProofReviewStatus = z.infer<typeof ProjectInteractionProofReviewStatusSchema>;
export type ProjectInteractionVisualEvidenceReview = z.infer<typeof ProjectInteractionVisualEvidenceReviewSchema>;
export type ProjectInteractionVisualEvidenceReviewAction = z.infer<typeof ProjectInteractionVisualEvidenceReviewActionSchema>;
export type ProjectInteractionVisualEvidenceReviewStatus = z.infer<typeof ProjectInteractionVisualEvidenceReviewStatusSchema>;
export type ProjectInteractionVisualEvidenceArtifact = z.infer<typeof ProjectInteractionVisualEvidenceArtifactSchema>;
export type ProjectInteractionVisualEvidenceArtifactUnavailableReason = z.infer<typeof ProjectInteractionVisualEvidenceArtifactUnavailableReasonSchema>;
export type ProjectInteractionTask = z.infer<typeof ProjectInteractionTaskSchema>;
export type ProjectInteractionTaskChangeType = z.infer<typeof ProjectInteractionTaskChangeTypeSchema>;
export type ProjectInteractionTaskSource = z.infer<typeof ProjectInteractionTaskSourceSchema>;
export type ProjectInteractionSnapshot = z.infer<typeof ProjectInteractionSnapshotSchema>;

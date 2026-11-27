import { z } from "zod";

export const ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION = "ra-287.accepted-spec-artifact.v1";
export const SPEC_DOCUMENT_SCHEMA_VERSION = "ra-287.spec-document.v1";

const MAX_SOURCE_REFS = 200;
const MAX_DIFF_ITEMS = 500;
const MAX_ARTIFACT_ITEMS = 500;

const ArtifactIdSchema = z.string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[A-Z][A-Z0-9_:\-]*$/, "Use uppercase ids with letters, numbers, _, :, or -");

const IsoDateTimeSchema = z.string().trim().datetime({ offset: true });
const HashRefSchema = z.string().trim().regex(/^sha256:[a-f0-9]{64}$/i);
const TitleSchema = z.string().trim().min(1).max(200);
const SummarySchema = z.string().trim().min(1).max(1000);
const BodySchema = z.string().trim().min(1).max(8000);
const SourceRefsSchema = z.array(ArtifactIdSchema).max(MAX_SOURCE_REFS);
const SourceEvidenceTextSchema = z.string().trim().min(1).max(1000);

const ForbiddenSecretFieldNames = new Set([
  "value",
  "secretvalue",
  "token",
  "apikey",
  "password",
  "encryptedvalue",
  "iv",
  "authtag",
  "defaultvalue",
  "samplevalue",
  "last4",
]);

export const ACCEPTED_SPEC_ARTIFACT_SECRET_LIKE_VALUE_PATTERN_SOURCES = [
  "-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----",
  "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",
  "\\bxox[baprs]-[A-Za-z0-9-]{20,}\\b",
  "\\bgh[pousr]_[A-Za-z0-9_]{20,}\\b",
  "\\bAIza[0-9A-Za-z_-]{20,}\\b",
  "\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b",
];

export const ACCEPTED_SPEC_ARTIFACT_REOPENED_FEEDBACK_MIN_REOPEN_COUNT = 1;

const SecretLikeValuePatterns = ACCEPTED_SPEC_ARTIFACT_SECRET_LIKE_VALUE_PATTERN_SOURCES
  .map((source) => new RegExp(source));

export type AcceptedSpecArtifactSecurityFinding = {
  path: string;
  reason: "forbidden_field_name" | "secret_like_value";
  preview?: string;
};

export const ProvenanceSourceSystemSchema = z.enum([
  "tg-spec",
  "arena",
  "loop",
  "operator",
  "production",
]);

export const ProvenanceSourceRefTypeSchema = z.enum([
  "accepted_spec",
  "discussion_message",
  "loop_output",
  "operator_note",
  "production_evidence",
]);

export const ProvenanceRefSchema = z.object({
  id: ArtifactIdSchema,
  sourceSystem: ProvenanceSourceSystemSchema,
  sourceProjectId: z.string().trim().min(1).max(160).optional(),
  sourceVersion: z.number().int().positive().optional(),
  sourceRefType: ProvenanceSourceRefTypeSchema,
  sourceId: z.string().trim().min(1).max(200),
  url: z.string().trim().url().optional(),
  fingerprint: HashRefSchema.optional(),
}).strict();

export const SpecSectionSchema = z.object({
  id: ArtifactIdSchema,
  title: TitleSchema,
  body: BodySchema.optional(),
  requirementIds: z.array(ArtifactIdSchema).max(MAX_ARTIFACT_ITEMS),
  sourceRefs: SourceRefsSchema,
}).strict();

export const SpecRequirementSchema = z.object({
  id: ArtifactIdSchema,
  kind: z.enum([
    "functional",
    "ux",
    "integration",
    "data",
    "non_functional",
    "constraint",
    "acceptance",
    "other",
  ]),
  title: TitleSchema,
  statement: BodySchema,
  priority: z.enum(["low", "normal", "high"]),
  acceptanceCriteria: z.array(SummarySchema).max(100),
  sourceRefs: SourceRefsSchema,
}).strict();

export const SpecExtensionBlockSchema = z.object({
  id: ArtifactIdSchema,
  title: TitleSchema,
  body: BodySchema,
  reason: SummarySchema,
  sourceRefs: SourceRefsSchema,
}).strict();

export const SpecDocumentSchema = z.object({
  specSchemaVersion: z.literal(SPEC_DOCUMENT_SCHEMA_VERSION),
  title: TitleSchema,
  summary: SummarySchema.optional(),
  sections: z.array(SpecSectionSchema).max(MAX_ARTIFACT_ITEMS),
  requirements: z.array(SpecRequirementSchema).max(MAX_ARTIFACT_ITEMS),
  extensionBlocks: z.array(SpecExtensionBlockSchema).max(100),
}).strict();

export const AcceptedSpecSchema = z.object({
  id: ArtifactIdSchema,
  version: z.number().int().positive(),
  document: SpecDocumentSchema,
  renderedMarkdown: z.string().min(1).max(1_000_000).optional(),
  contentHash: HashRefSchema,
  sourceRefs: SourceRefsSchema,
}).strict();

export const AcceptedDiffItemTargetTypeSchema = z.enum([
  "spec",
  "feedback",
  "assumption",
  "secret_requirement",
  "asset",
]);

export const AcceptedDiffItemChangeTypeSchema = z.enum([
  "created",
  "updated",
  "handled",
  "closed",
  "reopened",
  "accepted",
  "corrected",
  "disputed",
  "superseded",
  "removed",
]);

export const AcceptedDiffItemWorkImpactSchema = z.enum([
  "requires_loop_work",
  "context_only",
  "no_loop_work",
]);

export const AcceptedDiffItemWorkSurfaceSchema = z.enum([
  "frontend",
  "backend",
  "data",
  "ops",
  "unknown",
]);

export const AcceptedDiffSourceEvidenceSchema = z.object({
  sourceRef: ArtifactIdSchema,
  quote: SourceEvidenceTextSchema.optional(),
  intent: SourceEvidenceTextSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.quote && !value.intent) {
    ctx.addIssue({
      code: "custom",
      path: ["quote"],
      message: "source evidence requires quote or intent",
    });
  }
});

export const AcceptedDiffItemSchema = z.object({
  id: ArtifactIdSchema,
  targetType: AcceptedDiffItemTargetTypeSchema,
  targetId: ArtifactIdSchema,
  changeType: AcceptedDiffItemChangeTypeSchema,
  workImpact: AcceptedDiffItemWorkImpactSchema,
  workSurface: AcceptedDiffItemWorkSurfaceSchema.optional(),
  summary: SummarySchema,
  sourceRefs: SourceRefsSchema,
  sourceEvidence: z.array(AcceptedDiffSourceEvidenceSchema).max(20).optional(),
}).strict().superRefine((value, ctx) => {
  for (let i = 0; i < (value.sourceEvidence ?? []).length; i++) {
    const evidence = value.sourceEvidence?.[i];
    if (evidence && !value.sourceRefs.includes(evidence.sourceRef)) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceEvidence", i, "sourceRef"],
        message: "source evidence sourceRef must be listed in sourceRefs",
      });
    }
  }
});

export const AcceptedDiffSchema = z.object({
  id: ArtifactIdSchema,
  baseSpecVersion: z.number().int().positive().optional(),
  targetSpecVersion: z.number().int().positive(),
  summary: SummarySchema,
  items: z.array(AcceptedDiffItemSchema).max(MAX_DIFF_ITEMS),
}).strict();

export const FeedbackResolutionSchema = z.object({
  kind: z.enum(["accepted_fixed", "not_a_bug", "superseded"]),
  summary: SummarySchema,
  sourceRefs: SourceRefsSchema,
}).strict();

const FeedbackResolutionInputSchema = z.object({
  kind: z.enum(["accepted_fixed", "not_a_bug"]).optional(),
  summary: SummarySchema,
  sourceRefs: SourceRefsSchema,
}).strict();

const ReopenFeedbackInputSchema = z.object({
  body: BodySchema.optional(),
  sourceRefs: SourceRefsSchema,
}).strict();

export const FeedbackItemSchema = z.object({
  id: ArtifactIdSchema,
  title: TitleSchema,
  body: BodySchema,
  state: z.enum(["open", "handled", "reopened", "accepted_closed", "superseded"]),
  reopenCount: z.number().int().min(0),
  defaultClosurePolicy: z.literal("loop_claim_is_enough_until_reopened"),
  sourceRefs: SourceRefsSchema,
  resolution: FeedbackResolutionSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.state === "reopened" && value.reopenCount < ACCEPTED_SPEC_ARTIFACT_REOPENED_FEEDBACK_MIN_REOPEN_COUNT) {
    ctx.addIssue({
      code: "custom",
      path: ["reopenCount"],
      message: "reopened feedback must have reopenCount >= 1",
    });
  }
});

export const AssumptionOutcomeSchema = z.object({
  kind: z.enum(["accepted_as_spec", "corrected_into_spec", "disputed_not_spec"]),
  acceptedDiffItemId: ArtifactIdSchema.optional(),
  correctionSummary: SummarySchema.optional(),
}).strict();

export const AssumptionItemSchema = z.object({
  id: ArtifactIdSchema,
  title: TitleSchema,
  statement: BodySchema,
  state: z.enum([
    "proposed",
    "accepted",
    "corrected",
    "disputed",
    "visible_caveat",
    "superseded",
  ]),
  sourceRefs: SourceRefsSchema,
  outcome: AssumptionOutcomeSchema.optional(),
}).strict();

export const SecretRequirementRefSchema = z.object({
  id: ArtifactIdSchema,
  key: z.string().trim().min(2).max(120).regex(/^[A-Z][A-Z0-9_]*$/),
  description: SummarySchema.optional(),
  required: z.boolean(),
  blocking: z.boolean(),
  sourceRefs: SourceRefsSchema,
}).strict();

export const AssetRefSchema = z.object({
  id: ArtifactIdSchema,
  kind: z.enum(["image", "document", "data", "archive", "other"]),
  label: TitleSchema,
  required: z.boolean(),
  state: z.enum(["pending", "resolved", "removed"]),
  logicalPath: z.string().trim().min(1).max(500).optional(),
  contentType: z.string().trim().min(1).max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: HashRefSchema.optional(),
  arenaAssetId: z.string().trim().min(1).max(160).optional(),
  sourceRefs: SourceRefsSchema,
}).strict();

const AcceptedSpecArtifactObjectSchema = z.object({
  artifactSchemaVersion: z.literal(ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION),
  artifactId: ArtifactIdSchema,
  acceptedAt: IsoDateTimeSchema,
  source: ProvenanceRefSchema,
  acceptedSpec: AcceptedSpecSchema,
  acceptedDiff: AcceptedDiffSchema,
  feedback: z.array(FeedbackItemSchema).max(MAX_ARTIFACT_ITEMS),
  assumptions: z.array(AssumptionItemSchema).max(MAX_ARTIFACT_ITEMS),
  secretRequirements: z.array(SecretRequirementRefSchema).max(MAX_ARTIFACT_ITEMS),
  assets: z.array(AssetRefSchema).max(MAX_ARTIFACT_ITEMS),
}).strict();

export const AcceptedSpecArtifactSchema = AcceptedSpecArtifactObjectSchema.superRefine((value, ctx) => {
  const findings = findAcceptedSpecArtifactSecurityFindings(value)
    .filter((finding) => finding.reason === "secret_like_value");
  for (const finding of findings) {
    ctx.addIssue({
      code: "custom",
      path: pathToZodPath(finding.path),
      message: `secret-like artifact content is not allowed at ${finding.path}`,
    });
  }
});

export type ProvenanceRef = z.infer<typeof ProvenanceRefSchema>;
export type SpecSection = z.infer<typeof SpecSectionSchema>;
export type SpecRequirement = z.infer<typeof SpecRequirementSchema>;
export type SpecExtensionBlock = z.infer<typeof SpecExtensionBlockSchema>;
export type SpecDocument = z.infer<typeof SpecDocumentSchema>;
export type AcceptedSpec = z.infer<typeof AcceptedSpecSchema>;
export type AcceptedDiffItem = z.infer<typeof AcceptedDiffItemSchema>;
export type AcceptedDiffSourceEvidence = z.infer<typeof AcceptedDiffSourceEvidenceSchema>;
export type AcceptedDiff = z.infer<typeof AcceptedDiffSchema>;
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;
export type AssumptionItem = z.infer<typeof AssumptionItemSchema>;
export type SecretRequirementRef = z.infer<typeof SecretRequirementRefSchema>;
export type AssetRef = z.infer<typeof AssetRefSchema>;
export type AcceptedSpecArtifact = z.infer<typeof AcceptedSpecArtifactSchema>;

export type FeedbackResolutionInput = z.infer<typeof FeedbackResolutionInputSchema>;
export type ReopenFeedbackInput = z.infer<typeof ReopenFeedbackInputSchema>;

export function feedbackRequiresLoopWork(item: Pick<FeedbackItem, "state">): boolean {
  return item.state === "open" || item.state === "reopened";
}

export function feedbackHasLoopClaim(item: Pick<FeedbackItem, "state">): boolean {
  return item.state === "handled";
}

export function feedbackIsProductClosed(item: Pick<FeedbackItem, "state">): boolean {
  return item.state === "accepted_closed" || item.state === "superseded";
}

export function acceptedDiffItemRequiresLoopWork(item: Pick<AcceptedDiffItem, "workImpact">): boolean {
  return item.workImpact === "requires_loop_work";
}

export function acceptedDiffItemRequiresFrontendProof(
  item: Pick<AcceptedDiffItem, "workImpact" | "workSurface">,
): boolean {
  return item.workImpact === "requires_loop_work" && item.workSurface === "frontend";
}

export function acceptedSpecArtifactRequiresLoopWork(
  artifact: Pick<AcceptedSpecArtifact, "acceptedDiff">,
): boolean {
  return artifact.acceptedDiff.items.some(acceptedDiffItemRequiresLoopWork);
}

export function markFeedbackHandled(item: FeedbackItem): FeedbackItem {
  const parsed = FeedbackItemSchema.parse(item);
  assertFeedbackTransition(parsed, "mark handled", ["open", "reopened"]);
  return FeedbackItemSchema.parse({
    ...parsed,
    state: "handled",
    resolution: undefined,
  });
}

export function acceptFeedbackClosed(item: FeedbackItem, resolution: FeedbackResolutionInput): FeedbackItem {
  const parsed = FeedbackItemSchema.parse(item);
  const parsedResolution = FeedbackResolutionInputSchema.parse(resolution);
  assertFeedbackTransition(parsed, "accept closed", ["open", "handled", "reopened"]);
  return FeedbackItemSchema.parse({
    ...parsed,
    state: "accepted_closed",
    resolution: {
      kind: parsedResolution.kind ?? "accepted_fixed",
      summary: parsedResolution.summary,
      sourceRefs: mergeSourceRefs([], parsedResolution.sourceRefs),
    },
  });
}

export function reopenFeedback(item: FeedbackItem, input: ReopenFeedbackInput): FeedbackItem {
  const parsed = FeedbackItemSchema.parse(item);
  const parsedInput = ReopenFeedbackInputSchema.parse(input);
  assertFeedbackTransition(parsed, "reopen", ["open", "handled", "reopened", "accepted_closed"]);
  return FeedbackItemSchema.parse({
    ...parsed,
    body: parsedInput.body ?? parsed.body,
    state: "reopened",
    reopenCount: Math.max(parsed.reopenCount + 1, ACCEPTED_SPEC_ARTIFACT_REOPENED_FEEDBACK_MIN_REOPEN_COUNT),
    sourceRefs: mergeSourceRefs(parsed.sourceRefs, parsedInput.sourceRefs),
    resolution: undefined,
  });
}

export function supersedeFeedback(item: FeedbackItem, resolution: FeedbackResolutionInput): FeedbackItem {
  const parsed = FeedbackItemSchema.parse(item);
  const parsedResolution = FeedbackResolutionInputSchema.parse(resolution);
  assertFeedbackTransition(parsed, "supersede", ["open", "handled", "reopened"]);
  return FeedbackItemSchema.parse({
    ...parsed,
    state: "superseded",
    resolution: {
      kind: "superseded",
      summary: parsedResolution.summary,
      sourceRefs: mergeSourceRefs([], parsedResolution.sourceRefs),
    },
  });
}

export function parseAcceptedSpecArtifact(value: unknown): AcceptedSpecArtifact {
  assertAcceptedSpecArtifactSecurity(value);
  return AcceptedSpecArtifactSchema.parse(value);
}

export function parseSpecDocument(value: unknown): SpecDocument {
  assertAcceptedSpecArtifactSecurity(value);
  return SpecDocumentSchema.parse(value);
}

export function renderSpecDocumentMarkdown(document: SpecDocument): string {
  const parsed = parseSpecDocument(document);
  const sections = [`# ${parsed.title}`];

  if (parsed.summary) {
    sections.push(parsed.summary);
  }

  for (const section of parsed.sections) {
    const lines = [`## ${section.title}`];
    if (section.body) lines.push(section.body);

    const requirements = parsed.requirements.filter((requirement) => section.requirementIds.includes(requirement.id));
    if (requirements.length > 0) {
      lines.push("### Requirements");
      for (const requirement of requirements) {
        lines.push(`- ${requirement.id}: ${requirement.title} (${requirement.priority})`);
        lines.push(`  ${requirement.statement}`);
        if (requirement.acceptanceCriteria.length > 0) {
          lines.push("  Acceptance:");
          for (const criterion of requirement.acceptanceCriteria) {
            lines.push(`  - ${criterion}`);
          }
        }
      }
    }

    sections.push(lines.join("\n\n"));
  }

  const unsectionedRequirements = parsed.requirements.filter((requirement) => (
    !parsed.sections.some((section) => section.requirementIds.includes(requirement.id))
  ));
  if (unsectionedRequirements.length > 0) {
    const lines = ["## Requirements"];
    for (const requirement of unsectionedRequirements) {
      lines.push(`- ${requirement.id}: ${requirement.title} (${requirement.priority})`);
      lines.push(`  ${requirement.statement}`);
    }
    sections.push(lines.join("\n\n"));
  }

  if (parsed.extensionBlocks.length > 0) {
    const lines = ["## Extension Blocks"];
    for (const block of parsed.extensionBlocks) {
      lines.push(`### ${block.title}`);
      lines.push(block.body);
      lines.push(`Reason: ${block.reason}`);
    }
    sections.push(lines.join("\n\n"));
  }

  return `${sections.join("\n\n")}\n`;
}

export function findAcceptedSpecArtifactSecurityFindings(
  value: unknown,
): AcceptedSpecArtifactSecurityFinding[] {
  const findings: AcceptedSpecArtifactSecurityFinding[] = [];
  visitArtifactValue(value, "$", findings);
  return findings;
}

export function assertAcceptedSpecArtifactSecurity(value: unknown): void {
  const findings = findAcceptedSpecArtifactSecurityFindings(value);
  if (findings.length === 0) return;

  throw new Error(`Forbidden accepted spec artifact content: ${findings.map((finding) => (
    `${finding.reason} at ${finding.path}`
  )).join(", ")}`);
}

function visitArtifactValue(
  value: unknown,
  path: string,
  findings: AcceptedSpecArtifactSecurityFinding[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitArtifactValue(entry, `${path}[${index}]`, findings));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const keyPath = `${path}.${key}`;
      if (ForbiddenSecretFieldNames.has(key.toLowerCase())) {
        findings.push({ path: keyPath, reason: "forbidden_field_name" });
      }
      visitArtifactValue(entry, keyPath, findings);
    }
    return;
  }

  if (typeof value === "string" && isSecretLikeValue(value)) {
    findings.push({
      path,
      reason: "secret_like_value",
      preview: value.slice(0, 16),
    });
  }
}

function isSecretLikeValue(value: string): boolean {
  return SecretLikeValuePatterns.some((pattern) => pattern.test(value));
}

function mergeSourceRefs(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function assertFeedbackTransition(
  item: FeedbackItem,
  action: string,
  allowedStates: FeedbackItem["state"][],
): void {
  if (allowedStates.includes(item.state)) return;
  throw new Error(`Cannot ${action} feedback ${item.id} from state ${item.state}`);
}

function pathToZodPath(path: string): Array<string | number> {
  if (path === "$") return [];
  const parts: Array<string | number> = [];
  for (const part of path.replace(/^\$\./, "").split(".")) {
    const match = /^([^\[]+)(?:\[(\d+)])?$/.exec(part);
    if (!match) {
      parts.push(part);
      continue;
    }
    parts.push(match[1]);
    if (match[2] !== undefined) {
      parts.push(Number(match[2]));
    }
  }
  return parts;
}

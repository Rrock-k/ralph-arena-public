import { z } from "zod";

// ── Event payload schemas (per type) ───────────────────────

export const TestStepSchema = z.object({
  question: z.string().min(1),
});

export const TestRequestPayloadSchema = z.object({
  title: z.string().min(1),
  steps: z.array(TestStepSchema).min(1),
  url: z.string().url().optional(),
});

export const TestStepResultSchema = z.object({
  stepIndex: z.number().int().min(0),
  passed: z.boolean(),
  comment: z.string().optional(),
});

export const TestResultPayloadSchema = z.object({
  testRequestEventId: z.string(),
  results: z.array(TestStepResultSchema).min(1),
});

export const QaFeedbackTestSchema = z.object({
  testTitle: z.string(),
  steps: z.array(z.object({
    question: z.string(),
    passed: z.boolean(),
    comment: z.string().optional(),
  })),
});

export const QaFeedbackBatchPayloadSchema = z.object({
  summary: z.string(),
  tests: z.array(QaFeedbackTestSchema),
  totalPassed: z.number().int(),
  totalFailed: z.number().int(),
});

export const PreviewRefreshRequestPayloadSchema = z.object({
  source: z.enum(["admin", "runner", "system"]).default("admin"),
  reason: z.string().min(1).optional(),
});

export const WorkspaceEventTypeSchema = z.enum([
  "test_request",
  "test_result",
  "qa_feedback_batch",
  "preview_refresh_requested",
]);

// ── Transport schemas ──────────────────────────────────────

// RA-386: three recipients, three directions. `in` is the runner's inbox and
// may only carry types from WorkspaceEventTypeSchema — the runner polls it and
// acts on what it finds. `out` is what the agent sends back. `internal` is
// governance writing a record for itself or for its own UI: recreate-cooldown
// marks, context questions. Before this split all three shared `in`, and the
// runner choked on mail addressed to someone else (RA-384).
export const EventDirectionSchema = z.enum(["in", "out", "internal"]);

export const WorkspaceTransportVersionSchema = z.literal(1);

export const EVENT_PAYLOAD_SCHEMAS = {
  test_request: TestRequestPayloadSchema,
  test_result: TestResultPayloadSchema,
  qa_feedback_batch: QaFeedbackBatchPayloadSchema,
  preview_refresh_requested: PreviewRefreshRequestPayloadSchema,
} satisfies Record<z.infer<typeof WorkspaceEventTypeSchema>, z.ZodType>;

function validateWorkspacePayload(
  data: { type: z.infer<typeof WorkspaceEventTypeSchema>; payload: unknown },
  ctx: z.RefinementCtx,
): void {
  const payloadSchema = EVENT_PAYLOAD_SCHEMAS[data.type];
  const payloadResult = payloadSchema.safeParse(data.payload);
  if (!payloadResult.success) {
    const flattened = payloadResult.error.flatten();
    for (const issue of flattened.formErrors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: issue,
      });
    }
    for (const [field, issues] of Object.entries(flattened.fieldErrors)) {
      for (const issue of issues ?? []) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", field],
          message: issue,
        });
      }
    }
  }
}

const WorkspaceEventEnvelopeBaseSchema = z.object({
  version: WorkspaceTransportVersionSchema.default(1),
  type: WorkspaceEventTypeSchema,
  payload: z.unknown(),
});

export const WorkspaceOutgoingEventSchema = WorkspaceEventEnvelopeBaseSchema.superRefine(
  validateWorkspacePayload,
);

export const WorkspaceIncomingEventSchema = WorkspaceEventEnvelopeBaseSchema.extend({
  id: z.string().optional(),
  projectId: z.string().optional(),
  direction: EventDirectionSchema.optional(),
  userId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
}).superRefine(validateWorkspacePayload);

export const WorkspaceOutgoingEventBatchSchema = z.array(WorkspaceOutgoingEventSchema);
export const WorkspaceIncomingEventBatchSchema = z.array(WorkspaceIncomingEventSchema);

export const ProjectEventSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  direction: EventDirectionSchema,
  type: WorkspaceEventTypeSchema,
  payload: z.unknown(),
  userId: z.string().nullable().optional(),
  createdAt: z.string(),
}).superRefine(validateWorkspacePayload);

export const PushEventsRequestSchema = z.object({
  events: WorkspaceOutgoingEventBatchSchema.min(1),
});

// The response boundary validates only the transport container. Individual
// events are validated independently by the runner so one unsupported event
// cannot poison the entire polling cursor.
export const PollEventsResponseSchema = z.object({
  events: z.array(z.unknown()),
});

// ── Types ──────────────────────────────────────────────────

export type TestStep = z.infer<typeof TestStepSchema>;
export type TestRequestPayload = z.infer<typeof TestRequestPayloadSchema>;
export type TestStepResult = z.infer<typeof TestStepResultSchema>;
export type TestResultPayload = z.infer<typeof TestResultPayloadSchema>;
export type PreviewRefreshRequestPayload = z.infer<typeof PreviewRefreshRequestPayloadSchema>;
export type WorkspaceEventType = z.infer<typeof WorkspaceEventTypeSchema>;
export type WorkspaceOutgoingEvent = z.infer<typeof WorkspaceOutgoingEventSchema>;
export type WorkspaceIncomingEvent = z.infer<typeof WorkspaceIncomingEventSchema>;
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type QaFeedbackTest = z.infer<typeof QaFeedbackTestSchema>;
export type QaFeedbackBatchPayload = z.infer<typeof QaFeedbackBatchPayloadSchema>;
export type PushEventsRequest = z.infer<typeof PushEventsRequestSchema>;
export type PollEventsResponse = z.infer<typeof PollEventsResponseSchema>;

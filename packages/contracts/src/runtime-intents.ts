import { z } from "zod";

const ActualRuntimeSchema = z.enum(["ABSENT", "RUNNING", "STOPPED"]);

export const WorkerResourcePressureSchema = z.object({
  capturedAt: z.string().optional(),
  constrained: z.boolean(),
  reasons: z.array(z.string()).default([]),
  memory: z.object({
    usageBytes: z.number().int().nonnegative().nullable().optional(),
    limitBytes: z.number().int().positive().nullable().optional(),
    usageRatio: z.number().nonnegative().nullable().optional(),
    thresholdRatio: z.number().positive().nullable().optional(),
  }).optional(),
  pids: z.object({
    current: z.number().int().nonnegative().nullable().optional(),
    limit: z.number().int().positive().nullable().optional(),
    threshold: z.number().int().positive().nullable().optional(),
  }).optional(),
  containers: z.object({
    sampled: z.number().int().nonnegative().optional(),
    running: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const RuntimeIntentActionSchema = z.enum([
  "ensure_running",
  "ensure_stopped",
  "ensure_removed",
]);

export const RuntimeIntentRunnerModeSchema = z.enum([
  "preview_only",
  "agent_run",
]);

export const RuntimeIntentClaimRequestSchema = z.object({
  host: z.string().default("local"),
  capacity: z.number().int().nonnegative().optional(),
  activePreviewContainers: z.array(z.string()).optional(),
  resourcePressure: WorkerResourcePressureSchema.optional(),
});

const RuntimeIntentClaimedBaseSchema = z.object({
  intentId: z.string(),
  projectId: z.string(),
  action: RuntimeIntentActionSchema,
  containerName: z.string().nullable(),
  workspaceLabel: z.string(),
  workerImage: z.string().nullable(),
  attempt: z.number().int().positive(),
  resources: z.object({
    memoryMb: z.number().int().positive().optional(),
    cpuCount: z.number().positive().optional(),
  }).optional(),
});

export const RuntimeIntentClaimedSchema = z.union([
  RuntimeIntentClaimedBaseSchema.extend({
    action: z.literal("ensure_running"),
    runnerMode: z.literal("preview_only"),
    env: z.record(z.string(), z.string()),
  }),
  RuntimeIntentClaimedBaseSchema.extend({
    action: z.enum(["ensure_stopped", "ensure_removed"]),
    runnerMode: z.literal("preview_only"),
  }),
  RuntimeIntentClaimedBaseSchema.extend({
    action: z.literal("ensure_running"),
    runnerMode: z.literal("agent_run"),
    env: z.record(z.string(), z.string()),
  }),
]);

export const RuntimeIntentClaimResponseSchema = RuntimeIntentClaimedSchema.nullable();

export const RuntimeIntentCompleteRequestSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    actualRuntime: ActualRuntimeSchema,
    containerName: z.string().nullable().optional(),
    previewUrl: z.string().nullable().optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    retryable: z.boolean().default(true),
  }),
]);

export type RuntimeIntentAction = z.infer<typeof RuntimeIntentActionSchema>;
export type RuntimeIntentRunnerMode = z.infer<typeof RuntimeIntentRunnerModeSchema>;
export type WorkerResourcePressure = z.infer<typeof WorkerResourcePressureSchema>;
export type RuntimeIntentClaimRequest = z.infer<typeof RuntimeIntentClaimRequestSchema>;
export type RuntimeIntentClaimed = z.infer<typeof RuntimeIntentClaimedSchema>;
export type RuntimeIntentClaimResponse = z.infer<typeof RuntimeIntentClaimResponseSchema>;
export type RuntimeIntentCompleteRequest = z.infer<typeof RuntimeIntentCompleteRequestSchema>;

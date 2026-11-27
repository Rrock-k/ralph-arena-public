import { z } from "zod";
import { TerminalStatusSchema } from "./statuses.js";
import { WorkerResourcePressureSchema } from "./runtime-intents.js";

export const PreviewActualStateSchema = z.enum(["ABSENT", "STARTING", "SERVING", "ERROR"]);
export type PreviewActualState = z.infer<typeof PreviewActualStateSchema>;

export const PauseReasonSchema = z.enum(["MANUAL", "BUDGET", "SECRETS", "RATE_LIMIT", "INFRA", "API"]);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

export const TerminalForensicsSchema = z.object({
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  lastProgressState: z.string().nullable().optional(),
  resourcePressure: WorkerResourcePressureSchema.optional(),
  cgroupMemoryEvents: z.record(z.string(), z.number()).optional(),
});
export type TerminalForensics = z.infer<typeof TerminalForensicsSchema>;

export const TerminalRequestSchema = z.object({
  terminalState: TerminalStatusSchema,
  pauseReason: PauseReasonSchema.nullable().optional(),
  retryAt: z.string().optional(),
  reasonCode: z.string().optional(),
  reasonMessage: z.string().optional(),
  commitSha: z.string().optional(),
  log: z.string().optional(),
  containerName: z.string().nullable().optional(),
  previewUrl: z.string().optional(),
  telegramMiniAppUrl: z.string().optional(),
  workerHost: z.string().nullable().optional(),
  previewActual: PreviewActualStateSchema.optional(),
  previewLastError: z.string().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  estimatedCostUsd: z.number().optional(),
  forensics: TerminalForensicsSchema.optional(),
});

export type TerminalRequest = z.infer<typeof TerminalRequestSchema>;

import { z } from "zod";
import { PreviewActualStateSchema } from "./terminal.js";

export const ProgressRequestSchema = z.object({
  projectId: z.string().optional(),
  status: z.string().optional(),
  eventType: z.string().optional(),
  budgetDebitedUsd: z.number().optional(),
  estimatedCostUsd: z.number().optional(),
  progressJson: z.string().nullable().optional(),
  previewActual: PreviewActualStateSchema.optional(),
  telegramMiniAppUrl: z.string().optional(),
});

export type ProgressRequest = z.infer<typeof ProgressRequestSchema>;

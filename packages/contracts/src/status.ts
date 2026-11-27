import { z } from "zod";

export const StatusResponseSchema = z.object({
  shouldStop: z.boolean(),
  reason: z.string().optional(),
  agentIntent: z.enum(["ON", "OFF"]).optional(),
  pendingLoopWork: z.boolean().optional(),
  auth: z.record(z.string(), z.string()).optional(),
  authVersion: z.string().optional(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;

import { z } from "zod";

export const RequestedSecretEntrySchema = z.object({
  key: z.string(),
  description: z.string().optional(),
  blocking: z.boolean().optional(),
});

export type RequestedSecretEntry = z.infer<typeof RequestedSecretEntrySchema>;

export const RequestSecretsRequestSchema = z.array(RequestedSecretEntrySchema);

export type RequestSecretsRequest = z.infer<typeof RequestSecretsRequestSchema>;

export const RequestSecretsResponseSchema = z.object({
  provided: z.record(z.string(), z.string()),
  missing: z.array(
    z.object({
      key: z.string(),
      description: z.string().optional(),
      blocking: z.boolean(),
    }),
  ),
  paused: z.boolean(),
});

export type RequestSecretsResponse = z.infer<typeof RequestSecretsResponseSchema>;

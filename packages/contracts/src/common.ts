import { z } from "zod";
import { AcceptedSpecArtifactSchema } from "./accepted-spec-artifact.js";

const SpecVersionMetadataSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  message: z.string().nullable().optional(),
  createdAt: z.string(),
});

const SpecSourceMetadataSchema = z.object({
  system: z.string(),
  projectId: z.string(),
  version: z.number().int().positive(),
  url: z.string().nullable().optional(),
  acceptedAt: z.string().nullable().optional(),
});

const AcceptedArtifactBacklogEntrySchema = z.object({
  currentVersion: SpecVersionMetadataSchema.optional(),
  source: SpecSourceMetadataSchema.optional(),
  acceptedArtifact: AcceptedSpecArtifactSchema,
  metadataHash: z.string().optional(),
});

export const SpecItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  content: z.string(),
  hash: z.string(),
  inputHash: z.string().optional(),
  currentVersion: SpecVersionMetadataSchema.optional(),
  source: SpecSourceMetadataSchema.optional(),
  acceptedArtifact: AcceptedSpecArtifactSchema.optional(),
  acceptedArtifactBacklog: z.array(AcceptedArtifactBacklogEntrySchema).optional(),
  metadataHash: z.string().optional(),
});

export type SpecItem = z.infer<typeof SpecItemSchema>;

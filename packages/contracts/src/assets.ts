import { z } from "zod";

export const AssetItemSchema = z.object({
  id: z.string(),
  path: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string().nullable(),
});

export const AssetsResponseSchema = z.object({
  assets: z.array(AssetItemSchema),
  hash: z.string(),
});

export type AssetItem = z.infer<typeof AssetItemSchema>;
export type AssetsResponse = z.infer<typeof AssetsResponseSchema>;

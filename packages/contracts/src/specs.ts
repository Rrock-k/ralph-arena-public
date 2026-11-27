import { z } from "zod";
import { SpecItemSchema } from "./common.js";

export const SpecsResponseSchema = z.object({
  specs: z.array(SpecItemSchema),
  hash: z.string(),
});

export type SpecsResponse = z.infer<typeof SpecsResponseSchema>;

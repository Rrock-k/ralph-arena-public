import { z } from "zod";
import { SpecItemSchema } from "./common.js";
import { AssetItemSchema } from "./assets.js";

const InitRepoSchema = z.object({
  url: z.string(),
  baseBranch: z.string(),
  projectBranch: z.string(),
  runBranch: z.string().optional(),
});

export const RunnerRalphConfigSchema = z.object({
  visualWorkbench: z.object({
    visualEvidenceMode: z.enum(["required", "new_tasks_only"]),
    executorCaptureShell: z.object({
      mode: z.literal("allowlisted"),
      allowedServeCommands: z.tuple([z.literal("npm run visual-workbench")]),
      allowedBaseUrlEnv: z.tuple([z.literal("VISUAL_WORKBENCH_BASE_URL")]),
    }).strict(),
  }).strict(),
}).strict();

export const InitResponseSchema = z.object({
  repo: InitRepoSchema.nullable(),
  proposal: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
  }).optional(),
  specs: z.array(SpecItemSchema),
  specsHash: z.string(),
  assets: z.array(AssetItemSchema).default([]),
  assetsHash: z.string().default(""),
  secrets: z.record(z.string(), z.string()),
  project: z.object({
    id: z.string(),
    name: z.string().optional(),
    hasPendingLoopWork: z.boolean().optional(),
    agent: z.string(),
    agentImpl: z.string(),
    model: z.string().nullable(),
    providerBillingMode: z.string().nullable().optional(),
    commitSha: z.string().nullable().optional(),
    agentIntent: z.enum(["ON", "OFF"]).optional(),
  }),
  capabilities: z.array(z.string()).optional(),
  commandTemplate: z.string().nullable(),
  loopSource: z.object({
    url: z.string(),
    ref: z.string().optional(),
    installCommand: z.string().optional(),
  }).nullable().optional(),
  ralphConfig: RunnerRalphConfigSchema.nullable().optional(),
  platformPrompt: z.string().nullable().optional(),
});

export type InitResponse = z.infer<typeof InitResponseSchema>;
export type RunnerRalphConfig = z.infer<typeof RunnerRalphConfigSchema>;

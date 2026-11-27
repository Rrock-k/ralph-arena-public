import { z } from 'zod';
import type { ScreenshotProofTarget } from '../config/types.js';

export const VISUAL_SCENARIO_SCHEMA_VERSION = 'ra-355.visual-scenario.v1' as const;

const LocalRouteSchema = z.string()
  .min(1)
  .refine((value) => value.startsWith('/'), 'Route must be local and start with /.')
  .refine((value) => !value.startsWith('//'), 'Route must not be protocol-relative.')
  .refine((value) => !value.includes('\\'), 'Route must not contain backslashes.')
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value), 'Route must not contain control characters.')
  .refine((value) => {
    try {
      const parsed = new URL(value, 'http://arena.local');
      return parsed.origin === 'http://arena.local';
    } catch {
      return false;
    }
  }, 'Route must be parseable as a local route.');

const VisualScenarioTargetSchema = z.object({
  route: LocalRouteSchema,
  viewport: z.object({
    width: z.number().int().min(1).max(10_000),
    height: z.number().int().min(1).max(10_000),
  }).strict(),
  claim: z.string().min(1).max(500).refine((value) => value.trim().length > 0, 'Claim must include non-whitespace text.'),
  state: z.string().max(500).optional(),
  interaction: z.string().max(500).optional(),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).optional(),
}).strict();

export const VisualScenarioSchema = z.object({
  schemaVersion: z.literal(VISUAL_SCENARIO_SCHEMA_VERSION),
  scenarioId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/),
  projectClass: z.literal('ordinary_web'),
  name: z.string().min(1).max(200).optional(),
  target: VisualScenarioTargetSchema,
}).strict();

export type VisualScenario = z.infer<typeof VisualScenarioSchema>;
export type VisualScenarioTarget = VisualScenario['target'] & ScreenshotProofTarget;

export function parseVisualScenario(raw: unknown): VisualScenario {
  return VisualScenarioSchema.parse(raw);
}

export function visualScenarioTargetForScreenshotProof(scenario: VisualScenario): ScreenshotProofTarget {
  return scenario.target;
}

import type { Judgment, Phase } from '../config/types.js';
import { JudgmentSchema, PhaseSchema } from '../config/types.js';
import { extractTextFromStreamJson } from '../utils/stream-json.js';

export interface PlannerParsedAgentOutput {
  phases: unknown[];
  judgments: unknown[];
  projectGoal?: string;
  feedbackDispositions?: unknown[];
}

export interface PlannerValidatedAgentOutput {
  phases: Phase[];
  judgments: Judgment[];
  projectGoal?: string;
  feedbackDispositions?: unknown[];
}

/**
 * Parse the planner agent output without applying it to PlanManager.
 *
 * This is the shared parsing boundary used by both the production planner and
 * the RA-356 planner_prompt_io lab stage so the lab does not grow a second
 * interpretation of planner JSON.
 */
export function parsePlannerAgentOutput(rawOutput: string): PlannerParsedAgentOutput {
  const output = extractTextFromStreamJson(rawOutput);

  const fencedMatch = output.match(/```json\s*\n([\s\S]*?)```/);
  let jsonStr: string | null = fencedMatch ? fencedMatch[1].trim() : null;

  if (!jsonStr) {
    const phasesIdx = output.indexOf('"phases"');
    if (phasesIdx !== -1) {
      const braceStart = output.lastIndexOf('{', phasesIdx);
      if (braceStart !== -1) {
        let depth = 0;
        for (let i = braceStart; i < output.length; i += 1) {
          if (output[i] === '{') depth += 1;
          if (output[i] === '}') depth -= 1;
          if (depth === 0) {
            jsonStr = output.slice(braceStart, i + 1);
            break;
          }
        }
      }
    }
  }

  if (!jsonStr) {
    const braceStart = output.indexOf('{');
    const braceEnd = output.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = output.slice(braceStart, braceEnd + 1);
    }
  }

  if (!jsonStr) {
    throw new Error(`Planner: could not find JSON output from agent. Extracted text:\n${output.slice(0, 1000)}`);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.phases || !Array.isArray(parsed.phases)) {
      throw new Error('Missing "phases" array in planner output');
    }

    return {
      phases: parsed.phases,
      judgments: parsed.judgments || [],
      projectGoal: typeof parsed.projectGoal === 'string' ? parsed.projectGoal : undefined,
      feedbackDispositions: Array.isArray(parsed.feedbackDispositions) ? parsed.feedbackDispositions : [],
    };
  } catch (error: any) {
    throw new Error(`Planner: failed to parse JSON output: ${error.message}\nJSON string (first 500 chars):\n${jsonStr.slice(0, 500)}`);
  }
}

export function validatePlannerAgentOutput(rawOutput: string): PlannerValidatedAgentOutput {
  const parsed = parsePlannerAgentOutput(rawOutput);
  return validatePlannerParsedAgentOutput(parsed);
}

export function validatePlannerParsedAgentOutput(parsed: PlannerParsedAgentOutput): PlannerValidatedAgentOutput {
  return {
    phases: parsed.phases.map((phase) => PhaseSchema.parse(phase)),
    judgments: parsed.judgments.map((judgment) => JudgmentSchema.parse(normalizePlannerJudgment(judgment))),
    projectGoal: parsed.projectGoal,
    feedbackDispositions: parsed.feedbackDispositions ?? [],
  };
}

function normalizePlannerJudgment(judgment: unknown): unknown {
  if (!judgment || typeof judgment !== 'object' || Array.isArray(judgment)) {
    return judgment;
  }
  if ('madeBy' in judgment) {
    return judgment;
  }
  return {
    ...judgment,
    madeBy: 'planner',
  };
}

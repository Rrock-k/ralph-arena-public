import type { ControllerReport, Judgment, PlanChange, RevisedJudgment } from '../config/types.js';
import {
  ControllerReportSchema,
  JudgmentSchema,
  PlanChangeSchema,
  RevisedJudgmentSchema,
} from '../config/types.js';
import { extractTextFromStreamJson } from '../utils/stream-json.js';

export interface ParsedControllerAgentReport {
  report: ControllerReport;
  rawReport: Record<string, unknown>;
  jsonString: string;
}

export function parseControllerAgentReport(
  rawOutput: string,
  input: {
    trigger: ControllerTrigger;
    reportId: string;
    timestamp: string;
    onWarning?: (message: string) => void;
  },
): ParsedControllerAgentReport {
  const { rawReport, jsonString } = extractControllerAgentReportJson(rawOutput);

  const report: ControllerReport = {
    id: input.reportId,
    timestamp: input.timestamp,
    trigger: input.trigger,
    verdict: parseControllerVerdict(rawReport.verdict),
    summary: typeof rawReport.summary === 'string' ? rawReport.summary : '',
    planChanges: parseAgentPlanChanges(rawReport.planChanges),
    newJudgments: parseAgentJudgments(rawReport.newJudgments),
    revisedJudgments: parseAgentRevisedJudgments(rawReport.revisedJudgments),
    feedbackMatrix: [],
    overclaimWarnings: parseAgentOverclaimWarnings(rawReport.overclaimWarnings, input.onWarning),
  };

  return {
    report: ControllerReportSchema.parse(report),
    rawReport,
    jsonString,
  };
}

type ControllerTrigger = ControllerReport['trigger'];

function parseControllerVerdict(value: unknown): ControllerReport['verdict'] {
  return value === 'revise' || value === 'escalate' || value === 'continue'
    ? value
    : 'continue';
}

export function extractControllerAgentReportJson(rawOutput: string): {
  rawReport: Record<string, unknown>;
  jsonString: string;
} {
  const output = extractTextFromStreamJson(rawOutput);
  const fencedMatch = output.match(/```json\s*\n([\s\S]*?)```/);
  let jsonString = fencedMatch ? fencedMatch[1].trim() : null;

  if (!jsonString) {
    const verdictIdx = output.indexOf('"verdict"');
    if (verdictIdx !== -1) {
      let start = verdictIdx;
      while (start > 0 && output[start] !== '{') start -= 1;
      if (output[start] === '{') {
        let depth = 0;
        for (let i = start; i < output.length; i += 1) {
          if (output[i] === '{') depth += 1;
          else if (output[i] === '}') {
            depth -= 1;
            if (depth === 0) {
              jsonString = output.slice(start, i + 1);
              break;
            }
          }
        }
      }
    }
  }

  if (!jsonString) {
    const braceStart = output.indexOf('{');
    const braceEnd = output.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonString = output.slice(braceStart, braceEnd + 1);
    }
  }

  if (!jsonString) {
    throw new Error('Could not find JSON in controller output');
  }

  const rawReport = JSON.parse(jsonString);
  if (!rawReport || typeof rawReport !== 'object' || Array.isArray(rawReport)) {
    throw new Error('Controller output JSON must be an object');
  }

  return {
    rawReport: rawReport as Record<string, unknown>,
    jsonString,
  };
}

function parseAgentPlanChanges(rawChanges: unknown): PlanChange[] {
  if (!Array.isArray(rawChanges)) return [];
  return rawChanges.map((change, index) => {
    const parsed = PlanChangeSchema.safeParse(change);
    if (!parsed.success) {
      throw new Error(`Controller report rejected invalid planChanges[${index}]: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}

function parseAgentJudgments(rawJudgments: unknown): Judgment[] {
  if (!Array.isArray(rawJudgments)) return [];
  return rawJudgments
    .filter((judgment): judgment is Record<string, unknown> => judgment != null && typeof judgment === 'object' && !Array.isArray(judgment))
    .map((judgment) => {
      const safeJudgment = { ...judgment };
      delete safeJudgment.publicAssumption;
      return JudgmentSchema.parse(safeJudgment);
    });
}

function parseAgentRevisedJudgments(rawRevisions: unknown): RevisedJudgment[] {
  if (!Array.isArray(rawRevisions)) return [];
  return rawRevisions.flatMap((revision) => {
    const parsed = RevisedJudgmentSchema.safeParse(revision);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseAgentOverclaimWarnings(
  rawWarnings: unknown,
  onWarning?: (message: string) => void,
): string[] {
  if (!Array.isArray(rawWarnings)) return [];

  const warnings: string[] = [];
  let normalized = 0;
  let ignored = 0;
  for (const rawWarning of rawWarnings) {
    if (typeof rawWarning === 'string') {
      const trimmed = rawWarning.trim();
      if (trimmed.length > 0) warnings.push(trimmed);
      continue;
    }

    if (rawWarning && typeof rawWarning === 'object') {
      const record = rawWarning as Record<string, unknown>;
      const scope = typeof record.scope === 'string' ? record.scope.trim() : '';
      const warning = typeof record.warning === 'string'
        ? record.warning.trim()
        : typeof record.message === 'string'
          ? record.message.trim()
          : typeof record.summary === 'string'
            ? record.summary.trim()
            : '';
      if (warning.length > 0) {
        warnings.push(scope.length > 0 ? `${scope}: ${warning}` : warning);
        normalized += 1;
        continue;
      }
    }

    ignored += 1;
  }

  if (normalized > 0) {
    onWarning?.(`Controller: normalized ${normalized} model-supplied overclaimWarnings object(s) to strings`);
  }
  if (ignored > 0) {
    onWarning?.(`Controller: ignored ${ignored} invalid model-supplied overclaimWarnings item(s)`);
  }
  return warnings;
}

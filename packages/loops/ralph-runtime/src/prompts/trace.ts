import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { getModelPricing } from '@arena/contracts';
import type { AgentResult } from '../config/types.js';
import type { PromptOwner } from './repository.js';

export const PROMPT_TRACE_SCHEMA_VERSION = 'ra-290.prompt-trace.v1' as const;
export const PROMPT_TRACE_RELATIVE_PATH = '.ralph/prompt-trace.jsonl' as const;

export type PromptTraceEventType = 'model_call';
export type PromptTraceVisibility = 'admin_raw';
export type PromptTraceParseStatus = 'not_recorded' | 'ok' | 'error';

export type PromptTraceContextValue = string | number | boolean | null;

export interface PromptTraceUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  apiEquivalentCostUsd: number;
  inputCostUsd: number;
  outputCostUsd: number;
  pricingSource: '@arena/contracts';
}

export interface PromptTraceEvent {
  schemaVersion: typeof PROMPT_TRACE_SCHEMA_VERSION;
  eventId: string;
  timestamp: string;
  eventType: PromptTraceEventType;
  promptId: string;
  owner: PromptOwner;
  label: string;
  model?: string;
  success: boolean;
  context: Record<string, PromptTraceContextValue>;
  prompt: {
    visibility: PromptTraceVisibility;
    charCount: number;
    text: string;
  };
  output: {
    visibility: PromptTraceVisibility;
    charCount: number;
    text: string;
  };
  parse: {
    status: PromptTraceParseStatus;
    summary?: string;
  };
  usage?: PromptTraceUsage;
}

export interface PromptModelCallTraceInput {
  promptId: string;
  owner: PromptOwner;
  label: string;
  prompt: string;
  result: Pick<AgentResult, 'success' | 'output' | 'usage'> | {
    success: boolean;
    output: string;
    usage?: AgentResult['usage'];
  };
  model?: string;
  context?: Record<string, PromptTraceContextValue | undefined>;
  parse?: {
    status?: PromptTraceParseStatus;
    summary?: string;
  };
}

export async function appendPromptModelCallTrace(
  workDir: string,
  input: PromptModelCallTraceInput,
): Promise<PromptTraceEvent> {
  const event: PromptTraceEvent = {
    schemaVersion: PROMPT_TRACE_SCHEMA_VERSION,
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    eventType: 'model_call',
    promptId: input.promptId,
    owner: input.owner,
    label: input.label,
    model: input.model,
    success: input.result.success,
    context: compactContext(input.context ?? {}),
    prompt: {
      visibility: 'admin_raw',
      charCount: input.prompt.length,
      text: input.prompt,
    },
    output: {
      visibility: 'admin_raw',
      charCount: input.result.output.length,
      text: input.result.output,
    },
    parse: {
      status: input.parse?.status ?? 'not_recorded',
      ...(input.parse?.summary ? { summary: input.parse.summary } : {}),
    },
    ...buildUsage(input.result.usage, input.model),
  };

  const tracePath = promptTracePath(workDir);
  await fs.ensureDir(path.dirname(tracePath));
  await fs.appendFile(tracePath, `${JSON.stringify(event)}\n`, 'utf-8');

  return event;
}

function buildUsage(
  usage: AgentResult['usage'] | undefined,
  model: string | undefined,
): { usage?: PromptTraceUsage } {
  if (!usage) return {};

  const { inputTokens, outputTokens, totalTokens } = usage;
  if (
    !isValidTokenCount(inputTokens)
    || !isValidTokenCount(outputTokens)
    || !isValidTokenCount(totalTokens)
  ) {
    throw new Error('Invalid prompt trace usage token counts');
  }

  const pricing = getModelPricing(model);
  const inputCostUsd = (inputTokens * pricing.inputPer1M) / 1_000_000;
  const outputCostUsd = (outputTokens * pricing.outputPer1M) / 1_000_000;

  return {
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      inputCostUsd,
      outputCostUsd,
      apiEquivalentCostUsd: inputCostUsd + outputCostUsd,
      pricingSource: '@arena/contracts',
    },
  };
}

function isValidTokenCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

export async function readPromptTraceEvents(workDir: string): Promise<PromptTraceEvent[]> {
  const tracePath = promptTracePath(workDir);
  if (!(await fs.pathExists(tracePath))) return [];

  const raw = await fs.readFile(tracePath, 'utf-8');
  const events: PromptTraceEvent[] = [];
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    events.push(parsePromptTraceLine(line, index + 1));
  }

  return events;
}

export function parsePromptTraceLine(line: string, lineNumber = 1): PromptTraceEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch (error: any) {
    throw new Error(`Invalid prompt trace JSON at line ${lineNumber}: ${error.message}`);
  }

  if (!isPromptTraceEvent(parsed)) {
    throw new Error(`Invalid prompt trace event at line ${lineNumber}`);
  }

  return parsed;
}

export function promptTracePath(workDir: string): string {
  return path.join(workDir, PROMPT_TRACE_RELATIVE_PATH);
}

function compactContext(
  context: Record<string, PromptTraceContextValue | undefined>,
): Record<string, PromptTraceContextValue> {
  const compacted: Record<string, PromptTraceContextValue> = {};

  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    compacted[key] = value;
  }

  return compacted;
}

function isPromptTraceEvent(value: unknown): value is PromptTraceEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PromptTraceEvent>;

  return (
    candidate.schemaVersion === PROMPT_TRACE_SCHEMA_VERSION &&
    typeof candidate.eventId === 'string' &&
    typeof candidate.timestamp === 'string' &&
    candidate.eventType === 'model_call' &&
    typeof candidate.promptId === 'string' &&
    typeof candidate.owner === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.success === 'boolean' &&
    isPromptText(candidate.prompt) &&
    isPromptText(candidate.output) &&
    Boolean(candidate.parse) &&
    typeof candidate.parse?.status === 'string' &&
    (candidate.usage === undefined || isPromptTraceUsage(candidate.usage))
  );
}

function isPromptText(value: unknown): value is PromptTraceEvent['prompt'] {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PromptTraceEvent['prompt']>;

  return (
    candidate.visibility === 'admin_raw' &&
    typeof candidate.charCount === 'number' &&
    typeof candidate.text === 'string'
  );
}

function isPromptTraceUsage(value: unknown): value is PromptTraceUsage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PromptTraceUsage>;

  return (
    typeof candidate.inputTokens === 'number' &&
    typeof candidate.outputTokens === 'number' &&
    typeof candidate.totalTokens === 'number' &&
    typeof candidate.apiEquivalentCostUsd === 'number' &&
    typeof candidate.inputCostUsd === 'number' &&
    typeof candidate.outputCostUsd === 'number' &&
    candidate.pricingSource === '@arena/contracts'
  );
}

import type { AgentUsage } from '../config/types.js';

export function extractAgentUsage(message: unknown): AgentUsage | null {
  const msg = message as {
    usage?: unknown;
    message?: { usage?: unknown };
    result?: { usage?: unknown };
  } | null;

  for (const candidate of [msg?.usage, msg?.message?.usage, msg?.result?.usage, msg]) {
    const usage = parseAgentUsageCandidate(candidate);
    if (usage) return usage;
  }

  return null;
}

function parseAgentUsageCandidate(candidate: unknown): AgentUsage | null {
  if (!candidate || typeof candidate !== 'object') return null;

  const record = candidate as Record<string, unknown>;
  const inputTokens = readNumber(record, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens');
  const outputTokens = readNumber(record, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens');
  const totalTokens = readNumber(record, 'total_tokens', 'totalTokens');

  if (inputTokens == null && outputTokens == null && totalTokens == null) return null;

  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: totalTokens ?? input + output,
  };
}

function readNumber(candidate: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

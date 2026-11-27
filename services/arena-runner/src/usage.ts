type ModelPricing = { inputPer1M: number; outputPer1M: number };

const MODEL_PRICING: Record<string, ModelPricing> = {
  // CLI aliases (auto-resolve to latest)
  "haiku": { inputPer1M: 1.00, outputPer1M: 5.00 },
  "sonnet": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "opus": { inputPer1M: 5.00, outputPer1M: 25.00 },
  "claude-haiku-4-5": { inputPer1M: 1.00, outputPer1M: 5.00 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1.00, outputPer1M: 5.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-opus-5": { inputPer1M: 5.00, outputPer1M: 25.00 },
  "claude-opus-4-8": { inputPer1M: 5.00, outputPer1M: 25.00 },
  "claude-opus-4-7": { inputPer1M: 5.00, outputPer1M: 25.00 },
  "claude-fable-5": { inputPer1M: 10.00, outputPer1M: 50.00 },
  // Legacy dated IDs
  "claude-sonnet-4-5-20250929": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-opus-4-6": { inputPer1M: 5.00, outputPer1M: 25.00 },
  "claude-sonnet-4-5-20250514": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "gpt-5-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.5": { inputPer1M: 5.00, outputPer1M: 30.00 },
  "gpt-5.3-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.3-codex-mini": { inputPer1M: 1.50, outputPer1M: 6.00 },
  "gpt-5.1-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.2-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.1-codex-mini": { inputPer1M: 1.50, outputPer1M: 6.00 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.00 },
  // RA-372: GPT-5.6 family. PROVISIONAL — no official per-token pricing yet;
  // mirrors the codex tier convention. Keep in sync with packages/contracts/src/pricing.ts.
  "gpt-5.6-sol": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.6-terra": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.6-luna": { inputPer1M: 1.50, outputPer1M: 6.00 },
  "glm-4.7-flash": { inputPer1M: 0, outputPer1M: 0 },
  "glm-4.7": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/big-pickle": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/deepseek-v4-flash-free": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/minimax-m3-free": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/nemotron-3-super-free": { inputPer1M: 0, outputPer1M: 0 },
};

const DEFAULT_MODEL_PRICING: ModelPricing = { inputPer1M: 3.00, outputPer1M: 15.00 };

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
}

function sumMatches(output: string, pattern: RegExp): ParsedUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;

  for (const match of output.matchAll(pattern)) {
    const inTokens = Number(match[1]?.replace(/,/g, ""));
    const outTokens = Number(match[2]?.replace(/,/g, ""));
    if (!Number.isFinite(inTokens) || !Number.isFinite(outTokens)) continue;
    inputTokens += inTokens;
    outputTokens += outTokens;
    found = true;
  }

  return found ? { inputTokens, outputTokens } : null;
}

export function parseUsageFromOutput(output: string): ParsedUsage | null {
  const legacyMarker = sumMatches(output, /\[tokens:\s*([\d,]+)\s*in\s*\/\s*([\d,]+)\s*out\]/gi);
  if (legacyMarker) return legacyMarker;

  const explicitSplit = sumMatches(
    output,
    /tokens used:\s*([\d,]+)\s*input(?:\s*\([^)]+\))?,\s*([\d,]+)\s*output/gi,
  );
  if (explicitSplit) return explicitSplit;

  // Newer Codex subscription CLI sometimes prints only a total usage line:
  //   tokens used
  //   21,150
  // We still need a non-null usage signal for budgeting/analytics.
  // Approximate the split using an 80/20 input/output ratio until the CLI
  // exposes structured per-direction counts again.
  const totalOnly = output.match(/tokens used\s*[\r\n]+\s*([\d,]+)/i);
  if (!totalOnly) return null;

  const totalTokens = Number(totalOnly[1]?.replace(/,/g, ""));
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;

  const inputTokens = Math.round(totalTokens * 0.8);
  const outputTokens = Math.max(0, totalTokens - inputTokens);
  return { inputTokens, outputTokens };
}

export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string | null | undefined,
): number {
  const pricing = model ? (MODEL_PRICING[model] ?? DEFAULT_MODEL_PRICING) : DEFAULT_MODEL_PRICING;
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

export function shouldParseSubscriptionUsage(agent: string, env: NodeJS.ProcessEnv): boolean {
  if (agent === "codex") return env.ARENA_CODEX_AUTH_MODE === "subscription";
  if (agent === "claude-code") return env.ARENA_CLAUDE_AUTH_MODE !== "api_key";
  if (agent === "antigravity") return false;
  if (agent === "opencode") return false;
  return false;
}

export function shouldTrackCliBudgetUsage(
  agent: string,
  env: NodeJS.ProcessEnv,
  providerBillingMode?: string | null,
): boolean {
  if (providerBillingMode === "platform_credits") {
    return false;
  }

  return shouldParseSubscriptionUsage(agent, env);
}

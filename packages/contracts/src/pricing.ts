/**
 * RA-042: Canonical model pricing table.
 * Single source of truth — imported by governance-platform and api-proxy.
 * Prices in USD per 1M tokens (input / output).
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude (Anthropic) — CLI aliases auto-resolve to latest version
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
  // Legacy dated IDs (for old projects in DB)
  "claude-sonnet-4-5-20250929": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-opus-4-6": { inputPer1M: 5.00, outputPer1M: 25.00 },
  "claude-sonnet-4-5-20250514": { inputPer1M: 3.00, outputPer1M: 15.00 },

  // Codex (OpenAI) — prices from developers.openai.com/api/docs/pricing
  "gpt-5-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.5": { inputPer1M: 5.00, outputPer1M: 30.00 },
  "gpt-5.3-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.3-codex-mini": { inputPer1M: 1.50, outputPer1M: 6.00 },
  "gpt-5.1-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.2-codex": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.1-codex-mini": { inputPer1M: 1.50, outputPer1M: 6.00 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.00 },
  // RA-372: GPT-5.6 agentic-coding family (sol/terra/luna).
  // PROVISIONAL — OpenAI has not published per-token pricing for these yet; the
  // catalog endpoint carries no cost fields. Values below mirror the codex tier
  // convention (frontier/balanced -> full-codex, affordable -> mini). Replace
  // with official numbers from developers.openai.com/api/docs/pricing when live.
  "gpt-5.6-sol": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.6-terra": { inputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-5.6-luna": { inputPer1M: 1.50, outputPer1M: 6.00 },

  // GLM (Z.AI free tier)
  "glm-4.7-flash": { inputPer1M: 0, outputPer1M: 0 },
  "glm-4.7": { inputPer1M: 0, outputPer1M: 0 },

  // OpenCode Zen free models
  "opencode/big-pickle": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/deepseek-v4-flash-free": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/minimax-m3-free": { inputPer1M: 0, outputPer1M: 0 },
  "opencode/nemotron-3-super-free": { inputPer1M: 0, outputPer1M: 0 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1M: 3.00, outputPer1M: 15.00 };

export function getModelPricing(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string | null | undefined,
): number {
  const pricing = getModelPricing(model);
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

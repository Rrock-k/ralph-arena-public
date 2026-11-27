/**
 * Parse token usage from Anthropic and OpenAI API responses.
 * Handles both streaming (SSE) and non-streaming responses.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

function extractOpenaiUsage(rawUsage: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  const usage = rawUsage as Record<string, unknown>;

  // Chat Completions: prompt_tokens / completion_tokens
  // Responses API: input_tokens / output_tokens
  const promptOrInput = typeof usage.prompt_tokens === "number"
    ? usage.prompt_tokens
    : (typeof usage.input_tokens === "number" ? usage.input_tokens : 0);
  const completionOrOutput = typeof usage.completion_tokens === "number"
    ? usage.completion_tokens
    : (typeof usage.output_tokens === "number" ? usage.output_tokens : 0);

  // No recognized fields at all
  if (
    typeof usage.prompt_tokens !== "number" &&
    typeof usage.input_tokens !== "number" &&
    typeof usage.completion_tokens !== "number" &&
    typeof usage.output_tokens !== "number"
  ) {
    return null;
  }

  return { inputTokens: promptOrInput, outputTokens: completionOrOutput };
}

/**
 * Parse usage from a non-streaming Anthropic response body.
 * Response shape: { usage: { input_tokens, output_tokens }, model, ... }
 */
export function parseAnthropicResponse(body: unknown): TokenUsage | null {
  if (!body || typeof body !== "object") return null;
  const msg = body as Record<string, unknown>;
  const usage = msg.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    model: typeof msg.model === "string" ? msg.model : null,
  };
}

/**
 * Parse usage from a non-streaming OpenAI response body.
 * Response shape: { usage: { prompt_tokens, completion_tokens }, model, ... }
 */
export function parseOpenaiResponse(body: unknown): TokenUsage | null {
  if (!body || typeof body !== "object") return null;
  const msg = body as Record<string, unknown>;
  const response = (msg.response && typeof msg.response === "object")
    ? msg.response as Record<string, unknown>
    : undefined;
  const usage = extractOpenaiUsage(msg.usage ?? response?.usage);
  if (!usage) return null;

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    model: typeof msg.model === "string"
      ? msg.model
      : (typeof response?.model === "string" ? response.model : null),
  };
}

/**
 * Parse usage from Anthropic SSE stream events.
 *
 * Anthropic streaming sends:
 * - event: message_start → data: { message: { usage: { input_tokens } } }
 * - event: message_delta → data: { usage: { output_tokens } }
 *
 * Note: message_delta.usage.output_tokens is cumulative (not incremental).
 */
export function parseAnthropicStreamEvents(buffer: string): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;

  // Parse SSE lines
  const lines = buffer.split("\n");
  let currentEvent = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      const dataStr = line.slice(6).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);

        if (currentEvent === "message_start" && data.message) {
          if (data.message.usage?.input_tokens) {
            inputTokens += data.message.usage.input_tokens;
          }
          if (data.message.model) {
            model = data.message.model;
          }
        } else if (currentEvent === "message_delta" && data.usage) {
          if (data.usage.output_tokens) {
            outputTokens = data.usage.output_tokens; // cumulative, not incremental
          }
        }
      } catch {
        // Skip unparseable data lines
      }
    }
  }

  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens, model };
}

/**
 * Parse usage from OpenAI SSE stream chunks.
 *
 * OpenAI streaming sends usage in the final chunk when stream_options.include_usage is true:
 * data: { ..., usage: { prompt_tokens, completion_tokens } }
 */
export function parseOpenaiStreamEvents(buffer: string): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string | null = null;

  const lines = buffer.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const dataStr = line.slice(6).trim();
    if (dataStr === "[DONE]") continue;

    try {
      const data = JSON.parse(dataStr) as Record<string, unknown>;
      const nestedResponse = (data.response && typeof data.response === "object")
        ? data.response as Record<string, unknown>
        : undefined;

      if (typeof data.model === "string" && !model) {
        model = data.model;
      }
      if (typeof nestedResponse?.model === "string" && !model) {
        model = nestedResponse.model;
      }

      const usage = extractOpenaiUsage(data.usage ?? nestedResponse?.usage);
      if (usage) {
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
      }
    } catch {
      // Skip
    }
  }

  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens, model };
}

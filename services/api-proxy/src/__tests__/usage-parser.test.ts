import { describe, it, expect } from "vitest";
import {
  parseAnthropicResponse,
  parseAnthropicStreamEvents,
  parseOpenaiResponse,
  parseOpenaiStreamEvents,
} from "../usage-parser.js";

// ── Anthropic non-streaming ──────────────────────────────────────────

describe("parseAnthropicResponse", () => {
  it("extracts usage from a standard response", () => {
    const body = {
      id: "msg_123",
      type: "message",
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 100, output_tokens: 250 },
    };
    expect(parseAnthropicResponse(body)).toEqual({
      inputTokens: 100,
      outputTokens: 250,
      model: "claude-sonnet-4-6",
    });
  });

  it("returns null for missing usage", () => {
    expect(parseAnthropicResponse({ id: "msg_1" })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(parseAnthropicResponse(null)).toBeNull();
    expect(parseAnthropicResponse(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseAnthropicResponse("string")).toBeNull();
    expect(parseAnthropicResponse(42)).toBeNull();
  });

  it("handles missing model gracefully", () => {
    const body = { usage: { input_tokens: 10, output_tokens: 20 } };
    const result = parseAnthropicResponse(body);
    expect(result).toEqual({ inputTokens: 10, outputTokens: 20, model: null });
  });
});

// ── Anthropic streaming ──────────────────────────────────────────────

describe("parseAnthropicStreamEvents", () => {
  it("extracts cumulative output_tokens correctly (not summing)", () => {
    // Anthropic sends cumulative output_tokens in message_delta events.
    // With 3 deltas reporting 50, 120, 200 — the final total should be 200 (not 370).
    const buffer = [
      "event: message_start",
      `data: {"type":"message_start","message":{"model":"claude-opus-4-7","usage":{"input_tokens":150}}}`,
      "",
      "event: content_block_delta",
      `data: {"type":"content_block_delta","delta":{"text":"Hello"}}`,
      "",
      "event: message_delta",
      `data: {"type":"message_delta","usage":{"output_tokens":50}}`,
      "",
      "event: message_delta",
      `data: {"type":"message_delta","usage":{"output_tokens":120}}`,
      "",
      "event: message_delta",
      `data: {"type":"message_delta","usage":{"output_tokens":200}}`,
      "",
    ].join("\n");

    const result = parseAnthropicStreamEvents(buffer);
    expect(result).toEqual({
      inputTokens: 150,
      outputTokens: 200, // cumulative, NOT 50+120+200=370
      model: "claude-opus-4-7",
    });
  });

  it("handles a single message_delta", () => {
    const buffer = [
      "event: message_start",
      `data: {"type":"message_start","message":{"model":"haiku","usage":{"input_tokens":80}}}`,
      "",
      "event: message_delta",
      `data: {"type":"message_delta","usage":{"output_tokens":40}}`,
      "",
    ].join("\n");

    expect(parseAnthropicStreamEvents(buffer)).toEqual({
      inputTokens: 80,
      outputTokens: 40,
      model: "haiku",
    });
  });

  it("returns null for empty buffer", () => {
    expect(parseAnthropicStreamEvents("")).toBeNull();
  });

  it("returns null when no usage events are present", () => {
    const buffer = [
      "event: content_block_start",
      `data: {"type":"content_block_start"}`,
      "",
      "event: content_block_delta",
      `data: {"type":"content_block_delta","delta":{"text":"hi"}}`,
      "",
    ].join("\n");
    expect(parseAnthropicStreamEvents(buffer)).toBeNull();
  });

  it("skips invalid JSON lines gracefully", () => {
    const buffer = [
      "event: message_start",
      `data: {"type":"message_start","message":{"model":"haiku","usage":{"input_tokens":10}}}`,
      "",
      "event: content_block_delta",
      "data: {INVALID JSON}",
      "",
      "event: message_delta",
      `data: {"type":"message_delta","usage":{"output_tokens":5}}`,
      "",
    ].join("\n");

    expect(parseAnthropicStreamEvents(buffer)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      model: "haiku",
    });
  });

  it("handles [DONE] marker", () => {
    const buffer = [
      "event: message_start",
      `data: {"type":"message_start","message":{"model":"haiku","usage":{"input_tokens":20}}}`,
      "",
      "event: message_delta",
      `data: {"type":"message_delta","usage":{"output_tokens":15}}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect(parseAnthropicStreamEvents(buffer)).toEqual({
      inputTokens: 20,
      outputTokens: 15,
      model: "haiku",
    });
  });
});

// ── OpenAI non-streaming ─────────────────────────────────────────────

describe("parseOpenaiResponse", () => {
  it("extracts usage from a standard response", () => {
    const body = {
      id: "chatcmpl-123",
      model: "gpt-5.3-codex",
      usage: { prompt_tokens: 200, completion_tokens: 300 },
    };
    expect(parseOpenaiResponse(body)).toEqual({
      inputTokens: 200,
      outputTokens: 300,
      model: "gpt-5.3-codex",
    });
  });

  it("returns null for missing usage", () => {
    expect(parseOpenaiResponse({ id: "chatcmpl-1" })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(parseOpenaiResponse(null)).toBeNull();
    expect(parseOpenaiResponse(undefined)).toBeNull();
  });

  it("extracts usage from Responses API format", () => {
    const body = {
      id: "resp_123",
      model: "gpt-5-codex",
      usage: { input_tokens: 123, output_tokens: 456 },
    };

    expect(parseOpenaiResponse(body)).toEqual({
      inputTokens: 123,
      outputTokens: 456,
      model: "gpt-5-codex",
    });
  });
});

// ── OpenAI streaming ─────────────────────────────────────────────────

describe("parseOpenaiStreamEvents", () => {
  it("extracts usage from the final chunk", () => {
    const buffer = [
      `data: {"id":"chatcmpl-1","model":"gpt-5.3-codex","choices":[{"delta":{"content":"Hi"}}]}`,
      `data: {"id":"chatcmpl-1","model":"gpt-5.3-codex","choices":[{"delta":{"content":" there"}}]}`,
      `data: {"id":"chatcmpl-1","model":"gpt-5.3-codex","choices":[],"usage":{"prompt_tokens":50,"completion_tokens":100}}`,
      "data: [DONE]",
      "",
    ].join("\n");

    expect(parseOpenaiStreamEvents(buffer)).toEqual({
      inputTokens: 50,
      outputTokens: 100,
      model: "gpt-5.3-codex",
    });
  });

  it("returns null for empty buffer", () => {
    expect(parseOpenaiStreamEvents("")).toBeNull();
  });

  it("returns null when no usage chunk is present", () => {
    const buffer = [
      `data: {"id":"chatcmpl-1","model":"gpt-5.3-codex","choices":[{"delta":{"content":"Hello"}}]}`,
      "data: [DONE]",
      "",
    ].join("\n");
    expect(parseOpenaiStreamEvents(buffer)).toBeNull();
  });

  it("skips invalid JSON lines gracefully", () => {
    const buffer = [
      "data: NOT_JSON",
      `data: {"id":"chatcmpl-1","model":"gpt-5.3-codex","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}`,
      "data: [DONE]",
      "",
    ].join("\n");

    expect(parseOpenaiStreamEvents(buffer)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      model: "gpt-5.3-codex",
    });
  });

  it("picks up model from first chunk when usage is in the last", () => {
    const buffer = [
      `data: {"id":"chatcmpl-1","model":"gpt-5-codex-mini","choices":[{"delta":{"content":"A"}}]}`,
      `data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":8}}`,
      "data: [DONE]",
      "",
    ].join("\n");

    expect(parseOpenaiStreamEvents(buffer)).toEqual({
      inputTokens: 5,
      outputTokens: 8,
      model: "gpt-5-codex-mini",
    });
  });

  it("extracts usage from Responses API completed event", () => {
    const buffer = [
      `data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5-codex"}}`,
      `data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5-codex","usage":{"input_tokens":12,"output_tokens":34}}}`,
      "data: [DONE]",
      "",
    ].join("\n");

    expect(parseOpenaiStreamEvents(buffer)).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      model: "gpt-5-codex",
    });
  });
});

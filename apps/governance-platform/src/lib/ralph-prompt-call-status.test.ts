import { describe, expect, it } from "vitest";

import {
  formatPromptCallRowTooltip,
  formatPromptCallStatusReason,
} from "./ralph-prompt-call-status";
import type { PromptTraceEvent } from "./ralph-prompt-traces";

describe("prompt call status copy", () => {
  it("surfaces Claude session limit in the first-screen tooltip", () => {
    const event = makeEvent({
      output: '{"type":"result","is_error":true,"result":"You\'ve hit your session limit · resets 4:10pm (UTC)"}',
      success: false,
    });

    expect(formatPromptCallStatusReason(event, "en")).toBe(
      "You've hit your session limit · resets 4:10pm (UTC)",
    );
    expect(formatPromptCallRowTooltip(event, "en")).toContain(
      "This is one model-call evidence item, not a project lifecycle verdict.",
    );
  });

  it("surfaces timeout failures without parsing full JSONL output", () => {
    const event = makeEvent({
      output: "Agent timed out after 15 minutes",
      success: false,
    });

    expect(formatPromptCallStatusReason(event, "ru")).toBe("Agent timed out after 15 minutes");
  });

  it("calls out TASK_COMPLETE when the agent result still recorded failure", () => {
    const event = makeEvent({
      context: { completionPromiseFound: true },
      output: "Work is done.\n<promise>TASK_COMPLETE</promise>",
      success: false,
    });

    expect(formatPromptCallStatusReason(event, "en")).toBe(
      "output contains TASK_COMPLETE, but provider/agent result recorded failure",
    );
  });
});

function makeEvent(overrides: {
  context?: PromptTraceEvent["context"];
  output?: string;
  success?: boolean;
} = {}): PromptTraceEvent {
  return {
    schemaVersion: "ra-290.prompt-trace.v1",
    eventId: "evt-test",
    timestamp: "2026-05-20T11:48:01.842Z",
    eventType: "model_call",
    promptId: "controller.audit",
    owner: "controller",
    label: "Controller audit",
    model: "claude-opus-4-6",
    success: overrides.success ?? true,
    context: overrides.context ?? {},
    prompt: {
      visibility: "admin_raw",
      charCount: 6,
      text: "prompt",
    },
    output: {
      visibility: "admin_raw",
      charCount: overrides.output?.length ?? 0,
      text: overrides.output ?? "",
    },
    parse: {
      status: overrides.success === false ? "error" : "ok",
      summary: overrides.success === false ? "agent call failed" : "verdict=continue",
    },
  };
}

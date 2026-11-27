import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRalphPromptTraceFile } from "./ralph-prompt-traces";

describe("Ralph prompt traces", () => {
  it("reads valid prompt trace events and reports malformed lines", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-trace-read-"));
    const tracePath = path.join(dir, "prompt-trace.jsonl");
    const event = {
      schemaVersion: "ra-290.prompt-trace.v1",
      eventId: "evt-1",
      timestamp: "2026-05-17T00:00:00.000Z",
      eventType: "model_call",
      promptId: "planner.initial",
      owner: "planner",
      label: "Initial plan",
      success: true,
      context: {},
      prompt: {
        visibility: "admin_raw",
        charCount: 6,
        text: "prompt",
      },
      output: {
        visibility: "admin_raw",
        charCount: 6,
        text: "output",
      },
      parse: {
        status: "ok",
      },
    };

    await writeFile(
      tracePath,
      `${JSON.stringify(event)}\n{"schemaVersion":"wrong"}\n`,
      "utf-8",
    );

    const trace = await readRalphPromptTraceFile(tracePath);

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0].promptId).toBe("planner.initial");
    expect(trace.errors).toEqual(["Invalid prompt trace event at line 2"]);
  });

  it("keeps only the latest events when limited", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-trace-limit-"));
    const tracePath = path.join(dir, "prompt-trace.jsonl");
    const makeEvent = (index: number) => ({
      schemaVersion: "ra-290.prompt-trace.v1",
      eventId: `evt-${index}`,
      timestamp: `2026-05-17T00:00:0${index}.000Z`,
      eventType: "model_call",
      promptId: "executor.agentPrompt",
      owner: "executor",
      label: "Executor prompt",
      success: true,
      context: {},
      prompt: {
        visibility: "admin_raw",
        charCount: 1,
        text: "p",
      },
      output: {
        visibility: "admin_raw",
        charCount: 1,
        text: "o",
      },
      parse: {
        status: "not_recorded",
      },
    });

    await writeFile(
      tracePath,
      [makeEvent(1), makeEvent(2), makeEvent(3)]
        .map((event) => JSON.stringify(event))
        .join("\n"),
      "utf-8",
    );

    const trace = await readRalphPromptTraceFile(tracePath, 2);

    expect(trace.events.map((event) => event.eventId)).toEqual(["evt-2", "evt-3"]);
  });
});

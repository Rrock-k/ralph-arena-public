import assert from "node:assert/strict";
import test from "node:test";
import { readPreviewGeneration } from "./preview-generation.js";

test("reads generation from the runner control endpoint", async () => {
  const calls: string[] = [];
  const result = await readPreviewGeneration("preview-project-1", {
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ generation: "source:refresh-7" }),
        text: async () => "",
      };
    },
  });
  assert.deepEqual(calls, ["http://preview-project-1:3999/__arena/preview-generation"]);
  assert.deepEqual(result, { ok: true, generation: "source:refresh-7" });
});

test("rejects an invalid generation payload", async () => {
  const result = await readPreviewGeneration("preview-project-1", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ generation: "" }),
      text: async () => "",
    }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid generation/);
});

test("reports an unavailable runner as a failed read", async () => {
  const result = await readPreviewGeneration("preview-project-1", {
    fetchImpl: async () => { throw new Error("connect ECONNREFUSED"); },
  });
  assert.deepEqual(result, { ok: false, error: "connect ECONNREFUSED" });
});

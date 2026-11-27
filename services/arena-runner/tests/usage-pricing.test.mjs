import test from "node:test";
import assert from "node:assert/strict";

import { calculateCostUsd } from "../dist/usage.js";

test("calculates cost for GPT-5.5", () => {
  assert.equal(Number(calculateCostUsd(1_000_000, 1_000_000, "gpt-5.5").toFixed(6)), 35);
});

test("calculates cost for Claude Opus 4.8", () => {
  assert.equal(Number(calculateCostUsd(1_000_000, 1_000_000, "claude-opus-4-8").toFixed(6)), 30);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { AgentResult } from "../config/types.js";
import type { AgentOptions } from "./base.js";
import { BaseAgent } from "./base.js";

class TestAgent extends BaseAgent {
  name = "test-agent";

  async execute(_options: AgentOptions): Promise<AgentResult> {
    return {
      success: true,
      output: "",
      filesChanged: [],
      completionPromiseFound: false,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getVersion(): Promise<string> {
    return "test";
  }

  parseRetryAtForTest(message: string): Date | null {
    return this.parseRetryAt(message);
  }
}

function formatLocalWallClock(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${meridiem}`;
}

test("BaseAgent keeps just-expired time-only reset hints due instead of pushing them to tomorrow", () => {
  const agent = new TestAgent();
  const now = new Date();
  const justExpired = new Date(now.getTime() - 60_000);
  const retryAt = agent.parseRetryAtForTest(`You've hit your usage limit. Try again at ${formatLocalWallClock(justExpired)}.`);

  assert.ok(retryAt);
  assert.ok(retryAt.getTime() <= now.getTime());
  assert.ok(now.getTime() - retryAt.getTime() < 5 * 60 * 1000);
});

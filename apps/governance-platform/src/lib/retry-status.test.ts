import { describe, expect, it } from "vitest";
import { formatRetryHint, formatRetryHintTooltip, getRetryHint } from "./retry-status";

describe("formatRetryHint", () => {
  it("formats an explicit retryAt date", () => {
    const retryAt = new Date("2026-04-18T12:34:00.000Z");
    expect(formatRetryHint(retryAt)).toContain("Next auto-retry:");
  });

  it("accepts an ISO retryAt string", () => {
    expect(formatRetryHint("2026-04-18T12:34:00.000Z")).toContain("Next auto-retry:");
  });

  it("provides a UTC tooltip alongside the local retry label", () => {
    const hint = getRetryHint("2026-04-18T12:34:00.000Z");
    expect(hint?.label).toContain("Next auto-retry:");
    expect(hint?.utcTooltip).toBe("UTC: 18/04/2026, 12:34:00 UTC");
    expect(formatRetryHintTooltip("2026-04-18T12:34:00.000Z")).toBe(
      "UTC: 18/04/2026, 12:34:00 UTC",
    );
  });

  it("returns null for empty or invalid retryAt", () => {
    expect(formatRetryHint(null)).toBeNull();
    expect(formatRetryHintTooltip(null)).toBeNull();
    expect(formatRetryHint("not-a-date")).toBeNull();
  });
});

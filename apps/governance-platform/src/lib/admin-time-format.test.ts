import { describe, expect, it } from "vitest";
import { formatAdminShortTimestamp } from "./admin-time-format";

describe("formatAdminShortTimestamp", () => {
  it("formats UTC midnight with the h23 hour cycle", () => {
    expect(formatAdminShortTimestamp("2026-06-03T00:43:00.000Z")).toBe(
      "6/3, 00:43",
    );
  });

  it("formats UTC evening times without locale-dependent meridiem text", () => {
    expect(formatAdminShortTimestamp(new Date("2026-06-03T23:05:00.000Z"))).toBe(
      "6/3, 23:05",
    );
  });

  it("rejects invalid timestamps instead of rendering synthetic text", () => {
    expect(() => formatAdminShortTimestamp("not-a-date")).toThrow(RangeError);
  });
});

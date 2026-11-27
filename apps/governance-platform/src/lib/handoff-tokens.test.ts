import { describe, it, expect, vi, beforeEach } from "vitest";

// Must import after mocking
vi.mock("crypto", () => ({
  randomBytes: vi.fn(() => ({
    toString: () => "aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233",
  })),
}));

import { createHandoffCode, exchangeHandoffCode } from "./handoff-tokens";

const testUser = { id: "user-1", email: "test@example.com" };

describe("handoff-tokens", () => {
  it("should create and exchange a code successfully", () => {
    const code = createHandoffCode("project-1", testUser);
    expect(code).toBeTruthy();

    const result = exchangeHandoffCode(code, "project-1");
    expect(result).toEqual({
      userId: "user-1",
      email: "test@example.com",
    });
  });

  it("should reject reuse of the same code (single-use)", () => {
    const code = createHandoffCode("project-2", testUser);
    exchangeHandoffCode(code, "project-2"); // first use
    const result = exchangeHandoffCode(code, "project-2"); // second use
    expect(result).toBeNull();
  });

  it("should reject code for wrong project", () => {
    const code = createHandoffCode("project-3", testUser);
    const result = exchangeHandoffCode(code, "project-other");
    expect(result).toBeNull();
  });

  it("should reject expired code", () => {
    vi.useFakeTimers();
    const code = createHandoffCode("project-4", testUser);

    // Advance time past TTL (60s)
    vi.advanceTimersByTime(61_000);

    const result = exchangeHandoffCode(code, "project-4");
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it("should reject unknown code", () => {
    const result = exchangeHandoffCode("nonexistent-code", "project-1");
    expect(result).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  getFreemiusCheckoutMode,
  readFreemiusEntityEnvironment,
  verifyFreemiusEntityEnvironment,
} from "./freemius-checkout-mode";

describe("Freemius checkout mode", () => {
  it("uses live checkout unless sandbox is explicitly requested", () => {
    expect(getFreemiusCheckoutMode(undefined)).toBe("live");
    expect(getFreemiusCheckoutMode("")).toBe("live");
    expect(getFreemiusCheckoutMode("live")).toBe("live");
    expect(getFreemiusCheckoutMode("sandbox")).toBe("sandbox");
  });

  it("rejects invalid checkout modes instead of silently falling back", () => {
    expect(() => getFreemiusCheckoutMode("test")).toThrow(
      "FREEMIUS_CHECKOUT_MODE must be either live or sandbox",
    );
  });

  it("reads Freemius license environment values", () => {
    expect(readFreemiusEntityEnvironment({ environment: 0 })).toBe("live");
    expect(readFreemiusEntityEnvironment({ environment: "0" })).toBe("live");
    expect(readFreemiusEntityEnvironment({ environment: 1 })).toBe("sandbox");
    expect(readFreemiusEntityEnvironment({ environment: "1" })).toBe("sandbox");
    expect(readFreemiusEntityEnvironment({})).toBeNull();
  });

  it("requires the license environment to match the Arena checkout mode", () => {
    expect(verifyFreemiusEntityEnvironment({ environment: 0 }, "live")).toEqual({
      ok: true,
      environment: "live",
      mode: "live",
    });

    expect(verifyFreemiusEntityEnvironment({ environment: 1 }, "live")).toEqual({
      ok: false,
      error: "Freemius sandbox license cannot grant credits while Arena checkout mode is live.",
      environment: "sandbox",
      mode: "live",
    });
  });
});

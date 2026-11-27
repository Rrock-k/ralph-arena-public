import { afterEach, describe, expect, it } from "vitest";
import { applyPlatformCreditsAuth } from "../proxy.js";

describe("platform credits proxy auth", () => {
  const originalOpenaiKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalOpenaiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenaiKey;
    }
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  });

  it("overrides dummy OpenAI container auth with api-proxy platform auth", () => {
    process.env.OPENAI_API_KEY = "sk-platform";
    const headers = { authorization: "Bearer arena-proxy" };

    expect(applyPlatformCreditsAuth("openai", headers)).toBe(true);
    expect(headers).toEqual({ authorization: "Bearer sk-platform" });
  });

  it("overrides dummy Anthropic container auth with api-proxy platform auth", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform";
    const headers = { "x-api-key": "arena-proxy", authorization: "Bearer ignored" };

    expect(applyPlatformCreditsAuth("anthropic", headers)).toBe(true);
    expect(headers).toEqual({ "x-api-key": "sk-ant-platform" });
  });

  it("fails closed when the api-proxy provider key is missing", () => {
    process.env.OPENAI_API_KEY = "";
    const headers = { authorization: "Bearer arena-proxy" };

    expect(applyPlatformCreditsAuth("openai", headers)).toBe(false);
    expect(headers).toEqual({ authorization: "Bearer arena-proxy" });
  });

});

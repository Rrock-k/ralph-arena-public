import { describe, expect, it } from "vitest";
import {
  resolveDefaultLoopId,
  resolveDefaultModelId,
  resolveDefaultToolId,
  resolveLatestModelId,
} from "./launch-defaults";

describe("launch defaults", () => {
  it("prefers Ralph as the default launch loop", () => {
    expect(resolveDefaultLoopId([
      { id: "dummy-loop", name: "dummy" },
      { id: "ralph-loop", name: "ralph" },
    ])).toBe("ralph-loop");
  });

  it("prefers Codex over legacy mapping defaults", () => {
    expect(resolveDefaultToolId([
      { tool: { id: "claude-tool", name: "claude-code" }, mapping: { isDefault: true } },
      { tool: { id: "codex-tool", name: "codex" }, mapping: { isDefault: false } },
    ])).toBe("codex-tool");
  });

  it("selects the newest GPT model instead of the stored tool default", () => {
    const models = [
      { id: "default", label: "GPT-5.1 Codex Mini", model: "gpt-5.1-codex-mini" },
      { id: "gpt-54", label: "GPT-5.4", model: "gpt-5.4" },
      { id: "gpt-55", label: "GPT-5.5", model: "gpt-5.5" },
      { id: "codex-53", label: "GPT-5.3 Codex", model: "gpt-5.3-codex" },
    ];

    expect(resolveLatestModelId(models)).toBe("gpt-55");
    expect(resolveDefaultModelId({
      models,
      defaultModelId: "default",
    })).toBe("gpt-55");
  });

  it("keeps the current model on relaunch when it is still available", () => {
    expect(resolveDefaultModelId({
      models: [
        { id: "gpt-55", label: "GPT-5.5", model: "gpt-5.5" },
        { id: "gpt-56", label: "GPT-5.6", model: "gpt-5.6" },
      ],
      currentModel: "gpt-5.5",
      defaultModelId: "gpt-56",
    })).toBe("gpt-55");
  });

  it("will move forward automatically when a newer GPT model is added", () => {
    expect(resolveLatestModelId([
      { id: "gpt-59", label: "GPT-5.9", model: "gpt-5.9" },
      { id: "gpt-510", label: "GPT-5.10", model: "gpt-5.10" },
      { id: "gpt-55-mini", label: "GPT-5.5 Mini", model: "gpt-5.5-mini" },
    ])).toBe("gpt-510");
  });
});

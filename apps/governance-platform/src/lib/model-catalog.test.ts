import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { envOverridesMatch, parseCatalogModelOptions, selectCatalogModel } from "./model-catalog";

describe("model catalog selection", () => {
  const rawModels = JSON.stringify([
    { id: "sonnet-4-5", label: "Sonnet 4.5", model: "claude-sonnet-4-5" },
    {
      id: "opus-4-8",
      label: "Opus 4.8",
      model: "claude-opus-4-8",
      envOverrides: { ANTHROPIC_MODEL_FAMILY: "opus" },
    },
  ]);

  it("parses registry model presets with ids, labels and env overrides", () => {
    expect(parseCatalogModelOptions(rawModels)).toEqual([
      {
        id: "sonnet-4-5",
        label: "Sonnet 4.5",
        model: "claude-sonnet-4-5",
        envOverrides: null,
      },
      {
        id: "opus-4-8",
        label: "Opus 4.8",
        model: "claude-opus-4-8",
        envOverrides: { ANTHROPIC_MODEL_FAMILY: "opus" },
      },
    ]);
  });

  it("selects a registered model by id", () => {
    expect(selectCatalogModel({
      rawModels,
      requestedModel: "opus-4-8",
    })).toMatchObject({
      success: true,
      model: "claude-opus-4-8",
      modelId: "opus-4-8",
      envOverrides: { ANTHROPIC_MODEL_FAMILY: "opus" },
    });
  });

  it("selects OpenCode MiniMax M3 from the registry by id", () => {
    const openCodeModels = JSON.stringify([
      { id: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash Free", model: "opencode/deepseek-v4-flash-free" },
      { id: "minimax-m3-free", label: "MiniMax M3 Free", model: "opencode/minimax-m3-free" },
    ]);

    expect(selectCatalogModel({
      rawModels: openCodeModels,
      requestedModel: "minimax-m3-free",
    })).toMatchObject({
      success: true,
      model: "opencode/minimax-m3-free",
      modelId: "minimax-m3-free",
      label: "MiniMax M3 Free",
      envOverrides: null,
    });
  });

  it("rejects models outside the registered current loop/tool catalog", () => {
    expect(selectCatalogModel({
      rawModels,
      requestedModel: "claude-fake-999",
    })).toEqual({
      success: false,
      error: "Selected model is not available for this tool and loop.",
    });
  });

  it("keeps env override matching exact and order-insensitive", () => {
    expect(envOverridesMatch(
      { B: "2", A: "1" },
      { A: "1", B: "2" },
    )).toBe(true);
    expect(envOverridesMatch(
      { A: "wrong" },
      { A: "1" },
    )).toBe(false);
  });
});

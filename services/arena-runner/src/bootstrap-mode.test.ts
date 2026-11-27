import { describe, expect, it } from "vitest";
import { resolveRunnerBootstrapMode } from "./bootstrap-mode.js";

describe("resolveRunnerBootstrapMode", () => {
  it("keeps explicit preview_only boots preview-only even when agent intent stays ON", () => {
    expect(resolveRunnerBootstrapMode("ON", "preview_only")).toBe("preview_only");
  });

  it("falls back to preview_only for old agent-off boots without stamped env mode", () => {
    expect(resolveRunnerBootstrapMode("OFF", undefined)).toBe("preview_only");
  });

  it("defaults live agent-intent ON boots to agent_run when no preview-only stamp exists", () => {
    expect(resolveRunnerBootstrapMode("ON", undefined)).toBe("agent_run");
  });
});

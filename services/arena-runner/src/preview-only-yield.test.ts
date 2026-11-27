import { describe, expect, it } from "vitest";

import { shouldYieldPreviewOnlyMissingBootstrapToAgent } from "./preview-only-yield.js";

describe("shouldYieldPreviewOnlyMissingBootstrapToAgent", () => {
  it("yields preview-only missing bootstrap when agent work is pending", () => {
    expect(shouldYieldPreviewOnlyMissingBootstrapToAgent({
      agentIntent: "ON",
      hasPendingLoopWork: true,
      previewStarted: false,
      previewReasonCode: "preview_start_missing",
    })).toBe(true);
  });

  it("keeps agent-off preview restore strict", () => {
    expect(shouldYieldPreviewOnlyMissingBootstrapToAgent({
      agentIntent: "OFF",
      hasPendingLoopWork: true,
      previewStarted: false,
      previewReasonCode: "preview_start_missing",
    })).toBe(false);
  });

  it("does not hide non-bootstrap preview failures", () => {
    expect(shouldYieldPreviewOnlyMissingBootstrapToAgent({
      agentIntent: "ON",
      hasPendingLoopWork: true,
      previewStarted: false,
      previewReasonCode: "preview_health_timeout",
    })).toBe(false);
  });
});

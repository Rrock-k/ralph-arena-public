import { describe, expect, it } from "vitest";
import {
  buildClaudeMdStamp,
  buildPlatformRules,
  resolveLoopContractMode,
} from "./platform-contract";

describe("platform contract rendering", () => {
  it("keeps direct loops on result.json completion", () => {
    const stamp = buildClaudeMdStamp("direct");
    const rules = buildPlatformRules({ mode: "direct", projectId: "project-1" });

    expect(stamp).toContain('write `{"status":"DEPLOYED"}` to `.arena/result.json`');
    expect(stamp).toContain('write `{"status":"CANCELED","pauseReason":"RATE_LIMIT","retryAt":"..."}`');
    expect(stamp).toContain("do not rely on runner log/quota guessing");
    expect(rules).toContain('Write `{"status":"DEPLOYED"}` to `.arena/result.json`');
    expect(rules).toContain('write `{"status":"CANCELED","pauseReason":"RATE_LIMIT","retryAt":"..."}`');
    expect(rules).toContain("runner does not infer `RATE_LIMIT` from provider quota probes");
    expect(stamp).toContain("ARENA_TELEGRAM_PREVIEW_URL");
    expect(stamp).toContain("ARENA_DATA_DIR");
    expect(rules).toContain("ARENA_TELEGRAM_PREVIEW_URL");
    expect(rules).toContain("`ARENA_DATA_DIR` is the canonical app runtime data directory");
    expect(rules).toContain("Unknown dirty files in `/workspace` block restore/recreate");
    expect(rules).toContain("Branch name: `arena/project-project-1`");
  });

  it("keeps Ralph executor away from result.json lifecycle writes", () => {
    const stamp = buildClaudeMdStamp("ralph");
    const rules = buildPlatformRules({ mode: "ralph", projectId: "project-1" });

    expect(stamp).not.toContain('write `{"status":"DEPLOYED"}` to `.arena/result.json`');
    expect(rules).not.toContain('Write `{"status":"DEPLOYED"}` to `.arena/result.json`');
    expect(stamp).toContain("Ralph runtime writes `.arena/result.json`");
    expect(stamp).toContain("ARENA_DATA_DIR");
    expect(rules).toContain("Current product executor tasks MUST NOT write");
    expect(rules).toContain("`ARENA_DATA_DIR` is the canonical app runtime data directory");
    expect(rules).toContain("Product executor tasks treat `.arena/platform.md`, `.arena/events.json`, `.arena/auth.json`, `.arena/stop-request.json`, `.arena/spec-input.json`, and other `.arena/` files as read-only platform inputs.");
    expect(rules).toContain("NEVER write anything into `.arena/` from product work");
    expect(rules).toContain("Ralph runtime commits task results");
  });

  it("detects Ralph loop mode from init data", () => {
    expect(resolveLoopContractMode({ agentImpl: "ralph", commandTemplate: null })).toBe("ralph");
    expect(resolveLoopContractMode({
      agentImpl: "direct",
      commandTemplate: "node /ralph/dist/index.js run --work-dir {workdir}",
    })).toBe("ralph");
    expect(resolveLoopContractMode({ agentImpl: "direct", commandTemplate: "node /arena/cycles/direct.js" })).toBe("direct");
  });
});

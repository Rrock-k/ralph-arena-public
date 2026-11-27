import { describe, expect, it } from "vitest";
import { getRalphLoopMap } from "./ralph-loop-map";

describe("Ralph loop map", () => {
  it("projects the runtime loop export into governance", () => {
    const map = getRalphLoopMap({
      generatedAt: "2026-05-18T00:00:00.000Z",
    });

    expect(map.schemaVersion).toBe("ra-308.ralph-loop-map.v3");
    expect(map.generatedAt).toBe("2026-05-18T00:00:00.000Z");
    expect(map.owner).toBe("packages/loops/ralph-runtime");
    expect(map.nodes.map((node) => node.id)).toEqual([
      "initialize",
      "plan",
      "control",
      "select_task",
      "build_prompt",
      "agent",
      "verify",
      "ship",
      "decide",
      "wait_for_specs",
    ]);
  });

  it("keeps stale UI-sketch branches represented in the runtime export", () => {
    const map = getRalphLoopMap({
      generatedAt: "2026-05-18T00:00:00.000Z",
    });

    expect(map.decisions.map((decision) => decision.id)).toContain("accepted_spec_changed");
    expect(map.decisions.map((decision) => decision.id)).toContain("new_specs_arrive");
    expect(map.nodes.find((node) => node.id === "ship")?.internals.map((internal) => internal.label)).toContain("local Docker preview");
    expect(map.nodes.find((node) => node.id === "control")?.internals.map((internal) => internal.label)).toContain("final controller");
  });
});

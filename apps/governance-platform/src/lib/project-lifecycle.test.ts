import { describe, expect, it } from "vitest";
import { getPrimaryLifecycleComponent, getPublicDisplayStatus } from "./project-lifecycle";

describe("getPrimaryLifecycleComponent", () => {
  it("returns the app component when present", () => {
    const component = getPrimaryLifecycleComponent({
      components: [
        { kind: "worker", runtimeState: "RUNNING" },
        { kind: "app", runtimeState: "ABSENT", previewUrl: "https://preview.example.com" },
      ],
    });

    expect(component).toEqual({
      kind: "app",
      runtimeState: "ABSENT",
      previewUrl: "https://preview.example.com",
    });
  });

  it("does not fall back to the first component when app kind is missing", () => {
    const component = getPrimaryLifecycleComponent({
      components: [
        { runtimeState: "RUNNING", previewUrl: "https://wrong.example.com" },
      ],
    });

    expect(component).toBeNull();
  });

  it("prefers explicit app truth when present", () => {
    const component = getPrimaryLifecycleComponent({
      app: { runtimeState: "RUNNING", previewUrl: "https://preview.example.com" },
      components: [
        { kind: "app", runtimeState: "ABSENT", previewUrl: "https://stale.example.com" },
      ],
    });

    expect(component).toEqual({
      runtimeState: "RUNNING",
      previewUrl: "https://preview.example.com",
    });
  });

  it("keeps blocker-bearing running rows paused in public display truth", () => {
    expect(getPublicDisplayStatus({
      app: {
        kind: "app",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: ["BUDGET"],
        previewHealth: "HEALTHY",
      },
    })).toBe("PAUSED");
  });
});

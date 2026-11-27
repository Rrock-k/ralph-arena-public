import { describe, expect, it } from "vitest";

import { buildRunLogActivity } from "./run-log-activity";

describe("buildRunLogActivity", () => {
  it("groups only adjacent repeated run log events", () => {
    const activity = buildRunLogActivity([
      log("auto-3", "AUTO-RETRY", "2026-06-27T01:36:07.000Z"),
      log("auto-2", "AUTO-RETRY", "2026-06-27T01:35:37.000Z"),
      log("running", "RUNNING", "2026-06-27T01:35:00.000Z"),
      log("auto-1", "AUTO-RETRY", "2026-06-27T01:34:37.000Z"),
    ]);

    expect(activity.groups).toEqual([
      expect.objectContaining({ id: "auto-3", event: "AUTO-RETRY", count: 2 }),
      expect.objectContaining({ id: "running", event: "RUNNING", count: 1 }),
      expect.objectContaining({ id: "auto-1", event: "AUTO-RETRY", count: 1 }),
    ]);
  });

  it("keeps expandable entries inside each group", () => {
    const activity = buildRunLogActivity([
      log("auto-2", "AUTO-RETRY", "2026-06-27T01:36:07.000Z"),
      log("auto-1", "AUTO-RETRY", "2026-06-27T01:35:37.000Z", JSON.stringify({ error: "rate limited" })),
    ]);

    expect(activity.groups[0]).toEqual(expect.objectContaining({
      count: 2,
      error: "rate limited",
      entries: [
        expect.objectContaining({ id: "auto-2", error: null }),
        expect.objectContaining({ id: "auto-1", error: "rate limited" }),
      ],
    }));
  });

  it("counts repeats in the last visible group before stopping", () => {
    const activity = buildRunLogActivity([
      log("running", "RUNNING", "2026-06-27T01:37:00.000Z"),
      log("auto-2", "AUTO-RETRY", "2026-06-27T01:36:07.000Z"),
      log("auto-1", "AUTO-RETRY", "2026-06-27T01:35:37.000Z"),
      log("paused", "PAUSED", "2026-06-27T01:34:00.000Z"),
    ], { maxGroups: 2 });

    expect(activity.groups).toEqual([
      expect.objectContaining({ event: "RUNNING", count: 1 }),
      expect.objectContaining({ event: "AUTO-RETRY", count: 2 }),
    ]);
    expect(activity.hasMore).toBe(true);
  });
});

function log(id: string, event: string, createdAt: string, detail: string | null = null) {
  return { id, event, createdAt, detail };
}

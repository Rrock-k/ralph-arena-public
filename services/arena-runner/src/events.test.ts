import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("./api.js", () => ({
  pushEvents: vi.fn(),
  fetchEvents: vi.fn(),
}));

import { readFileSync, writeFileSync, renameSync } from "fs";
import { fetchEvents, pushEvents } from "./api.js";
import { EventSync } from "./events.js";

describe("EventSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pushes legacy outgoing events through the versioned workspace schema", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify([
      {
        type: "test_request",
        payload: {
          title: "Homepage",
          steps: [{ question: "Loads?" }],
        },
      },
    ]) as any);
    vi.mocked(pushEvents).mockResolvedValue(undefined);

    const sync = new EventSync("/tmp/workspace");
    await (sync as any).pushOutgoing();

    expect(pushEvents).toHaveBeenCalledWith([
      {
        version: 1,
        type: "test_request",
        payload: {
          title: "Homepage",
          steps: [{ question: "Loads?" }],
        },
      },
    ]);
  });

  it("skips unsupported events without poisoning valid events or the cursor", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({
      events: [
        {
          id: "evt-valid",
          projectId: "project-1",
          direction: "in",
          type: "preview_refresh_requested",
          payload: { source: "admin", reason: "manual_refresh" },
          createdAt: "2026-08-03T10:00:00.000Z",
        },
        {
          id: "evt-unknown",
          projectId: "project-1",
          direction: "in",
          type: "context_question",
          payload: {},
          createdAt: "2026-08-03T10:01:00.000Z",
        },
      ],
    });
    vi.mocked(readFileSync).mockImplementation((target: any) => {
      if (String(target).endsWith("/events.json")) return "[]";
      throw new Error(`Unexpected read: ${String(target)}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const sync = new EventSync("/tmp/workspace");
    const listener = vi.fn();
    sync.addEventCallback(listener);

    await (sync as any).pollIncoming();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      id: "evt-valid",
      type: "preview_refresh_requested",
    }));
    expect((sync as any).lastPollTimestamp).toBe("2026-08-03T10:01:00.000Z");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("context_question"));
    const written = JSON.parse(String(vi.mocked(writeFileSync).mock.calls[0]?.[1]));
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe("evt-valid");

    warn.mockRestore();
  });

  it("advances past a batch containing only unsupported events", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({
      events: [
        {
          id: "evt-unknown",
          projectId: "project-1",
          direction: "in",
          type: "runtime_recreate_requested",
          payload: {},
          createdAt: "2026-08-03T11:00:00.000Z",
        },
      ],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const sync = new EventSync("/tmp/workspace");
    await (sync as any).pollIncoming();

    expect((sync as any).lastPollTimestamp).toBe("2026-08-03T11:00:00.000Z");
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("runtime_recreate_requested"));

    warn.mockRestore();
  });

  it("logs polling failures instead of silently retrying forever", async () => {
    vi.mocked(fetchEvents).mockRejectedValue(new Error("governance unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const sync = new EventSync("/tmp/workspace");
    await (sync as any).pollIncoming();

    expect(error).toHaveBeenCalledWith(
      "[runner] EventSync pollIncoming error: governance unavailable",
    );

    error.mockRestore();
  });

  it("dispatches incoming preview refresh events to registered callbacks", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({
      events: [
        {
          id: "evt-1",
          projectId: "project-1",
          direction: "in",
          type: "preview_refresh_requested",
          payload: { source: "admin", reason: "manual_refresh" },
          createdAt: "2026-04-23T01:00:00.000Z",
        },
      ],
    });
    vi.mocked(readFileSync).mockImplementation((target: any) => {
      if (String(target).endsWith("/events.json")) {
        return "[]";
      }
      throw new Error(`Unexpected read: ${String(target)}`);
    });

    const sync = new EventSync("/tmp/workspace");
    const listener = vi.fn();
    sync.addEventCallback(listener);

    await (sync as any).pollIncoming();

    expect(listener).toHaveBeenCalledWith({
      version: 1,
      id: "evt-1",
      projectId: "project-1",
      direction: "in",
      type: "preview_refresh_requested",
      payload: { source: "admin", reason: "manual_refresh" },
      createdAt: "2026-04-23T01:00:00.000Z",
    });
    expect(writeFileSync).toHaveBeenCalled();
    expect(renameSync).toHaveBeenCalled();
  });
});

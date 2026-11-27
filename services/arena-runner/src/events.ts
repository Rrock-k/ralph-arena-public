/**
 * RA-089: Event sync between agent and governance.
 *
 * Two loops:
 * - Outgoing: agent writes .arena/outgoing-events.json → runner pushes to governance
 * - Incoming: runner polls governance → writes .arena/events.json for agent to read
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import {
  PollEventsResponseSchema,
  ProjectEventSchema,
  WorkspaceIncomingEventBatchSchema,
  WorkspaceIncomingEventSchema,
  WorkspaceOutgoingEventBatchSchema,
  type WorkspaceIncomingEvent,
} from "@arena/contracts";
import { pushEvents, fetchEvents } from "./api.js";

const OUTGOING_POLL_MS = 5_000;
const INCOMING_POLL_MS = 30_000;
const MAX_INCOMING_EVENTS = 500;

export type EventCallback = (event: WorkspaceIncomingEvent) => void;

export class EventSync {
  private outTimer: ReturnType<typeof setInterval> | null = null;
  private inTimer: ReturnType<typeof setInterval> | null = null;
  private lastPushedIndex = 0;
  private lastPollTimestamp: string | null = null;
  private eventCallbacks = new Set<EventCallback>();

  private readonly arenaDir: string;
  private readonly outgoingPath: string;
  private readonly incomingPath: string;

  constructor(workDir: string) {
    this.arenaDir = join(workDir, ".arena");
    this.outgoingPath = join(this.arenaDir, "outgoing-events.json");
    this.incomingPath = join(this.arenaDir, "events.json");
  }

  /** Register a callback for specific incoming event types (e.g., qa_feedback_batch). */
  setEventCallback(cb: EventCallback): void {
    this.eventCallbacks.clear();
    this.eventCallbacks.add(cb);
  }

  addEventCallback(cb: EventCallback): () => void {
    this.eventCallbacks.add(cb);
    return () => {
      this.eventCallbacks.delete(cb);
    };
  }

  start(): void {
    mkdirSync(this.arenaDir, { recursive: true });

    // Initialize incoming file if it doesn't exist
    try {
      readFileSync(this.incomingPath, "utf-8");
    } catch {
      this.atomicWrite(this.incomingPath, "[]");
    }

    this.outTimer = setInterval(() => this.pushOutgoing(), OUTGOING_POLL_MS);
    this.inTimer = setInterval(() => this.pollIncoming(), INCOMING_POLL_MS);

    console.log("[runner] EventSync started");
  }

  /** Push any pending outgoing events without stopping the sync loops. */
  async flush(): Promise<void> {
    try {
      await this.pushOutgoing();
    } catch {
      // Best-effort
    }
  }

  async stop(): Promise<void> {
    if (this.outTimer) {
      clearInterval(this.outTimer);
      this.outTimer = null;
    }
    if (this.inTimer) {
      clearInterval(this.inTimer);
      this.inTimer = null;
    }
    await this.flush();
    console.log("[runner] EventSync stopped");
  }

  private async pushOutgoing(): Promise<void> {
    try {
      const raw = readFileSync(this.outgoingPath, "utf-8");
      const parsed = WorkspaceOutgoingEventBatchSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      const events = parsed.data;

      const newEvents = events.slice(this.lastPushedIndex);
      if (newEvents.length === 0) return;

      await pushEvents(newEvents);
      this.lastPushedIndex = events.length;
      console.log(`[runner] Pushed ${newEvents.length} outgoing event(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Suppress "no such file" (file not created yet), log everything else
      if (!msg.includes("ENOENT")) {
        console.error(`[runner] EventSync pushOutgoing error: ${msg}`);
      }
    }
  }

  private async pollIncoming(): Promise<void> {
    try {
      const data = PollEventsResponseSchema.parse(await fetchEvents(
        this.lastPollTimestamp ?? undefined,
        undefined, // all contract-supported types for agent
      ));

      if (!data.events.length) return;

      let observedCursor: string | null = null;
      const normalizedIncoming: WorkspaceIncomingEvent[] = [];
      const skipped: string[] = [];

      for (const [index, rawEvent] of data.events.entries()) {
        if (rawEvent && typeof rawEvent === "object") {
          const createdAt = (rawEvent as Record<string, unknown>).createdAt;
          if (typeof createdAt === "string") {
            observedCursor = createdAt;
          }
        }

        const parsedProjectEvent = ProjectEventSchema.safeParse(rawEvent);
        if (!parsedProjectEvent.success) {
          const rawType = rawEvent && typeof rawEvent === "object"
            ? (rawEvent as Record<string, unknown>).type
            : undefined;
          skipped.push(`${index}:${typeof rawType === "string" ? rawType : "invalid"}`);
          continue;
        }

        normalizedIncoming.push(WorkspaceIncomingEventSchema.parse(parsedProjectEvent.data));
      }

      if (skipped.length > 0) {
        console.warn(
          `[runner] EventSync skipped ${skipped.length} unsupported or invalid incoming event(s): ${skipped.join(", ")}`,
        );
      }

      if (!normalizedIncoming.length) {
        if (observedCursor) {
          this.lastPollTimestamp = observedCursor;
        }
        return;
      }

      // Read existing incoming events
      let existing: WorkspaceIncomingEvent[] = [];
      try {
        const parsedExisting = WorkspaceIncomingEventBatchSchema.safeParse(
          JSON.parse(readFileSync(this.incomingPath, "utf-8")),
        );
        existing = parsedExisting.success ? parsedExisting.data : [];
      } catch {
        existing = [];
      }

      // Append new events, keep only the most recent to prevent unbounded growth
      let merged = WorkspaceIncomingEventBatchSchema.parse([...existing, ...normalizedIncoming]);
      if (merged.length > MAX_INCOMING_EVENTS) {
        merged = merged.slice(-MAX_INCOMING_EVENTS);
      }
      this.atomicWrite(this.incomingPath, JSON.stringify(merged, null, 2));

      // Advance past the entire observed batch, including unsupported events.
      // If persistence fails, the outer catch leaves the cursor unchanged so
      // valid events are retried rather than lost.
      if (observedCursor) {
        this.lastPollTimestamp = observedCursor;
      }

      console.log(`[runner] Received ${normalizedIncoming.length} incoming event(s)`);

      // Notify callback for each new event
      if (this.eventCallbacks.size > 0) {
        for (const evt of normalizedIncoming) {
          for (const callback of this.eventCallbacks) {
            try {
              callback(evt);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error(`[runner] EventSync callback error: ${message}`);
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runner] EventSync pollIncoming error: ${message}`);
    }
  }

  private atomicWrite(path: string, content: string): void {
    const tmp = path + ".tmp";
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, path);
  }
}

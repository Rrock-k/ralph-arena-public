import { z } from "zod";

// ── Runner → Governance: log push payload ────────────────

export const LogChunkSchema = z.object({
  ts: z.number(),
  stream: z.enum(["stdout", "stderr"]),
  text: z.string(),
});

export type LogChunk = z.infer<typeof LogChunkSchema>;

export const LifecycleEventSchema = z.object({
  ts: z.number(),
  event: z.string(),
});

export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;

export const LogsRequestSchema = z.object({
  chunks: z.array(LogChunkSchema).min(1).optional(),
  lifecycle: z.array(LifecycleEventSchema).optional(),
}).refine(d => (d.chunks?.length ?? 0) > 0 || (d.lifecycle?.length ?? 0) > 0, {
  message: "At least one chunk or lifecycle event required",
});

export type LogsRequest = z.infer<typeof LogsRequestSchema>;

// ── JSONL line types (stored in Project.log, parsed by client) ──

export const LogEntrySchema = z.object({ ts: z.number(), text: z.string() });
export const LifecycleEntrySchema = z.object({ ts: z.number(), lc: z.string() });

export type LogEntry = z.infer<typeof LogEntrySchema>;
export type LifecycleEntry = z.infer<typeof LifecycleEntrySchema>;
export type LogLine = LogEntry | LifecycleEntry;

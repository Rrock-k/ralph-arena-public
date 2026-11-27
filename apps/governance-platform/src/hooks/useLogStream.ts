"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── JSONL log line types (mirrors @arena/contracts LogLine) ──

export type LogEntry = { ts: number; text: string };
export type LifecycleEntry = { ts: number; lc: string };
export type LogLine = LogEntry | LifecycleEntry;

export function isLifecycleEntry(line: LogLine): line is LifecycleEntry {
  return "lc" in line;
}

/** Parse JSONL text into LogLine array. Returns null if legacy plain text. */
export function parseJsonlText(text: string): LogLine[] | null {
  return parseJsonl(text);
}

/** Normalize epoch timestamp — auto-detect seconds vs milliseconds. */
function normalizeTs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

function parseJsonl(text: string): LogLine[] | null {
  if (!text) return null;
  const lines: LogLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw || raw[0] !== "{") continue; // skip non-JSON lines (legacy text mixed in)
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.ts === "number" && (typeof parsed.text === "string" || typeof parsed.lc === "string")) {
        parsed.ts = normalizeTs(parsed.ts);
        lines.push(parsed);
      }
    } catch {
      // skip malformed lines
    }
  }
  if (!lines.length) return null; // no valid JSONL found → treat as legacy
  return lines.length > 0 ? lines : null;
}

// ── Hook ──

interface UseLogStreamOptions {
  projectId: string | null;
  enabled?: boolean;
}

export function useLogStream({ projectId, enabled = true }: UseLogStreamOptions) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [legacyText, setLegacyText] = useState("");
  const [isLegacy, setIsLegacy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pinToBottom, setPinToBottom] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null!);

  // Reset when projectId changes
  useEffect(() => {
    setLines([]);
    setLegacyText("");
    setIsLegacy(false);
    setPinToBottom(true);
  }, [projectId]);

  // SSE connection
  useEffect(() => {
    if (!enabled || !projectId) return;

    const es = new EventSource(`/api/projects/${projectId}/logs/stream`);
    setConnected(true);

    es.addEventListener("catchup", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data.text) return;
        const parsed = parseJsonl(data.text);
        if (parsed) {
          setIsLegacy(false);
          setLines(parsed);
        } else {
          setIsLegacy(true);
          setLegacyText(data.text);
        }
      } catch { /* ignore */ }
    });

    es.addEventListener("log_chunk", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data.text) return;

        // Try parsing as JSONL first (even in legacy mode — backend may have upgraded mid-run)
        const newLines = parseJsonl(data.text);
        if (newLines) {
          setIsLegacy(false);
          setLines((prev) => [...prev, ...newLines]);
        } else {
          // Plain text chunk — append to legacy text
          setIsLegacy((legacy) => {
            setLegacyText((prev) => prev + data.text);
            return true;
          });
        }
      } catch { /* ignore */ }
    });

    es.onerror = () => setConnected(false);
    es.onopen = () => setConnected(true);

    return () => {
      es.close();
      setConnected(false);
    };
  }, [enabled, projectId]);

  // Auto-scroll — trigger on lines or legacyText change
  const scrollKey = isLegacy ? legacyText.length : lines.length;
  useEffect(() => {
    if (pinToBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [scrollKey, pinToBottom]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setPinToBottom(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  return { lines, legacyText, isLegacy, connected, pinToBottom, setPinToBottom, containerRef, handleScroll };
}

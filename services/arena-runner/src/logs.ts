/**
 * RA-083: Log batching and push for runner.
 * Captures stdout/stderr from child process and pushes to governance in batches.
 */

import { pushLogs, type LogChunk } from "./api.js";

const BATCH_INTERVAL_MS = 1500; // Push every 1.5s

type LogCollectorOptions = {
  streamLogs?: boolean;
  tailBytes?: number;
};

export class LogCollector {
  private buffer: LogChunk[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private tailLog = "";
  private lastActivityAt: number | null = null;
  private readonly streamLogs: boolean;
  private readonly tailBytes: number;

  constructor(options: LogCollectorOptions = {}) {
    this.streamLogs = options.streamLogs ?? true;
    this.tailBytes = Math.max(1024, options.tailBytes ?? 512 * 1024);
  }

  start(): void {
    if (!this.streamLogs) return;
    this.timer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final flush
    this.flush();
  }

  append(stream: "stdout" | "stderr", text: string): void {
    this.tailLog += text;
    if (this.tailLog.length > this.tailBytes) {
      this.tailLog = this.tailLog.slice(-this.tailBytes);
    }
    this.lastActivityAt = Date.now();
    if (this.streamLogs) {
      this.buffer.push({ ts: Date.now(), stream, text });
    }
  }

  getFullLog(): string {
    return this.tailLog;
  }

  getLastActivityAt(): number | null {
    return this.lastActivityAt;
  }

  private flush(): void {
    if (!this.buffer.length) return;
    const chunks = this.buffer.splice(0);
    pushLogs(chunks);
  }
}

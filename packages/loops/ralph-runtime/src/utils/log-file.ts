/**
 * Run-level log file writer.
 * 
 * Intercepts process.stdout and process.stderr at the lowest level
 * so ALL output (console.log, process.stdout.write, ora spinners,
 * agent streaming) is captured to a timestamped log file.
 * 
 * Chalk ANSI codes are stripped before writing to the file.
 */

import fs from 'fs-extra';
import path from 'path';

// Strip ANSI escape codes (colors, cursor movement, etc.)
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

let logStream: fs.WriteStream | null = null;
let originalStdoutWrite: typeof process.stdout.write | null = null;
let originalStderrWrite: typeof process.stderr.write | null = null;
let logFilePath: string | null = null;

/**
 * Start capturing all stdout/stderr to a log file.
 * Returns the path to the log file.
 */
export async function startLogCapture(workDir: string): Promise<string> {
  const logsDir = path.join(workDir, '.ralph', 'logs');
  await fs.ensureDir(logsDir);

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-02-09T15-24-51
  logFilePath = path.join(logsDir, `run-${ts}.log`);

  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Write header
  logStream.write(`=== Ralph Loop Run ===\n`);
  logStream.write(`Started: ${now.toISOString()}\n`);
  logStream.write(`Working directory: ${workDir}\n`);
  logStream.write(`${'='.repeat(60)}\n\n`);

  // Monkey-patch stdout
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk: any, ...args: any[]): boolean {
    // Write to log file (stripped of ANSI)
    if (logStream) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      logStream.write(stripAnsi(text));
    }
    // Still write to real stdout
    return originalStdoutWrite!(chunk, ...args as [any, any]);
  } as typeof process.stdout.write;

  // Monkey-patch stderr
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function (chunk: any, ...args: any[]): boolean {
    if (logStream) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      logStream.write(`[stderr] ${stripAnsi(text)}`);
    }
    return originalStderrWrite!(chunk, ...args as [any, any]);
  } as typeof process.stderr.write;

  return logFilePath;
}

/**
 * Stop capturing and close the log file.
 */
export async function stopLogCapture(): Promise<void> {
  // Restore original writes
  if (originalStdoutWrite) {
    process.stdout.write = originalStdoutWrite;
    originalStdoutWrite = null;
  }
  if (originalStderrWrite) {
    process.stderr.write = originalStderrWrite;
    originalStderrWrite = null;
  }

  if (logStream) {
    logStream.write(`\n${'='.repeat(60)}\n`);
    logStream.write(`Ended: ${new Date().toISOString()}\n`);
    logStream.end();
    await new Promise<void>((resolve) => logStream!.on('finish', resolve));
    logStream = null;
  }
}

/**
 * Get the current log file path (or null if not capturing).
 */
export function getLogFilePath(): string | null {
  return logFilePath;
}

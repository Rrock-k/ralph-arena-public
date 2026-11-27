import { execa } from 'execa';
import { spawn } from 'child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BaseAgent, type AgentOptions } from './base.js';
import type { AgentError, AgentResult } from '../config/types.js';

function resolveAntigravityBinary(): string {
  return process.env.ARENA_ANTIGRAVITY_BIN?.trim()
    || process.env.ARENA_AGY_BIN?.trim()
    || 'agy';
}

function buildPrintTimeout(timeoutMinutes: number | undefined): string | undefined {
  if (!timeoutMinutes || !Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    return undefined;
  }
  return `${Math.max(1, Math.ceil(timeoutMinutes))}m0s`;
}

function stripOauthUrls(text: string): string {
  return text.replace(/https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?[^\s]+/g, '[google-oauth-url-redacted]');
}

export class AntigravityAgent extends BaseAgent {
  name = 'antigravity';

  async execute(options: AgentOptions): Promise<AgentResult> {
    const { workDir, prompt, timeout } = options;

    if (options.model?.trim()) {
      const message = 'Antigravity CLI model selection is not supported by the current proven CLI contract. Use the CLI default until a deterministic model-setting path is validated.';
      return {
        success: false,
        output: message,
        filesChanged: await this.getChangedFiles(workDir),
        completionPromiseFound: false,
        error: { category: 'config', message },
      };
    }

    const args = [
      '--dangerously-skip-permissions',
      ...this.resolvePrintTimeoutArgs(timeout),
      '--print',
      prompt,
    ];

    try {
      const startedAt = Date.now();
      const run = await this.runAntigravity({ workDir, args, timeout });
      const output = stripOauthUrls(run.stdout + (run.stderr ? `\n${run.stderr}` : ''));
      const streamErrors = [
        ...this.collectErrors(run.stdout, run.stderr),
        ...(await this.collectRecentLogDiagnostics(startedAt)),
      ];
      const error = this.classifyAntigravityErrors(streamErrors)
        ?? this.classifyEmptyOutput(run.stdout);

      return {
        success: !error,
        output: output || error?.message || '',
        filesChanged: await this.getChangedFiles(workDir),
        completionPromiseFound: false,
        error,
      };
    } catch (error: any) {
      const stdout = error.stdout || '';
      const stderr = error.stderr || '';
      const message = error.message || String(error);
      const output = stripOauthUrls(`${stdout}\n${stderr || message}`.trim());
      const streamErrors = this.collectErrors(stdout, stderr || message);

      return {
        success: false,
        output,
        filesChanged: await this.getChangedFiles(workDir),
        completionPromiseFound: false,
        error: this.classifyAntigravityErrors(streamErrors)
          ?? { category: 'unknown', message: output.slice(0, 1000) || message.slice(0, 1000) },
      };
    }
  }

  private resolvePrintTimeoutArgs(timeout: number | undefined): string[] {
    const printTimeout = buildPrintTimeout(timeout);
    return printTimeout ? ['--print-timeout', printTimeout] : [];
  }

  private runAntigravity(input: {
    workDir: string;
    args: string[];
    timeout?: number;
  }): Promise<{ stdout: string; stderr: string }> {
    const { workDir, args, timeout } = input;
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const binary = resolveAntigravityBinary();

      const child = spawn(binary, args, {
        cwd: workDir,
        env: { ...process.env, CI: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let timer: NodeJS.Timeout | undefined;
      if (timeout) {
        timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Agent timed out after ${timeout} minutes`));
        }, timeout * 60 * 1000);
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code !== 0 && code !== null) {
          const error = new Error(`Antigravity exited with code ${code}`);
          Object.assign(error, { stdout, stderr });
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  private collectErrors(stdout: string, stderr: string): string[] {
    const stdoutErrors = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => this.isAntigravityDiagnosticLine(line, 'stdout'));
    const stderrErrors = stderr
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => this.isAntigravityDiagnosticLine(line, 'stderr'));

    return [...stdoutErrors, ...stderrErrors];
  }

  private isAntigravityDiagnosticLine(line: string, stream: 'stdout' | 'stderr'): boolean {
    if (/accounts\.google\.com\/o\/oauth2\/auth\?/i.test(line)) return true;
    if (/^Authentication required\.?/i.test(line)) return true;
    if (/^Waiting for authentication\b/i.test(line)) return true;
    if (/^Or, paste the authorization code here\b/i.test(line)) return true;
    if (/authentication.*(?:required|failed|timed out)|oauth|invalid_grant|invalid code verifier/i.test(line)) return true;

    const strongProviderError = /resource_exhausted|individual quota reached|hit your.*limit|usage limit|rate.?limit|\b429\b|quota.?(?:exceeded|reached)|budget.?exhausted|insufficient budget|unsupported.*model|unknown model|model not found|listen tcp|operation not permitted|econnrefused|enotfound|network error|socket hang up|tls|certificate|connection reset|temporary failure|service unavailable|bad gateway|gateway timeout/i;
    if (strongProviderError.test(line)) return true;

    if (/^(Error|Fatal):\s+/i.test(line)) return true;
    if (/^(Failed|CLI failed)\b/i.test(line)) return true;

    // `agy` emits provider/runtime diagnostics on stderr, while normal print
    // mode content is stdout. Keep stderr strict enough to avoid classifying
    // useful planner JSON as an error when it contains words like "required".
    return stream === 'stderr' && /^(error|fatal|failed)\b/i.test(line);
  }

  private classifyAntigravityErrors(errors: string[]): AgentError | undefined {
    if (errors.length === 0) return undefined;
    const scrubbed = errors.map(stripOauthUrls);
    const authError = [...scrubbed]
      .reverse()
      .find((msg) => /authentication.*(?:required|failed|timed out)|oauth|invalid_grant|invalid code verifier/i.test(msg));
    if (authError) {
      return { category: 'auth', message: authError.slice(0, 1000) };
    }
    const configError = [...scrubbed]
      .reverse()
      .find((msg) => /unsupported.*model|unknown model|model not found|model override/i.test(msg));
    if (configError) {
      return { category: 'config', message: configError.slice(0, 1000) };
    }
    const infraError = [...scrubbed]
      .reverse()
      .find((msg) => /listen tcp|operation not permitted/i.test(msg));
    if (infraError) {
      return { category: 'infra', message: infraError.slice(0, 1000) };
    }
    return this.classifyStreamErrors(scrubbed);
  }

  private async collectRecentLogDiagnostics(startedAtMs: number): Promise<string[]> {
    const logDir = this.resolveLogDir();
    if (!logDir) return [];

    try {
      const entries = await fs.readdir(logDir, { withFileTypes: true });
      const files = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
        .map(async (entry) => {
          const filePath = path.join(logDir, entry.name);
          const stat = await fs.stat(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        }));

      const recentFiles = files
        .filter((file) => file.mtimeMs >= startedAtMs - 2_000)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 3);

      const diagnostics: string[] = [];
      for (const file of recentFiles) {
        const content = await fs.readFile(file.filePath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (this.isAntigravityInternalDiagnosticLine(trimmed)) {
            diagnostics.push(stripOauthUrls(trimmed));
          }
        }
      }
      return diagnostics;
    } catch {
      return [];
    }
  }

  private resolveLogDir(): string | null {
    const home = process.env.ARENA_ANTIGRAVITY_HOME?.trim() || process.env.HOME?.trim();
    if (!home) return null;
    return path.join(home, '.gemini', 'antigravity-cli', 'log');
  }

  private isAntigravityInternalDiagnosticLine(line: string): boolean {
    return /agent executor error|resource_exhausted|individual quota reached|quota.?(?:exceeded|reached)|usage limit|rate.?limit|\b429\b|budget.?exhausted|insufficient budget|unsupported.*model|unknown model|model not found|print mode: auth timed out/i.test(line);
  }

  private classifyEmptyOutput(stdout: string): AgentError | undefined {
    if (stdout.trim().length > 0) return undefined;

    return {
      category: 'infra',
      message: 'Antigravity CLI returned empty stdout with exit code 0; treating it as failed because Ralph cannot detect task completion from an empty agent response.',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa(resolveAntigravityBinary(), ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa(resolveAntigravityBinary(), ['--version']);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }
}

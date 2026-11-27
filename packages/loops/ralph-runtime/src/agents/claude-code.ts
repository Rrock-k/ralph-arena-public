import { execa } from 'execa';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { BaseAgent, type AgentOptions } from './base.js';
import type { AgentResult, AgentUsage } from '../config/types.js';
import { mergeExtractedStreamText } from '../utils/stream-json.js';
import { extractAgentUsage } from './usage.js';

function resolveClaudeBinary(): string {
  return process.env.ARENA_CLAUDE_BIN?.trim() || 'claude';
}

function isBlockingRateLimitEvent(msg: any): boolean {
  if (msg?.type !== 'rate_limit_event') return false;
  const status = typeof msg?.rate_limit_info?.status === 'string'
    ? msg.rate_limit_info.status.toLowerCase()
    : null;
  return status === 'rejected';
}

interface ClaudeRunOutput {
  fullOutput: string;
  assistantText: string;
  streamErrors: string[];
  sessionId: string | null;
  usage?: AgentUsage;
}

interface StreamCollectors {
  assistantTextParts: string[];
  resultTextParts: string[];
  streamErrors: string[];
  sessionId: string | null;
  usage?: AgentUsage;
}

export class ClaudeCodeAgent extends BaseAgent {
  name = 'claude-code';
  private lastUsageSignature: string | null = null;

  async execute(options: AgentOptions): Promise<AgentResult> {
    const { workDir, prompt, allowedTools = [], timeout } = options;
    const verbose = options.verbose !== false;
    const resumeSessionId = options.providerSessionResumeId?.trim() || null;
    this.lastUsageSignature = null;

    const baseArgs = [
      '--print',
      '--dangerously-skip-permissions',
      ...(verbose ? ['--output-format', 'stream-json', '--verbose'] : []),
    ];

    if (options.model) {
      baseArgs.push('--model', options.model);
    }

    if (allowedTools.length > 0) {
      baseArgs.push('--allowedTools', allowedTools.join(','));
    }

    const args = this.buildInvocationArgs(baseArgs, resumeSessionId);
    let resumeFallbackReason: string | undefined;
    let resumedFrom = resumeSessionId ?? undefined;
    try {
      let run: ClaudeRunOutput;
      try {
        run = await this.runClaude({ workDir, prompt, timeout, verbose, args });
      } catch (error: any) {
        if (!resumeSessionId || !this.isProviderSessionResumeUnavailableError(error)) {
          throw error;
        }
        resumeFallbackReason = this.extractProviderSessionResumeFallbackReason(error, 'Claude');
        resumedFrom = undefined;
        this.lastUsageSignature = null;
        run = await this.runClaude({
          workDir,
          prompt,
          timeout,
          verbose,
          args: this.buildInvocationArgs(baseArgs, null),
        });
      }

      const filesChanged = await this.getChangedFiles(workDir);
      const error = this.classifyStreamErrors(run.streamErrors);

      return {
        success: !error,
        // Use extracted assistant text when available (verbose/stream-json mode),
        // fall back to raw output (non-verbose / plain --print mode).
        output: run.assistantText || run.fullOutput,
        filesChanged,
        completionPromiseFound: false,
        error,
        providerSession: this.buildProviderSession(run.sessionId, resumedFrom, resumeFallbackReason),
        usage: run.usage,
      };
    } catch (error: any) {
      const output = (error.stdout || '') + '\n' + (error.stderr || error.message || String(error));
      const streamErrors: string[] = error.streamErrors ?? [];

      // When no JSONL stream errors were captured (e.g. hard crash on 401),
      // attempt to classify from stderr/message so auth errors aren't masked as 'unknown'.
      const stderrFallback = (error.stderr || error.message || String(error)).slice(0, 2000);
      if (streamErrors.length === 0 && stderrFallback) {
        streamErrors.push(stderrFallback);
      }

      return {
        success: false,
        output,
        filesChanged: await this.getChangedFiles(workDir),
        completionPromiseFound: false,
        error: this.classifyStreamErrors(streamErrors)
          ?? { category: 'unknown', message: stderrFallback.slice(0, 1000) },
        providerSession: this.buildProviderSession(error.sessionId ?? null, resumedFrom, resumeFallbackReason),
        usage: error.usage,
      };
    }
  }

  private buildInvocationArgs(baseArgs: string[], resumeSessionId: string | null): string[] {
    const args = [...baseArgs];
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    // Read prompt from stdin to avoid shell escaping issues.
    args.push('-');
    return args;
  }

  private runClaude(input: {
    workDir: string;
    prompt: string;
    timeout?: number;
    verbose: boolean;
    args: string[];
  }): Promise<ClaudeRunOutput> {
    const { workDir, prompt, timeout, verbose, args } = input;
    return new Promise<ClaudeRunOutput>((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      let buffer = '';
      const collectors: StreamCollectors = {
        assistantTextParts: [],
        resultTextParts: [],
        streamErrors: [],
        sessionId: null,
      };
      const claudeBinary = resolveClaudeBinary();

      const child = spawn(claudeBinary, args, {
        cwd: workDir,
        // RA-375: GIT_OPTIONAL_LOCKS=0 stops the agent's read-only `git
        // status`/`git diff` inspection from taking `.git/index.lock`, so a
        // SIGTERM (iteration timeout) mid-inspection can't leave a stale lock
        // that fails the engine's next commit.
        env: { ...process.env, CI: 'true', GIT_OPTIONAL_LOCKS: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin.write(prompt);
      child.stdin.end();

      let timer: NodeJS.Timeout | undefined;
      if (timeout) {
        timer = setTimeout(() => {
          child.kill('SIGTERM');
          // RA-374: carry the captured session id + usage on the timeout error
          // so the executor records a resumable provider-session checkpoint and
          // the retry continues mid-session instead of cold-reading the WIP.
          // Deliberately omit stderr/streamErrors so the error message still
          // classifies as `timeout` (retry), not the pre-timeout stream noise.
          const error = new Error(`Agent timed out after ${timeout} minutes`);
          Object.assign(error, {
            stdout: output,
            sessionId: collectors.sessionId,
            usage: collectors.usage,
          });
          reject(error);
        }, timeout * 60 * 1000);
      }

      if (verbose) {
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          output += text;
          buffer += text;

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              this.collectStreamMessage(JSON.parse(line), collectors, true);
            } catch {
              process.stdout.write(line + '\n');
            }
          }
        });
      } else {
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
      }

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);

        if (verbose && buffer.trim()) {
          try {
            this.collectStreamMessage(JSON.parse(buffer), collectors, false);
          } catch {
            // Not valid JSON — ignore the partial buffer.
          }
          buffer = '';
        }

        if (code !== 0 && code !== null) {
          const error = new Error(`Claude exited with code ${code}`);
          Object.assign(error, {
            stdout: output,
            stderr: errorOutput,
            streamErrors: collectors.streamErrors,
            sessionId: collectors.sessionId,
            usage: collectors.usage,
          });
          reject(error);
        } else {
          resolve({
            fullOutput: output + (errorOutput ? '\n' + errorOutput : ''),
            assistantText: mergeExtractedStreamText(
              collectors.assistantTextParts.join('\n'),
              collectors.resultTextParts.join('\n'),
            ),
            streamErrors: collectors.streamErrors,
            sessionId: collectors.sessionId,
            usage: collectors.usage,
          });
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  private collectStreamMessage(msg: any, collectors: StreamCollectors, print: boolean): void {
    if (typeof msg?.session_id === 'string' && msg.session_id.trim()) {
      collectors.sessionId = msg.session_id.trim();
    }
    collectors.usage = extractAgentUsage(msg) ?? collectors.usage;
    if (print) this.printStreamMessage(msg);

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          collectors.assistantTextParts.push(block.text);
        }
      }
    }

    if (msg.type === 'result') {
      if (typeof msg.result === 'string') {
        collectors.resultTextParts.push(msg.result);
      } else if (msg.result?.content) {
        for (const block of msg.result.content) {
          if (block.type === 'text' && block.text) {
            collectors.resultTextParts.push(block.text);
          }
        }
      }
    }

    if (isBlockingRateLimitEvent(msg)) {
      collectors.streamErrors.push(JSON.stringify(msg));
    }
    if (msg.type === 'error' || msg.type === 'system') {
      const errMsg = msg.message || msg.error || '';
      if (errMsg) collectors.streamErrors.push(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }
    if (msg.type === 'result' && msg.is_error && typeof msg.result === 'string') {
      collectors.streamErrors.push(msg.result);
    }
  }

  /**
   * Pretty-print a stream-json message from Claude CLI
   */
  private printStreamMessage(msg: any): void {
    const type = msg.type;

    const usage = extractAgentUsage(msg);
    if (usage) {
      const sig = `${usage.inputTokens}:${usage.outputTokens}`;
      if (sig !== this.lastUsageSignature) {
        this.lastUsageSignature = sig;
        process.stdout.write(chalk.gray(`  [tokens: ${usage.inputTokens} in / ${usage.outputTokens} out]\n`));
      }
    }

    if (type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          process.stdout.write(chalk.white(block.text));
        } else if (block.type === 'tool_use') {
          const tool = block.name || 'tool';
          const input = typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input, null, 2);
          const shortInput = input.length > 200 ? input.slice(0, 200) + '...' : input;
          process.stdout.write(chalk.cyan(`\n🔧 ${tool}: `) + chalk.gray(shortInput) + '\n');
        }
      }
    } else if (type === 'result') {
      // Final result — skip (we'll get it from fullOutput)
    } else if (type === 'system' || type === 'error') {
      const text = msg.message || msg.error || JSON.stringify(msg);
      process.stdout.write(chalk.yellow(`[${type}] ${text}\n`));
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa(resolveClaudeBinary(), ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa(resolveClaudeBinary(), ['--version']);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }
}

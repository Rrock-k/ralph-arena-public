import { execa } from 'execa';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { BaseAgent, type AgentOptions } from './base.js';
import type { AgentResult, AgentUsage } from '../config/types.js';
import { extractAgentUsage } from './usage.js';

function resolveCodexBinary(): string {
  return process.env.ARENA_CODEX_BIN?.trim() || 'codex';
}

const OPENAI_PROXY_AUTH_SENTINEL = 'arena-proxy';
const CODEX_PROXY_PROVIDER_ID = 'arena-openai-proxy';
const CODEX_REASONING_EFFORT = 'xhigh';

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function resolveOpenAiProxyBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return env.OPENAI_BASE_URL?.trim() || env.OPENAI_API_BASE?.trim() || null;
}

function shouldUseOpenAiProxyProvider(env: NodeJS.ProcessEnv): boolean {
  return env.ARENA_PROVIDER_BILLING_MODE === 'platform_credits'
    || env.OPENAI_API_KEY === OPENAI_PROXY_AUTH_SENTINEL;
}

function resolveCodexProxyConfigArgs(env: NodeJS.ProcessEnv): string[] {
  const baseUrl = resolveOpenAiProxyBaseUrl(env);
  if (!baseUrl || !env.OPENAI_API_KEY || !shouldUseOpenAiProxyProvider(env)) {
    return [];
  }

  return [
    '-c',
    `model_provider=${tomlString(CODEX_PROXY_PROVIDER_ID)}`,
    '-c',
    `model_providers.${CODEX_PROXY_PROVIDER_ID}={name="Arena OpenAI Proxy", base_url=${tomlString(baseUrl)}, wire_api="responses", bearer_token_env_var="OPENAI_API_KEY"}`,
  ];
}

function resolveCodexReasoningEffortConfigArgs(): string[] {
  return ['-c', `model_reasoning_effort=${tomlString(CODEX_REASONING_EFFORT)}`];
}

export class CodexAgent extends BaseAgent {
  name = 'codex';

  async execute(options: AgentOptions): Promise<AgentResult> {
    const { workDir, prompt, timeout } = options;
    const verbose = options.verbose !== false;
    const resumeSessionId = options.providerSessionResumeId?.trim() || null;

    const args = this.buildInvocationArgs({
      workDir,
      model: options.model,
      verbose,
      resumeSessionId,
    });
    let resumedFrom = resumeSessionId ?? undefined;
    let resumeFallbackReason: string | undefined;

    try {
      let run: {
        agentText: string;
        streamErrors: string[];
        sessionId: string | null;
        usage?: AgentUsage;
      };

      try {
        run = await this.runCodex({ workDir, prompt, timeout, verbose, args });
      } catch (error: any) {
        if (!resumeSessionId || !this.isProviderSessionResumeUnavailableError(error)) {
          throw error;
        }
        resumeFallbackReason = this.extractProviderSessionResumeFallbackReason(error, 'Codex');
        resumedFrom = undefined;
        run = await this.runCodex({
          workDir,
          prompt,
          timeout,
          verbose,
          args: this.buildInvocationArgs({
            workDir,
            model: options.model,
            verbose,
            resumeSessionId: null,
          }),
        });
      }

      const filesChanged = await this.getChangedFiles(workDir);
      const error = this.classifyStreamErrors(run.streamErrors);

      return {
        success: !error,
        output: run.agentText,
        filesChanged,
        completionPromiseFound: false,
        error,
        providerSession: this.buildProviderSession(run.sessionId, resumedFrom, resumeFallbackReason),
        usage: run.usage,
      };
    } catch (error: any) {
      const output = (error.stdout || '') + '\n' + (error.stderr || error.message || String(error));
      const streamErrors: string[] = error.streamErrors ?? [];
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
          ?? { category: 'unknown', message: (error.message || String(error)).slice(0, 1000) },
        providerSession: this.buildProviderSession(error.sessionId ?? null, resumedFrom, resumeFallbackReason),
        usage: error.usage,
      };
    }
  }

  private buildInvocationArgs(input: {
    workDir: string;
    model?: string;
    verbose: boolean;
    resumeSessionId: string | null;
  }): string[] {
    const commonArgs = [
      '--dangerously-bypass-approvals-and-sandbox',
      ...resolveCodexReasoningEffortConfigArgs(),
      ...resolveCodexProxyConfigArgs(process.env),
      ...(input.verbose ? ['--json'] : []),
    ];

    if (input.model) {
      commonArgs.push('--model', input.model);
    }

    if (input.resumeSessionId) {
      // `codex exec resume` does not accept `-C`; cwd scopes session lookup.
      return ['exec', 'resume', ...commonArgs, input.resumeSessionId, '-'];
    }

    return [
      'exec',
      ...commonArgs,
      '-C', input.workDir,
      // Read prompt from stdin to avoid OS arg-length limits and
      // "Reading additional input from stdin..." stall when pipe is open.
      '-',
    ];
  }

  private runCodex(input: {
    workDir: string;
    prompt: string;
    timeout?: number;
    verbose: boolean;
    args: string[];
  }): Promise<{
    agentText: string;
    streamErrors: string[];
    sessionId: string | null;
    usage?: AgentUsage;
  }> {
    const { workDir, prompt, timeout, verbose, args } = input;
    return new Promise((resolve, reject) => {
      let rawOutput = '';
      let errorOutput = '';
      const messageChunks: string[] = [];
      const streamErrors: string[] = [];
      let latestUsage: AgentUsage | undefined;
      let sessionId: string | null = null;
      const codexBinary = resolveCodexBinary();

      const child = spawn(codexBinary, args, {
        cwd: workDir,
        // RA-375: GIT_OPTIONAL_LOCKS=0 stops the agent's read-only `git
        // status`/`git diff` inspection from taking `.git/index.lock`, so a
        // SIGTERM (iteration timeout) mid-inspection can't leave a stale lock
        // that fails the engine's next commit.
        env: { ...process.env, CI: 'true', GIT_OPTIONAL_LOCKS: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Send prompt via stdin and close — codex reads `-` from stdin
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
          Object.assign(error, { stdout: rawOutput, sessionId, usage: latestUsage });
          reject(error);
        }, timeout * 60 * 1000);
      }

      if (verbose) {
        let buffer = '';
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          rawOutput += text;
          buffer += text;

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              latestUsage = extractAgentUsage(event) ?? latestUsage;
              sessionId = this.extractProviderSessionId(event) ?? sessionId;
              this.printStreamEvent(event);
              if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
                messageChunks.push(event.item.text);
              }
              // Capture structured error events
              if (event.type === 'error') {
                const msg = event.message || event.error || '';
                if (msg) streamErrors.push(msg);
              }
              if (event.type === 'turn.failed' && event.error?.message) {
                streamErrors.push(event.error.message);
              }
            } catch {
              process.stdout.write(line + '\n');
            }
          }
        });
      } else {
        child.stdout.on('data', (chunk: Buffer) => {
          rawOutput += chunk.toString();
        });
      }

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code !== 0 && code !== null) {
          const error = new Error(`Codex exited with code ${code}`);
          Object.assign(error, { stdout: rawOutput, stderr: errorOutput, streamErrors, sessionId, usage: latestUsage });
          reject(error);
        } else {
          const combined = rawOutput + (errorOutput ? '\n' + errorOutput : '');
          const agentText = verbose && messageChunks.length > 0
            ? messageChunks.join('\n')
            : combined;
          resolve({ agentText, streamErrors, sessionId, usage: latestUsage });
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Pretty-print a JSONL event from `codex exec --json`.
   */
  private printStreamEvent(event: any): void {
    const type = event.type as string;

    if (type === 'item.started' || type === 'item.completed') {
      const item = event.item;
      if (!item) return;

      switch (item.type) {
        case 'agent_message':
          if (item.text && type === 'item.completed') {
            process.stdout.write('\n' + chalk.white(item.text) + '\n');
          }
          break;

        case 'reasoning':
          if (item.text && type === 'item.completed') {
            const firstLine = item.text.split('\n')[0].replace(/\*+/g, '').trim();
            if (firstLine) {
              process.stdout.write(chalk.gray(`\n  💭 ${firstLine}\n`));
            }
          }
          break;

        case 'command_execution': {
          const cmd = item.command || '';
          const shortCmd = cmd.length > 200 ? cmd.slice(0, 200) + '...' : cmd;
          if (type === 'item.started') {
            process.stdout.write(chalk.cyan(`  > exec: `) + chalk.gray(shortCmd) + '\n');
          }
          break;
        }

        case 'file_change':
          if (type === 'item.completed') {
            const file = item.file || item.path || '';
            process.stdout.write(chalk.green(`  file: ${file}\n`));
          }
          break;

        default:
          if (type === 'item.started' && item.type) {
            process.stdout.write(chalk.cyan(`  > ${item.type}\n`));
          }
          break;
      }
    } else if (type === 'turn.completed') {
      const usage = extractAgentUsage(event);
      if (usage) {
        process.stdout.write(chalk.gray(`  [tokens: ${usage.inputTokens} in / ${usage.outputTokens} out]\n`));
      }
    } else if (type === 'error') {
      const text = event.message || event.error || JSON.stringify(event);
      process.stdout.write(chalk.red(`[error] ${text}\n`));
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa(resolveCodexBinary(), ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa(resolveCodexBinary(), ['--version']);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }
}

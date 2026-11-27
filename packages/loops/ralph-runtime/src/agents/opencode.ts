import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { BaseAgent, type AgentOptions } from './base.js';
import type { AgentError, AgentResult, AgentUsage } from '../config/types.js';
import { extractAgentUsage } from './usage.js';

const OPENCODE_ZEN_PROVIDER_ID = 'opencode';
const OPENCODE_NO_TOOLS_AGENT = 'arena-controller';
const OPENCODE_NO_TOOLS_AGENT_PROMPT = [
  'You are Arena controller audit.',
  'Answer directly as plain assistant text.',
  'Never call tools. Never emit tool-call markup.',
  'Return only the JSON or text requested by the user prompt.',
].join(' ');
const OPENCODE_NO_TOOLS_DENIED_PERMISSIONS = [
  'read',
  'edit',
  'glob',
  'grep',
  'list',
  'bash',
  'task',
  'external_directory',
  'todowrite',
  'webfetch',
  'websearch',
  'lsp',
  'skill',
  'question',
  'doom_loop',
] as const;
const OPENCODE_NO_TOOLS_XML_TOOL_CALL_TAGS = [
  '<read_file',
  '<edit_file',
  '<write_file',
  '<list_dir',
  '<grep_search',
  '<search_files',
  '<run_command',
  '<bash',
  '<tool_use',
  '<function_calls',
] as const;

function resolveOpenCodeBinary(): string {
  return process.env.ARENA_OPENCODE_BIN?.trim() || 'opencode';
}

function isOpenCodeZenModel(model: string): boolean {
  return model.startsWith(`${OPENCODE_ZEN_PROVIDER_ID}/`);
}

function trimToNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buildOpenCodeConfigContent(input: {
  existingContent?: string;
  injectNoToolsAgent: boolean;
  injectZenProvider: boolean;
  model: string;
}): string | undefined {
  const { existingContent, injectNoToolsAgent, injectZenProvider, model } = input;
  if (!injectNoToolsAgent && !injectZenProvider) return undefined;

  let config: Record<string, unknown> = {};
  if (existingContent?.trim()) {
    try {
      const parsed = JSON.parse(existingContent);
      const parsedRecord = asRecord(parsed);
      if (!parsedRecord) {
        throw new Error('OpenCode config must be a JSON object to inject Arena runtime config.');
      }
      config = { ...parsedRecord };
    } catch {
      throw new Error('OpenCode config must be valid JSON to inject Arena runtime config.');
    }
  }

  if (injectZenProvider) {
    config.model = model;
    config.small_model = model;
    const provider = { ...(asRecord(config.provider) ?? {}) };
    const opencodeProvider = { ...(asRecord(provider[OPENCODE_ZEN_PROVIDER_ID]) ?? {}) };
    opencodeProvider.options = {
      ...(asRecord(opencodeProvider.options) ?? {}),
      apiKey: '{env:OPENCODE_API_KEY}',
    };
    provider[OPENCODE_ZEN_PROVIDER_ID] = opencodeProvider;
    config.provider = provider;
  }

  if (injectNoToolsAgent) {
    const permission: Record<string, 'deny'> = {};
    for (const key of OPENCODE_NO_TOOLS_DENIED_PERMISSIONS) {
      permission[key] = 'deny';
    }

    config.agent = {
      ...(asRecord(config.agent) ?? {}),
      [OPENCODE_NO_TOOLS_AGENT]: {
        description: 'Arena controller audit. Return text only and never use tools.',
        mode: 'primary',
        model,
        temperature: 0,
        prompt: OPENCODE_NO_TOOLS_AGENT_PROMPT,
        permission,
      },
    };
  }

  return JSON.stringify(config);
}

function readNestedText(value: unknown, chunks: string[]): void {
  if (typeof value === 'string') {
    if (value.trim()) chunks.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) readNestedText(item, chunks);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'output']) {
    const text = trimToNonEmpty(record[key]);
    if (text) chunks.push(text);
  }
  if (record.message && typeof record.message === 'object') {
    readNestedText(record.message, chunks);
  }
}

function extractTextChunks(event: unknown): string[] {
  const chunks: string[] = [];
  if (!event || typeof event !== 'object') return chunks;
  const record = event as Record<string, unknown>;

  readNestedText(record.text, chunks);
  readNestedText(record.content, chunks);
  readNestedText(record.output, chunks);
  readNestedText(record.response, chunks);
  readNestedText(record.part, chunks);
  readNestedText(record.parts, chunks);
  readNestedText(record.message, chunks);
  readNestedText(record.result, chunks);
  return chunks;
}

function readErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') return trimToNonEmpty(value);
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return trimToNonEmpty(record.message)
    ?? trimToNonEmpty(record.error)
    ?? trimToNonEmpty(record.detail)
    ?? trimToNonEmpty(record.reason);
}

function extractErrorMessages(event: unknown): string[] {
  if (!event || typeof event !== 'object') return [];
  const record = event as Record<string, unknown>;
  const type = trimToNonEmpty(record.type) ?? '';
  const messages: string[] = [];

  if (/error|failed|failure/i.test(type)) {
    for (const key of ['message', 'error', 'detail', 'reason']) {
      const message = readErrorMessage(record[key]);
      if (message) messages.push(message);
    }
  }

  const nestedError = readErrorMessage(record.error);
  if (nestedError) messages.push(nestedError);
  return Array.from(new Set(messages));
}

function summarizeProcessError(error: any): string {
  const parts = [
    error.stdout,
    error.stderr,
    error.message || String(error),
  ].filter(Boolean);
  return parts.join('\n').trim();
}

export class OpenCodeAgent extends BaseAgent {
  name = 'opencode';

  async execute(options: AgentOptions): Promise<AgentResult> {
    const model = options.model?.trim();
    const resumeSessionId = options.providerSessionResumeId?.trim() || null;
    if (!model) {
      return {
        success: false,
        output: 'OpenCode requires an explicit model in provider/model format.',
        filesChanged: await this.getChangedFiles(options.workDir),
        completionPromiseFound: false,
        error: {
          category: 'config',
          message: 'OpenCode requires an explicit model in provider/model format.',
        },
      };
    }

    const noToolsMode = Array.isArray(options.allowedTools) && options.allowedTools.length === 0;
    const args = [
      'run',
      '--dir', options.workDir,
      '--format', 'json',
      '--dangerously-skip-permissions',
      '--title', 'Arena run',
      '--model', model,
    ];
    if (noToolsMode) {
      args.push('--agent', OPENCODE_NO_TOOLS_AGENT);
    }
    if (resumeSessionId) {
      args.push('--session', resumeSessionId);
    }
    let resumedFrom = resumeSessionId ?? undefined;
    let resumeFallbackReason: string | undefined;

    try {
      let run: {
        agentText: string;
        hasMessageText: boolean;
        streamErrors: string[];
        sessionId: string | null;
        usage?: AgentUsage;
      };

      try {
        run = await this.runOpenCode({ options, model, args, noToolsMode });
      } catch (error: any) {
        if (!resumeSessionId || !this.isProviderSessionResumeUnavailableError(error)) {
          throw error;
        }
        resumeFallbackReason = this.extractProviderSessionResumeFallbackReason(error, 'OpenCode');
        resumedFrom = undefined;
        run = await this.runOpenCode({
          options,
          model,
          args: args.filter((arg, index) => !(arg === '--session' || args[index - 1] === '--session')),
          noToolsMode,
        });
      }

      const streamError = this.classifyOpenCodeErrors(run.streamErrors);
      const noToolsOutputError = streamError
        ? undefined
        : noToolsMode
          ? this.classifyNoToolsOutput(run.agentText, run.hasMessageText)
          : undefined;
      const emptyOutputError = streamError || noToolsOutputError || run.agentText.trim()
        ? undefined
        : { category: 'infra' as const, message: 'OpenCode exited successfully with empty stdout.' };
      const error = streamError ?? noToolsOutputError ?? emptyOutputError;

      return {
        success: !error,
        output: run.agentText || noToolsOutputError?.message || emptyOutputError?.message || '',
        filesChanged: await this.getChangedFiles(options.workDir),
        completionPromiseFound: false,
        error,
        providerSession: this.buildProviderSession(run.sessionId, resumedFrom, resumeFallbackReason),
        usage: run.usage,
      };
    } catch (error: any) {
      const streamErrors: string[] = error.streamErrors ?? [];
      const output = summarizeProcessError(error);
      if (output && streamErrors.length === 0) streamErrors.push(this.lastMeaningfulLine(output) ?? output);

      return {
        success: false,
        output,
        filesChanged: await this.getChangedFiles(options.workDir),
        completionPromiseFound: false,
        error: this.classifyOpenCodeErrors(streamErrors)
          ?? { category: 'unknown', message: (error.message || String(error)).slice(0, 1000) },
        providerSession: this.buildProviderSession(error.sessionId ?? null, resumedFrom, resumeFallbackReason),
        usage: error.usage,
      };
    }
  }

  private runOpenCode(input: {
    options: AgentOptions;
    model: string;
    args: string[];
    noToolsMode: boolean;
  }): Promise<{
    agentText: string;
    hasMessageText: boolean;
    streamErrors: string[];
    sessionId: string | null;
    usage?: AgentUsage;
  }> {
    const { options, model, args, noToolsMode } = input;
    return new Promise((resolve, reject) => {
      let rawOutput = '';
      let errorOutput = '';
      let stdoutBuffer = '';
      const messageChunks: string[] = [];
      const streamErrors: string[] = [];
      let latestUsage: AgentUsage | undefined;
      let sessionId: string | null = null;
      const resolvedEnv = this.resolveOpenCodeEnv(process.env, model, noToolsMode);
      const child = spawn(resolveOpenCodeBinary(), args, {
        cwd: options.workDir,
        env: resolvedEnv.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let cleanedUp = false;
      const cleanupConfig = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        resolvedEnv.cleanup();
      };
      child.stdin.on('error', () => {
        // The process may exit before consuming stdin on config/auth failures.
      });
      child.stdin.write(options.prompt);
      child.stdin.end();

      let timer: NodeJS.Timeout | undefined;
      if (options.timeout) {
        timer = setTimeout(() => {
          child.kill('SIGTERM');
          // RA-374: carry the captured session id + usage on the timeout error
          // so the executor records a resumable provider-session checkpoint and
          // the retry continues mid-session instead of cold-reading the WIP.
          // Deliberately omit stderr/streamErrors so the error message still
          // classifies as `timeout` (retry), not the pre-timeout stream noise.
          const error = new Error(`Agent timed out after ${options.timeout} minutes`);
          Object.assign(error, { stdout: rawOutput, sessionId, usage: latestUsage });
          reject(error);
        }, options.timeout * 60 * 1000);
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        rawOutput += text;
        stdoutBuffer += text;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          this.handleJsonLine(line, messageChunks, streamErrors, (nextUsage) => {
            latestUsage = nextUsage ?? latestUsage;
          }, (nextSessionId) => {
            sessionId = nextSessionId ?? sessionId;
          });
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        cleanupConfig();
        if (stdoutBuffer.trim()) {
          this.handleJsonLine(stdoutBuffer, messageChunks, streamErrors, (nextUsage) => {
            latestUsage = nextUsage ?? latestUsage;
          }, (nextSessionId) => {
            sessionId = nextSessionId ?? sessionId;
          });
        }

        if (code !== 0 && code !== null) {
          const stderrSummary = this.lastMeaningfulLine(errorOutput);
          if (stderrSummary) streamErrors.push(stderrSummary);
          const error = new Error(`OpenCode exited with code ${code}`);
          Object.assign(error, {
            stdout: rawOutput,
            stderr: errorOutput,
            streamErrors,
            sessionId,
            usage: latestUsage,
          });
          reject(error);
          return;
        }

        const hasMessageText = messageChunks.length > 0;
        const agentText = hasMessageText
          ? messageChunks.join('\n')
          : rawOutput.trim();
        resolve({ agentText, hasMessageText, streamErrors, sessionId, usage: latestUsage });
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        cleanupConfig();
        reject(err);
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execa(resolveOpenCodeBinary(), ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa(resolveOpenCodeBinary(), ['--version']);
      return stdout.trim();
    } catch {
      return 'not installed';
    }
  }

  private resolveOpenCodeEnv(baseEnv: NodeJS.ProcessEnv, model: string, noToolsMode: boolean): {
    env: NodeJS.ProcessEnv;
    cleanup: () => void;
  } {
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      CI: 'true',
      // RA-375: keep read-only agent git inspection from taking .git/index.lock
      // so a SIGTERM mid-inspection can't leave a stale lock (see codex.ts).
      GIT_OPTIONAL_LOCKS: '0',
      OPENCODE_CLIENT: baseEnv.OPENCODE_CLIENT || 'arena-runner',
      OPENCODE_DISABLE_AUTOUPDATE: baseEnv.OPENCODE_DISABLE_AUTOUPDATE || 'true',
    };

    const configContent = buildOpenCodeConfigContent({
      existingContent: this.readOpenCodeConfigContent(env),
      injectNoToolsAgent: noToolsMode,
      injectZenProvider: Boolean(isOpenCodeZenModel(model) && env.OPENCODE_API_KEY),
      model,
    });
    let tempConfigDir: string | undefined;
    if (configContent) {
      tempConfigDir = mkdtempSync(path.join(tmpdir(), 'arena-opencode-config-'));
      const configPath = path.join(tempConfigDir, 'opencode.json');
      writeFileSync(configPath, configContent, 'utf8');
      env.OPENCODE_CONFIG = configPath;
      env.OPENCODE_CONFIG_CONTENT = configContent;
    }

    return {
      env,
      cleanup: () => {
        if (tempConfigDir) {
          rmSync(tempConfigDir, { recursive: true, force: true });
        }
      },
    };
  }

  private readOpenCodeConfigContent(env: NodeJS.ProcessEnv): string | undefined {
    if (env.OPENCODE_CONFIG_CONTENT?.trim()) return env.OPENCODE_CONFIG_CONTENT;
    const configPath = env.OPENCODE_CONFIG?.trim();
    if (!configPath) return undefined;
    return readFileSync(configPath, 'utf8');
  }

  private handleJsonLine(
    line: string,
    messageChunks: string[],
    streamErrors: string[],
    onUsage: (usage: AgentUsage | null) => void,
    onSessionId: (sessionId: string | null) => void,
  ): void {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      onUsage(extractAgentUsage(event));
      onSessionId(this.extractProviderSessionId(event, { includeOpenCodeStepProperties: true }));
      messageChunks.push(...extractTextChunks(event));
      streamErrors.push(...extractErrorMessages(event));
    } catch {
      messageChunks.push(line);
    }
  }

  private classifyOpenCodeErrors(errors: string[]): AgentError | undefined {
    if (errors.length === 0) return undefined;
    const shared = this.classifyStreamErrors(errors);
    if (shared && shared.category !== 'unknown') return shared;

    for (let index = errors.length - 1; index >= 0; index -= 1) {
      const msg = errors[index]!;
      if (/api key.*(?:missing|required|invalid)|missing.*api key|OPENCODE_API_KEY|unauthorized|\b401\b|\b403\b|authentication required|auth login/i.test(msg)) {
        return { category: 'auth', message: msg.slice(0, 1000) };
      }
      if (/unknown model|model not found|unsupported model|invalid model|provider.*not.*configured|no provider|OpenCode config/i.test(msg)) {
        return { category: 'config', message: msg.slice(0, 1000) };
      }
      if (/insufficient balance|payment required|billing|\b402\b/i.test(msg)) {
        return { category: 'budget', message: msg.slice(0, 1000) };
      }
      if (/rate.?limit|\b429\b|too many requests|quota/i.test(msg)) {
        return {
          category: 'rate_limit',
          message: msg.slice(0, 1000),
          retryAfterSec: this.parseRetryAfter(msg),
          ...(this.parseRetryAt(msg) ? { retryAt: this.parseRetryAt(msg)!.toISOString() } : {}),
        };
      }
      if (/network|econnrefused|enotfound|timeout|timed out|socket|tls|certificate|bad gateway|service unavailable|\b503\b/i.test(msg)) {
        return { category: 'infra', message: msg.slice(0, 1000) };
      }
    }

    return shared;
  }

  private classifyNoToolsOutput(output: string, hasMessageText: boolean): AgentError | undefined {
    const trimmed = output.trim();
    if (!trimmed) {
      return {
        category: 'infra',
        message: 'OpenCode no-tools run exited successfully with empty stdout.',
      };
    }
    if (!hasMessageText) {
      return {
        category: 'infra',
        message: 'OpenCode no-tools run exited successfully without assistant text.',
      };
    }
    if (this.containsNoToolsToolCallOutput(trimmed)) {
      return {
        category: 'infra',
        message: 'OpenCode no-tools run returned tool-call output instead of assistant text.',
      };
    }
    return undefined;
  }

  private containsNoToolsToolCallOutput(output: string): boolean {
    const lowerOutput = output.toLowerCase();
    if (lowerOutput.includes('dsml') && lowerOutput.includes('tool_calls')) return true;
    return OPENCODE_NO_TOOLS_XML_TOOL_CALL_TAGS.some(marker => lowerOutput.includes(marker));
  }

  private lastMeaningfulLine(value: string): string | null {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.at(-1) ?? null;
  }
}

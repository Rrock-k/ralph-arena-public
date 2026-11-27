import type { AgentResult, AgentError } from '../config/types.js';

const TIME_ONLY_RESET_GRACE_MS = 5 * 60 * 1000;

export interface AgentOptions {
  workDir: string;
  prompt: string;
  contextFiles?: string[];
  allowedTools?: string[];
  timeout?: number;
  verbose?: boolean;
  model?: string;
  providerSessionResumeId?: string;
}

export interface Agent {
  name: string;

  /**
   * Execute the agent with given prompt
   */
  execute(options: AgentOptions): Promise<AgentResult>;

  /**
   * Check if agent is available/installed
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get agent version
   */
  getVersion(): Promise<string>;
}

export abstract class BaseAgent implements Agent {
  abstract name: string;

  abstract execute(options: AgentOptions): Promise<AgentResult>;

  abstract isAvailable(): Promise<boolean>;

  abstract getVersion(): Promise<string>;

  /**
   * Parse output to check for completion promise
   */
  protected checkCompletionPromise(output: string, promise: string): boolean {
    // Check for <promise>COMPLETE</promise> style
    const tagPattern = new RegExp(`<promise>${promise}</promise>`, 'i');
    if (tagPattern.test(output)) return true;

    // Check for plain text
    if (output.includes(promise)) return true;

    return false;
  }

  /**
   * Extract changed files from git status
   */
  protected async getChangedFiles(workDir: string): Promise<string[]> {
    const { execa } = await import('execa');
    try {
      const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: workDir });
      return stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.slice(3).trim());
    } catch {
      return [];
    }
  }

  /**
   * Best-effort extraction for CLI session identifiers from heterogeneous
   * JSONL event streams. Only keys that explicitly describe a session/thread
   * are accepted; message/item ids are intentionally ignored.
   */
  protected extractProviderSessionId(
    event: unknown,
    options: { includeOpenCodeStepProperties?: boolean } = {},
  ): string | null {
    if (!event || typeof event !== 'object') return null;
    const record = event as Record<string, unknown>;

    for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId', 'thread_id', 'threadId']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }

    const type = typeof record.type === 'string' ? record.type : '';
    const lifecycleEvent = /^(session|conversation|thread)([._:-]?(started|created|init|initialized|resumed))?$/i;
    if (lifecycleEvent.test(type) && typeof record.id === 'string' && record.id.trim()) {
      return record.id.trim();
    }

    for (const key of ['session', 'conversation', 'thread']) {
      const nested = record[key];
      if (!nested || typeof nested !== 'object') continue;
      const nestedId = this.extractProviderSessionId(nested, options);
      if (nestedId) return nestedId;
    }

    if (options.includeOpenCodeStepProperties && type === 'step_start') {
      const properties = record.properties;
      if (properties && typeof properties === 'object') {
        const openCodeSessionId = (properties as Record<string, unknown>).sessionID;
        if (typeof openCodeSessionId === 'string' && openCodeSessionId.trim()) {
          return openCodeSessionId.trim();
        }
      }
    }

    return null;
  }

  protected buildProviderSession(
    sessionId: string | null,
    resumedFrom?: string,
    resumeFallbackReason?: string,
  ): AgentResult['providerSession'] {
    const id = sessionId?.trim() || resumedFrom?.trim();
    if (!id) return undefined;
    return {
      id,
      ...(resumedFrom ? { resumedFrom } : {}),
      ...(resumeFallbackReason ? { resumeFallbackReason } : {}),
    };
  }

  protected isProviderSessionResumeUnavailableError(error: any): boolean {
    const text = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || String(error)}`;
    const commandShapeError = /(invalid|unknown|unrecognized) (?:option|flag|argument|subcommand|command)|(?:option|flag|argument|subcommand|command).{0,40}(?:not found|unknown|unsupported)/i;
    if (commandShapeError.test(text)) return false;

    const targetMissing = /(no (?:conversation|session|thread|rollout).{0,40}found|(?:conversation|session|thread|rollout).{0,80}(?:not found|does not exist|expired)|unable to resume|could not resume|invalid (?:conversation|session|thread)(?: id| identifier)?)/i;
    return /(resume|session|conversation|thread|rollout)/i.test(text)
      && targetMissing.test(text);
  }

  protected extractProviderSessionResumeFallbackReason(error: any, providerName: string): string {
    const streamError = Array.isArray(error.streamErrors)
      ? error.streamErrors.find((entry: unknown) => typeof entry === 'string' && entry.trim())
      : null;
    const text = `${streamError || error.stderr || error.stdout || error.message || String(error)}`.trim();
    return (text.split('\n').find((line: string) => line.trim()) || `${providerName} session resume failed`).slice(0, 300);
  }

  // ── Shared error classification ──────────────────────────────────

  /**
   * Classify error messages collected from the agent's structured event stream
   * (JSONL `type:"error"`, `type:"turn.failed"`, etc.).
   *
   * Operates on clean, short error strings — NOT on the full session output —
   * so regex matching is safe from false positives on project code.
   */
  protected classifyStreamErrors(errors: string[]): AgentError | undefined {
    if (errors.length === 0) return undefined;
    let fallbackUnknown: AgentError | undefined;
    let latestRateLimit: AgentError | undefined;
    let latestRateLimitPriority = -1;

    for (let index = errors.length - 1; index >= 0; index -= 1) {
      const msg = errors[index]!;

      // ── Rate limit / usage limit ──
      if (/resource_exhausted|hit your.*limit|usage limit|rate.?limit|\b429\b|too many requests|quota.?(?:exceeded|reached)|overloaded|out of extra usage/i.test(msg)) {
        const retryAt = this.parseRetryAt(msg);
        const classified: AgentError = {
          category: 'rate_limit',
          message: msg.slice(0, 1000),
          retryAfterSec: this.parseRetryAfter(msg),
          ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
        };
        const priority = this.rateLimitRetryPriority(msg, classified.retryAt);

        // Keep searching older events for a richer provider reset horizon, but
        // never drop a newer rate-limit classification entirely.
        if (!latestRateLimit) {
          latestRateLimit = classified;
          latestRateLimitPriority = priority;
        } else if (classified.retryAt && priority > latestRateLimitPriority) {
          latestRateLimit.retryAt = classified.retryAt;
          latestRateLimit.retryAfterSec = classified.retryAfterSec;
          latestRateLimitPriority = priority;
        }
        continue;
      }

      // ── Auth ──
      if (/missing bearer|\bunauthorized\b|authentication[_\s-]?(error|failed|required)|invalid authentication|OAuth token has expired|\b401\b.*(?:error|forbidden|fail)|token[_\s-]?expired/i.test(msg)) {
        return latestRateLimit ?? { category: 'auth', message: msg.slice(0, 1000) };
      }

      // ── Config ──
      if (/unsupported value|invalid_request_error|unknown model|model not found/i.test(msg)) {
        return latestRateLimit ?? { category: 'config', message: msg.slice(0, 1000) };
      }

      // ── Budget ──
      if (/budget.?exhausted|insufficient budget|402/i.test(msg)) {
        return latestRateLimit ?? { category: 'budget', message: msg.slice(0, 1000) };
      }

      // ── Iteration timeout (agent killed by Ralph) — retriable, NOT infra ──
      // Accept fractional minutes so a decimal iterationTimeoutMinutes is not
      // misclassified as infra (which would pause instead of retry).
      if (/Agent timed out after \d+(?:\.\d+)? minutes/i.test(msg)) {
        return latestRateLimit ?? { category: 'timeout', message: msg.slice(0, 1000) };
      }

      // ── Infra / transport ──
      if (/econnrefused|enotfound|timed out|timeout|socket hang up|tls|certificate|network error|connection reset|temporary failure|service unavailable|bad gateway|gateway timeout|provider_auth_unavailable|api key is not configured in api-proxy|\bE2BIG\b|argument list too long|\b503\b/i.test(msg)) {
        return latestRateLimit ?? { category: 'infra', message: msg.slice(0, 1000) };
      }

      fallbackUnknown ??= { category: 'unknown', message: msg.slice(0, 1000) };
    }

    return latestRateLimit ?? fallbackUnknown;
  }

  private rateLimitRetryPriority(msg: string, retryAt: string | undefined): number {
    if (/resets(?:_at|At)["\s:]+?(\d{10,})/i.test(msg) || /resets_in_seconds["\s:]+?(\d+)/i.test(msg)) {
      return 2;
    }
    if (retryAt) return 1;
    return 0;
  }

  /**
   * Parse retry-after timing from an error message.
   * Handles formats from OpenAI/Codex and Anthropic/Claude.
   */
  protected parseRetryAfter(msg: string): number {
    const retryAt = this.parseRetryAt(msg);
    if (retryAt) {
      return Math.min(Math.max(Math.ceil((retryAt.getTime() - Date.now()) / 1000), 60), 7200 * 4);
    }

    // Anthropic overloaded — short wait
    if (/overloaded|529|capacity/i.test(msg)) return 120;

    return 300; // default 5 min
  }

  protected parseRetryAt(msg: string): Date | null {
    // OpenAI: "resets_in_seconds": NNN
    const resetsInMatch = msg.match(/resets_in_seconds["\s:]+?(\d+)/);
    if (resetsInMatch) {
      const waitSec = Math.max(parseInt(resetsInMatch[1], 10), 60);
      return new Date(Date.now() + waitSec * 1000);
    }

    // Antigravity: "Resets in 164h30m39s"
    const resetsDurationMatch = msg.match(/resets?\s+in\s+(\d+)h(?:(\d+)m)?(?:(\d+)s)?/i);
    if (resetsDurationMatch) {
      const hours = parseInt(resetsDurationMatch[1], 10);
      const minutes = resetsDurationMatch[2] ? parseInt(resetsDurationMatch[2], 10) : 0;
      const seconds = resetsDurationMatch[3] ? parseInt(resetsDurationMatch[3], 10) : 0;
      const waitSec = Math.max(hours * 3600 + minutes * 60 + seconds, 60);
      return new Date(Date.now() + waitSec * 1000);
    }

    // OpenAI: "resets_at": UNIX_TS
    const resetsAtMatch = msg.match(/resets(?:_at|At)["\s:]+?(\d{10,})/);
    if (resetsAtMatch) {
      const raw = parseInt(resetsAtMatch[1], 10);
      const ms = raw >= 1e12 ? raw : raw * 1000;
      const parsed = new Date(ms);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    // Codex: "try again at Feb 22nd, 2026 12:04 AM" or "try again at 12:59 PM"
    const tryAgainMatch = msg.match(/try again (?:at\s+)?[^\n]{0,40}?(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (tryAgainMatch) {
      const hours = parseInt(tryAgainMatch[1], 10);
      const minutes = parseInt(tryAgainMatch[2], 10);
      const isPm = tryAgainMatch[3].toLowerCase() === 'pm';

      let hour24 = hours;
      if (isPm && hours < 12) hour24 += 12;
      if (!isPm && hours === 12) hour24 = 0;

      // Try parsing full date prefix (e.g., "Feb 22nd, 2026 12:04 AM")
      const fullDateMatch = msg.match(/try again (?:at\s+)?(\w+ \d{1,2}\w*,?\s+\d{4})\s+\d{1,2}:\d{2}\s*(?:am|pm)/i);
      if (fullDateMatch) {
        const cleanDate = fullDateMatch[1].replace(/(\d+)(st|nd|rd|th)/i, '$1');
        const resetTime = new Date(`${cleanDate} ${hour24}:${String(minutes).padStart(2, '0')}`);
        if (!isNaN(resetTime.getTime())) {
          return resetTime;
        }
      }

      // Fallback: time-only, compute as today/tomorrow
      const now = new Date();
      const resetTime = new Date();
      resetTime.setHours(hour24, minutes, 0, 0);
      const elapsedMs = now.getTime() - resetTime.getTime();
      if (elapsedMs > TIME_ONLY_RESET_GRACE_MS) resetTime.setDate(now.getDate() + 1);
      return resetTime;
    }

    // Claude: "resets 3am", "resets 10pm", "resets 7pm (UTC)"
    const resetsMatch = msg.match(/resets\s*?(\d+)(?::(\d{2}))?\s*(am|pm)(?:\s*\((utc)\))?/i);
    if (resetsMatch) {
      const hours = parseInt(resetsMatch[1], 10);
      const minutes = resetsMatch[2] ? parseInt(resetsMatch[2], 10) : 0;
      const isPm = resetsMatch[3].toLowerCase() === 'pm';
      const isUtc = resetsMatch[4]?.toLowerCase() === 'utc';
      let hour24 = hours;
      if (isPm && hours < 12) hour24 += 12;
      if (!isPm && hours === 12) hour24 = 0;
      const now = new Date();
      const resetTime = new Date(now.getTime());
      if (isUtc) {
        resetTime.setUTCHours(hour24, minutes, 0, 0);
        const elapsedMs = now.getTime() - resetTime.getTime();
        if (elapsedMs > TIME_ONLY_RESET_GRACE_MS) resetTime.setUTCDate(now.getUTCDate() + 1);
      } else {
        resetTime.setHours(hour24, minutes, 0, 0);
        const elapsedMs = now.getTime() - resetTime.getTime();
        if (elapsedMs > TIME_ONLY_RESET_GRACE_MS) resetTime.setDate(now.getDate() + 1);
      }
      return resetTime;
    }

    return null;
  }
}

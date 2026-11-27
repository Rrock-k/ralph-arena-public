import type { Agent } from './base.js';
import { AntigravityAgent } from './antigravity.js';
import { ClaudeCodeAgent } from './claude-code.js';
import { CodexAgent } from './codex.js';
import { OpenCodeAgent } from './opencode.js';
import type { AgentType } from '../config/types.js';

const agents: Record<AgentType, () => Agent> = {
  'claude-code': () => new ClaudeCodeAgent(),
  'codex': () => new CodexAgent(),
  'antigravity': () => new AntigravityAgent(),
  'opencode': () => new OpenCodeAgent(),
};

export function createAgent(type: AgentType): Agent {
  const factory = agents[type];
  if (!factory) {
    throw new Error(`Unknown agent type: ${type}`);
  }
  return factory();
}

export { ClaudeCodeAgent } from './claude-code.js';
export { CodexAgent } from './codex.js';
export { AntigravityAgent } from './antigravity.js';
export { OpenCodeAgent } from './opencode.js';
export type { Agent, AgentOptions } from './base.js';

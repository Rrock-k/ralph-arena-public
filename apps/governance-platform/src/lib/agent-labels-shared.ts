/**
 * RA-231: Sync agent label utilities — safe for "use client" components.
 * No DB/prisma imports. Cache populated by server-side agent-labels.ts.
 */

export interface ModelOption {
  id: string;
  label: string;
  model: string;
}

export interface ToolRecord {
  name: string;
  label: string | null;
  models: ModelOption[];
  defaultModelId: string | null;
}

export interface LoopRecord {
  name: string;
  label: string | null;
}

export interface LabelCache {
  tools: ToolRecord[];
  loops: LoopRecord[];
  at: number;
}

export interface AgentConfigEntry {
  id: string;
  label: string;
  agent: string;
  agentImpl: string;
  models: ModelOption[];
  defaultModelId: string;
}

const globalForLabels = globalThis as unknown as {
  agentLabelCache?: LabelCache;
};

function prettifyToken(value?: string | null): string {
  if (!value) return "Unknown";
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildLabelCache(
  tools: Array<{
    name: string;
    label?: string | null;
    models?: ModelOption[] | null;
    defaultModelId?: string | null;
  }>,
  loops: Array<{
    name: string;
    label?: string | null;
  }>,
): LabelCache {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      label: tool.label ?? null,
      models: tool.models ?? [],
      defaultModelId: tool.defaultModelId ?? null,
    })),
    loops: loops.map((loop) => ({
      name: loop.name,
      label: loop.label ?? null,
    })),
    at: Date.now(),
  };
}

/** Read cache (set by server-side agent-labels.ts). */
export function getLabelCache(): LabelCache | null {
  return globalForLabels.agentLabelCache ?? null;
}

/** Set cache (called by server-side agent-labels.ts). */
export function setLabelCache(cache: LabelCache): void {
  globalForLabels.agentLabelCache = cache;
}

/**
 * Human-readable label: "Claude Code / Opus", "Codex (Direct)".
 * Sync — uses cached DB data. Falls back to raw name if cache cold.
 */
export function formatAgentLabel(
  agent?: string | null,
  agentImpl?: string | null,
  model?: string | null,
): string {
  const cache = getLabelCache();
  if (!cache) {
    const toolLabel = prettifyToken(agent);
    const loopSuffix = agentImpl && agentImpl !== "ralph"
      ? ` (${prettifyToken(agentImpl)})`
      : "";
    return `${toolLabel}${loopSuffix}`;
  }

  const tool = cache.tools.find((t) => t.name === agent);
  const toolLabel = tool?.label ?? agent ?? "Unknown";

  let modelLabel: string | null = null;
  if (model && tool) {
    const modelOption = tool.models.find((m) => m.model === model);
    if (modelOption && modelOption.id !== tool.defaultModelId) {
      modelLabel = modelOption.label;
    }
  }

  const loop = cache.loops.find((l) => l.name === agentImpl);
  const loopSuffix = loop && loop.name !== "ralph"
    ? ` (${loop.label ?? loop.name})`
    : "";

  return modelLabel
    ? `${toolLabel} / ${modelLabel}${loopSuffix}`
    : `${toolLabel}${loopSuffix}`;
}

/**
 * Agent configs for dropdowns — compatible with old AGENT_CONFIGS shape.
 * Combines Tool × AgentLoop.
 */
export function getAgentConfigs(): AgentConfigEntry[] {
  const cache = getLabelCache();
  if (!cache) return [];

  const entries: AgentConfigEntry[] = [];
  for (const tool of cache.tools) {
    for (const loop of cache.loops) {
      const id = `${tool.name}-${loop.name}`;
      const loopSuffix = loop.name !== "ralph" ? ` (${loop.label ?? loop.name})` : "";
      entries.push({
        id,
        label: `${tool.label ?? tool.name}${loopSuffix}`,
        agent: tool.name,
        agentImpl: loop.name,
        models: tool.models,
        defaultModelId: tool.defaultModelId ?? tool.models[0]?.id ?? "default",
      });
    }
  }
  return entries;
}

export function getAgentConfig(id: string): AgentConfigEntry | undefined {
  return getAgentConfigs().find((c) => c.id === id);
}

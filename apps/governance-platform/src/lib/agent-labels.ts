/**
 * RA-231: Server-side agent label loader — populates cache from DB.
 * Import this ONLY in server components / server actions / API routes.
 * Client components should import from agent-labels-shared.ts.
 */

import { prisma } from "./prisma";
import { setLabelCache, type LabelCache, type ModelOption } from "./agent-labels-shared";

// Re-export sync utilities for server-side convenience
export {
  formatAgentLabel,
  getAgentConfigs,
  getAgentConfig,
  type AgentConfigEntry,
  type ModelOption,
} from "./agent-labels-shared";

export function parseModels(raw: string | null): ModelOption[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadCache(): Promise<LabelCache> {
  const [tools, loops] = await Promise.all([
    prisma.tool.findMany({
      where: { isActive: true },
      select: { name: true, label: true, models: true, defaultModelId: true },
    }),
    prisma.agentLoop.findMany({
      where: { isActive: true },
      select: { name: true, label: true },
    }),
  ]);

  const cache: LabelCache = {
    tools: tools.map((t) => ({
      name: t.name,
      label: t.label,
      models: parseModels(t.models),
      defaultModelId: t.defaultModelId,
    })),
    loops,
    at: Date.now(),
  };

  setLabelCache(cache);
  return cache;
}

/** Warm cache from DB. Call from layout or server component. */
export async function preloadAgentLabels(): Promise<void> {
  await loadCache();
}

/** Get all tools with models — async, for server-side use. */
export async function getAgentRegistry(): Promise<{
  tools: LabelCache["tools"];
  loops: LabelCache["loops"];
}> {
  const cache = await loadCache();
  return { tools: cache.tools, loops: cache.loops };
}

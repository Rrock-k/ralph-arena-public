export const DEFAULT_AGENT_LOOP_NAME = "ralph";
export const DEFAULT_TOOL_NAME = "codex";

export interface LaunchLoopOption {
  id: string;
  name: string;
}

export interface LaunchToolOption {
  tool: {
    id: string;
    name: string;
    defaultModelId?: string | null;
  };
  mapping?: {
    isDefault?: boolean | null;
  };
}

export interface LaunchModelOption {
  id: string;
  label: string;
  model: string;
}

interface ResolveModelInput {
  models: LaunchModelOption[];
  selectedModelId?: string | null;
  currentModel?: string | null;
  defaultModelId?: string | null;
}

export function resolveDefaultLoopId(loops: LaunchLoopOption[]): string {
  return loops.find((loop) => loop.name === DEFAULT_AGENT_LOOP_NAME)?.id
    ?? loops[0]?.id
    ?? "";
}

export function resolveDefaultToolId(
  availableTools: LaunchToolOption[],
  preferredToolName?: string | null,
): string {
  if (preferredToolName) {
    const preferredTool = availableTools.find((entry) => entry.tool.name === preferredToolName);
    if (preferredTool) return preferredTool.tool.id;
  }

  return availableTools.find((entry) => entry.tool.name === DEFAULT_TOOL_NAME)?.tool.id
    ?? availableTools.find((entry) => entry.mapping?.isDefault)?.tool.id
    ?? availableTools[0]?.tool.id
    ?? "";
}

export function resolveDefaultModelId({
  models,
  selectedModelId,
  currentModel,
  defaultModelId,
}: ResolveModelInput): string {
  if (selectedModelId && models.some((model) => model.id === selectedModelId)) {
    return selectedModelId;
  }

  if (currentModel) {
    const current = models.find((model) => model.model === currentModel);
    if (current) return current.id;
  }

  return resolveLatestModelId(models)
    ?? (defaultModelId && models.some((model) => model.id === defaultModelId) ? defaultModelId : null)
    ?? models[0]?.id
    ?? "";
}

export function resolveLatestModelId(models: LaunchModelOption[]): string | null {
  let best: { id: string; rank: number[] } | null = null;

  for (const model of models) {
    const rank = buildModelRank(model);
    if (!rank) continue;
    if (!best || compareRank(rank, best.rank) > 0) {
      best = { id: model.id, rank };
    }
  }

  return best?.id ?? null;
}

function buildModelRank(model: LaunchModelOption): number[] | null {
  const haystack = `${model.model} ${model.id} ${model.label}`.toLowerCase();
  const match = haystack.match(/\bgpt[-\s]?(\d+)(?:[.-](\d+))?(?:[.-](\d+))?/);
  if (!match) return null;

  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  const fullSize = haystack.includes("mini") ? 0 : 1;

  return [major, minor, patch, fullSize];
}

function compareRank(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

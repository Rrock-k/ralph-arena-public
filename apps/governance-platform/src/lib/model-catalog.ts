import "server-only";

import { prisma } from "@/lib/prisma";

export type CatalogModelOption = {
  id: string | null;
  label: string | null;
  model: string;
  envOverrides: Record<string, string> | null;
};

type RawModelOption = {
  id?: unknown;
  label?: unknown;
  model?: unknown;
  envOverrides?: unknown;
};

export type CatalogModelSelection =
  | {
      success: true;
      model: string | null;
      modelId: string | null;
      label: string | null;
      envOverrides: Record<string, string> | null;
      options: CatalogModelOption[];
    }
  | { success: false; error: string };

export function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function normalizeRegistryEnvOverrides(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  const normalized: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (!key.trim() || typeof entry !== "string") return null;
    normalized[key] = entry;
  }
  return normalized;
}

function normalizeClientEnvOverrides(value: Record<string, string | null> | null | undefined): Record<string, string> | null {
  if (!value) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  const normalized: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (!key.trim() || typeof entry !== "string") return null;
    normalized[key] = entry;
  }
  return normalized;
}

export function parseCatalogModelOptions(raw: string | null | undefined): CatalogModelOption[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: RawModelOption) => {
      if (!entry || typeof entry !== "object") return [];
      const model = trimToNull(typeof entry.model === "string" ? entry.model : null);
      if (!model) return [];
      return [{
        id: trimToNull(typeof entry.id === "string" ? entry.id : null),
        label: trimToNull(typeof entry.label === "string" ? entry.label : null),
        model,
        envOverrides: normalizeRegistryEnvOverrides(entry.envOverrides),
      }];
    });
  } catch {
    return [];
  }
}

export function envOverridesMatch(
  clientValue: Record<string, string | null> | null | undefined,
  registryValue: Record<string, string> | null,
): boolean {
  const normalizedClient = normalizeClientEnvOverrides(clientValue);
  if (!normalizedClient && !registryValue) return true;
  if (!normalizedClient || !registryValue) return false;
  return stableStringify(normalizedClient) === stableStringify(registryValue);
}

export function selectCatalogModel(input: {
  rawModels: string | null | undefined;
  requestedModel?: string | null;
  defaultModelId?: string | null;
  envOverrides?: Record<string, string | null> | null;
}): CatalogModelSelection {
  const options = parseCatalogModelOptions(input.rawModels);
  const requestedModel = trimToNull(input.requestedModel);

  if (options.length === 0) {
    if (input.envOverrides && Object.keys(input.envOverrides).length > 0) {
      return { success: false, error: "envOverrides are not accepted for this tool and loop." };
    }
    return {
      success: true,
      model: requestedModel,
      modelId: null,
      label: null,
      envOverrides: null,
      options,
    };
  }

  const selected = requestedModel
    ? options.find((option) => option.model === requestedModel || option.id === requestedModel)
    : options.find((option) => option.id === input.defaultModelId) ?? options[0];

  if (!selected) {
    return { success: false, error: "Selected model is not available for this tool and loop." };
  }
  if (input.envOverrides !== undefined && !envOverridesMatch(input.envOverrides, selected.envOverrides)) {
    return { success: false, error: "envOverrides must match the selected Arena model preset." };
  }

  return {
    success: true,
    model: selected.model,
    modelId: selected.id,
    label: selected.label,
    envOverrides: selected.envOverrides,
    options,
  };
}

export async function resolveLaunchCatalogSelection(input: {
  agent: string;
  agentImpl: string;
  toolId?: string | null;
  model?: string | null;
  envOverrides?: Record<string, string | null> | null;
}): Promise<(
  | {
      success: true;
      toolId: string;
      agentLoopVersionId: string;
      model: string | null;
      modelId: string | null;
      envOverrides: Record<string, string> | null;
    }
  | { success: false; error: string }
)> {
  const loop = await (prisma as any).agentLoop.findUnique({
    where: { name: input.agentImpl },
    select: {
      isActive: true,
      currentVersionId: true,
      loopTools: {
        select: {
          toolId: true,
          models: true,
          tool: {
            select: {
              id: true,
              name: true,
              models: true,
              defaultModelId: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!loop?.isActive || !loop.currentVersionId) {
    return { success: false, error: `Unknown or inactive agent loop: ${input.agentImpl}` };
  }

  const requestedToolId = trimToNull(input.toolId);
  const mapping = loop.loopTools.find((entry: any) => (
    entry.tool?.isActive
    && entry.tool.name === input.agent
    && (!requestedToolId || entry.toolId === requestedToolId)
  ));
  if (!mapping?.tool) {
    return { success: false, error: `Tool ${input.agent} is not available for loop ${input.agentImpl}` };
  }

  const selectedModel = selectCatalogModel({
    rawModels: mapping.models ?? mapping.tool.models,
    requestedModel: input.model,
    defaultModelId: mapping.tool.defaultModelId,
    envOverrides: input.envOverrides,
  });
  if (!selectedModel.success) return selectedModel;

  return {
    success: true,
    toolId: mapping.toolId,
    agentLoopVersionId: loop.currentVersionId,
    model: selectedModel.model,
    modelId: selectedModel.modelId,
    envOverrides: selectedModel.envOverrides,
  };
}

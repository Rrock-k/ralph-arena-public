import {
  exportRalphPromptRepository,
  type PromptRepositoryEntry,
  type PromptRepositoryExport,
  type PromptOwner,
  type PromptTemplateStatus,
  type PromptVisibility,
} from "../../../../packages/loops/ralph-runtime/src/prompts/repository";

export type RalphPromptDefinition = PromptRepositoryEntry;
export type RalphPromptExport = PromptRepositoryExport;

export interface RalphPromptOwnerGroup {
  owner: PromptOwner;
  label: string;
  count: number;
  promptIds: string[];
}

export interface RalphPromptMap {
  export: RalphPromptExport;
  ownerGroups: RalphPromptOwnerGroup[];
  counts: {
    total: number;
    byVisibility: Record<PromptVisibility, number>;
    byTemplateStatus: Record<PromptTemplateStatus, number>;
  };
}

const OWNER_LABELS: Record<PromptOwner, string> = {
  planner: "Planner",
  executor: "Executor",
  controller: "Controller",
  "qa-planner": "QA Planner",
  "vision-qa": "Vision QA",
};

const OWNER_ORDER: PromptOwner[] = [
  "planner",
  "executor",
  "controller",
  "qa-planner",
  "vision-qa",
];

export function getRalphPromptMap(options: { generatedAt?: string } = {}): RalphPromptMap {
  const promptExport = exportRalphPromptRepository(options);
  const entries = promptExport.entries;

  const byVisibility = emptyVisibilityCounts();
  const byTemplateStatus = emptyTemplateStatusCounts();

  for (const entry of entries) {
    byVisibility[entry.visibility] += 1;
    byTemplateStatus[entry.templateStatus] += 1;
  }

  const ownerGroups = OWNER_ORDER.map((owner) => {
    const promptIds = entries
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.id);

    return {
      owner,
      label: OWNER_LABELS[owner],
      count: promptIds.length,
      promptIds,
    };
  }).filter((group) => group.count > 0);

  return {
    export: promptExport,
    ownerGroups,
    counts: {
      total: entries.length,
      byVisibility,
      byTemplateStatus,
    },
  };
}

function emptyVisibilityCounts(): Record<PromptVisibility, number> {
  return {
    admin_raw: 0,
    safe_summary: 0,
  };
}

function emptyTemplateStatusCounts(): Record<PromptTemplateStatus, number> {
  return {
    dynamic_builder: 0,
    section_builder: 0,
    static_constant: 0,
    external_artifact: 0,
  };
}

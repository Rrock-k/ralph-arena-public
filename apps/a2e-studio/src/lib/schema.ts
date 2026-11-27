import type { CommitBlock as GenericCommitBlock } from "@/lib/commit-scope";

export type CommitEntry = {
  sha: string;
  shortSha: string;
  subject: string;
  subjectCore: string;
  authorName: string;
  authoredAt: string;
  taskRefs: string[];
  primaryTask: {
    id: string;
    title: string | null;
    status: string | null;
  } | null;
};

export type CommitBlock = GenericCommitBlock<CommitEntry>;

export type RepoSnapshot = {
  name: string;
  path: string;
  exists: boolean;
  clean: boolean;
  reason: string | null;
  branch: string | null;
  headSha: string | null;
  headShaShort: string | null;
  headTitle: string | null;
};

export type ScenarioOption = {
  id: string;
  label: string;
  description: string;
  lane: "lane_1" | "lane_2" | "lane_3";
  defaultSelected: boolean;
};

export type PrepData = {
  recentCommits: CommitEntry[];
  repos: RepoSnapshot[];
  reviewTargets: string[];
  scenarioOptions: ScenarioOption[];
};

export type OperatorSettings = {
  localFullSweep: boolean;
  includeLane1: boolean;
  includeLane3LocalSubset: boolean;
  includeVpsSymphoSmoke: boolean;
  manualFirstStrict: boolean;
  refreshLivingSpec: boolean;
  cleanupBeforeReport: boolean;
  strictFreeze: boolean;
  allowDirtyRepos: boolean;
  promptStyle: "summary_first" | "minimal";
};

export type ManifestDraft = {
  batchLabel: string;
  selectedCommitShas: string[];
  selectedScenarioIds: string[];
  selectedReviewTargets: string[];
  settings: OperatorSettings;
  customInstructions: {
    commitScope: string;
    reviewTargets: string;
    scenarios: string;
    execution: string;
    environment: string;
    manualProof: string;
  };
};

export type Manifest = {
  version: 1;
  manifestId: string;
  createdAt: string;
  source: "a2e-studio";
  batchLabel: string;
  commitScope: {
    mode: "contiguous_range" | "explicit_blocks";
    selectedCommits: CommitEntry[];
    selectedBlocks: CommitBlock[];
    baseSha: string | null;
    headSha: string | null;
    customInstruction: string | null;
  };
  scenarios: {
    selected: ScenarioOption[];
    customInstruction: string | null;
  };
  reviewTargets: {
    selected: string[];
    customInstruction: string | null;
  };
  settings: OperatorSettings;
  customInstructions: ManifestDraft["customInstructions"];
  repos: RepoSnapshot[];
};

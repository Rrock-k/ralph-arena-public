/**
 * Test factories for Prisma model mocks.
 * Usage: fakeProject({ state: "FAILED" }) — returns a full Project with overrides.
 * Eliminates `as any` in test mocks and catches schema drift at compile time.
 */

import type { Proposal, Project, Spec, ProjectBudget, ProjectSecret, FeatureFlag, Vote } from "@prisma/client";

export function fakeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "proposal-1",
    title: "Test Proposal",
    description: "Test description",
    spec: "# Test Spec",
    status: "PROPOSED",
    createdAt: new Date("2026-01-01"),
    createdById: null,
    archivedAt: null,
    seasonId: null,
    ...overrides,
  };
}

export function fakeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Test Project",
    slug: "test-project-ject-1",
    mode: "community",
    ownerScopeType: "user",
    ownerScopeId: null,
    proposalId: "proposal-1",
    // state removed in RA-237, use archivedAt instead
    agent: "codex",
    agentImpl: "direct",
    runnerBackend: "local",
    model: null,
    envOverrides: null,
    requiredSecrets: null,
    claudeAuthMode: null,
    codexAuthMode: null,
    providerBillingMode: "byok",
    cycleImage: "arena-public-worker:local",
    repoUrl: null,
    repoBranch: "main",
    archivedAt: null,
    specSnapshot: null,
    commitSha: null,
    log: null,
    progressJson: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    budgetDebitedUsd: 0,
    isPinned: false,
    visibility: "public",
    showAiDisclaimer: true,
    exploreRank: null,
    vpsServerType: null,
    toolId: null,
    agentLoopVersionId: null,
    tgSpecSourceProjectId: null,
    tgSpecMirrorSpecId: null,
    tgSpecLastImportedVersion: null,
    galleryFeatured: false,
    galleryFeaturedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function fakeSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    id: "spec-1",
    projectId: "project-1",
    title: null,
    content: "# Spec content",
    orderIndex: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function fakeBudget(overrides: Partial<ProjectBudget> = {}): ProjectBudget {
  return {
    id: "budget-1",
    projectId: "project-1",
    isEnabled: false,
    totalCreditsUsd: 0,
    usedCreditsUsd: 0,
    note: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function fakeSecret(overrides: Partial<ProjectSecret> = {}): ProjectSecret {
  return {
    id: "secret-1",
    projectId: "project-1",
    key: "API_KEY",
    encryptedValue: "encrypted",
    iv: "iv",
    authTag: "tag",
    description: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function fakeFeatureFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    key: "test-flag",
    enabled: false,
    updatedById: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

export function fakeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    id: "vote-1",
    userId: "user-1",
    proposalId: "proposal-1",
    ...overrides,
  };
}

import fs from 'fs-extra';
import path from 'path';
import type { Agent } from '../agents/index.js';
import type { ProjectConfig, RalphConfig, SpecMigration } from '../config/types.js';
import { hasMetadataAwareSpecInput, readAcceptedArtifactFeedbackContext } from '../feedback/spec-input.js';
import { log } from '../utils/logger.js';
import { JudgmentLog } from './judgments.js';
import { PlanManager } from './plan-manager.js';
import { Planner } from './planner.js';

export type SpecMigrationApplyRecord = {
  specFile: string;
  specHash: string;
  summary: string;
  source: SpecMigration['specChangeSource'];
  requiredFeedbackItemCount: number;
  plannerApplied: boolean;
};

export type PendingSpecMigrationApplyResult = {
  ownerBoundary: 'ralph.planner-spec-migration-apply';
  applied: boolean;
  recordedCount: number;
  plannerAppliedCount: number;
  records: SpecMigrationApplyRecord[];
};

export type PendingSpecMigrationApplyInput = {
  workDir: string;
  primarySpecPath: string;
  specDirPath?: string;
  planningEnabled: boolean;
  projectConfig: ProjectConfig;
  agent: Agent;
  model?: string;
  timeoutMinutes?: number | null;
  verbose?: boolean;
  visualEvidenceMode: RalphConfig['visualWorkbench']['visualEvidenceMode'];
  planner: Planner;
  planManager: PlanManager;
  judgmentLog: JudgmentLog;
  onBeforePlannerApply?: (input: { specFile: string; specPath: string }) => void | Promise<void>;
};

export async function collectMarkdownFiles(dir: string): Promise<string[]> {
  if (!await fs.pathExists(dir)) return [];

  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(full);
    }
  }
  return files.sort();
}

export async function discoverSpecMigrationCandidates(input: {
  workDir: string;
  primarySpecPath: string;
  specDirPath?: string;
}): Promise<string[]> {
  const primaryAbs = path.resolve(input.primarySpecPath);
  const candidates = new Set<string>([primaryAbs]);

  if (
    primaryAbs === path.resolve(input.workDir, 'spec.md')
    && await hasMetadataAwareSpecInput(input.workDir)
  ) {
    return await fs.pathExists(primaryAbs) ? [primaryAbs] : [];
  }

  const specsDir = input.specDirPath
    ? path.resolve(input.specDirPath)
    : path.join(input.workDir, 'specs');
  for (const file of await collectMarkdownFiles(specsDir)) {
    candidates.add(path.resolve(file));
  }

  const existing: string[] = [];
  for (const file of candidates) {
    if (await fs.pathExists(file)) {
      existing.push(file);
    }
  }

  const rest = existing.filter((file) => file !== primaryAbs).sort();
  return [primaryAbs, ...rest];
}

export async function hasPendingSpecMigrations(input: {
  workDir: string;
  primarySpecPath: string;
  specDirPath?: string;
  planManager: PlanManager;
}): Promise<boolean> {
  const specFiles = await discoverSpecMigrationCandidates(input);
  for (const specFile of specFiles) {
    const relative = path.relative(input.workDir, specFile);
    const hash = await input.planManager.computeSpecHash(specFile);
    if (!input.planManager.hasSpecMigration(relative, hash)) {
      return true;
    }
  }
  return false;
}

export async function shouldRecordLegacySingleSpecBootstrap(input: {
  workDir: string;
  specFile: string;
}): Promise<boolean> {
  const specAbs = path.resolve(input.specFile);
  if (specAbs !== path.resolve(input.workDir, 'spec.md')) return true;

  const acceptedArtifactContext = await readAcceptedArtifactFeedbackContext(input.workDir);
  return !acceptedArtifactContext || acceptedArtifactContext.requiredItems.length === 0;
}

export async function applyPendingSpecMigrations(
  input: PendingSpecMigrationApplyInput,
): Promise<PendingSpecMigrationApplyResult> {
  const records: SpecMigrationApplyRecord[] = [];
  if (!input.planningEnabled) {
    return emptyResult(records);
  }

  const specFiles = await discoverSpecMigrationCandidates({
    workDir: input.workDir,
    primarySpecPath: input.primarySpecPath,
    specDirPath: input.specDirPath,
  });
  if (specFiles.length === 0) {
    return emptyResult(records);
  }

  let recordedCount = 0;
  let plannerAppliedCount = 0;

  for (const specFile of specFiles) {
    const relative = path.relative(input.workDir, specFile);
    const hash = await input.planManager.computeSpecHash(specFile);
    if (input.planManager.hasSpecMigration(relative, hash)) {
      continue;
    }

    const noWorkRecord = await recordNoWorkAcceptedArtifactMigrationIfSafe({
      workDir: input.workDir,
      specFile,
      relative,
      hash,
      specDirPath: input.specDirPath,
      planManager: input.planManager,
    });
    if (noWorkRecord) {
      recordedCount++;
      records.push(noWorkRecord);
      continue;
    }

    await input.onBeforePlannerApply?.({ specFile: relative, specPath: specFile });
    log.info(`Spec migration detected: ${relative}`);

    const migration = await input.planner.applySpecMigration({
      workDir: input.workDir,
      specPath: specFile,
      projectConfig: input.projectConfig,
      agent: input.agent,
      model: input.model,
      timeoutMinutes: input.timeoutMinutes,
      verbose: input.verbose,
      visualEvidenceMode: input.visualEvidenceMode,
    }, input.planManager, input.judgmentLog);

    input.planManager.recordSpecMigration(relative, hash, {
      summary: migration.summary,
      specChangeSource: migration.specChangeSource,
      requiredFeedbackItems: migration.requiredFeedbackItems,
      feedbackDispositions: migration.feedbackDispositions,
    });
    await input.planManager.save();
    await input.judgmentLog.save();
    recordedCount++;
    plannerAppliedCount++;

    records.push({
      specFile: relative,
      specHash: hash,
      summary: migration.summary,
      source: migration.specChangeSource,
      requiredFeedbackItemCount: migration.requiredFeedbackItems.length,
      plannerApplied: true,
    });

    log.success(
      `Spec migration applied (${relative}): ${migration.appliedChanges} change(s), ${migration.newJudgments} judgment(s)`,
    );
  }

  return {
    ownerBoundary: 'ralph.planner-spec-migration-apply',
    applied: recordedCount > 0,
    recordedCount,
    plannerAppliedCount,
    records,
  };
}

function emptyResult(records: SpecMigrationApplyRecord[]): PendingSpecMigrationApplyResult {
  return {
    ownerBoundary: 'ralph.planner-spec-migration-apply',
    applied: false,
    recordedCount: 0,
    plannerAppliedCount: 0,
    records,
  };
}

async function recordNoWorkAcceptedArtifactMigrationIfSafe(input: {
  workDir: string;
  specFile: string;
  relative: string;
  hash: string;
  specDirPath?: string;
  planManager: PlanManager;
}): Promise<SpecMigrationApplyRecord | null> {
  const specAbs = path.resolve(input.specFile);
  if (specAbs !== path.resolve(input.workDir, 'spec.md')) return null;
  if (input.planManager.hasUnfinishedTasks()) return null;

  const acceptedArtifactContext = await readAcceptedArtifactFeedbackContext(input.workDir);
  if (!acceptedArtifactContext || acceptedArtifactContext.requiredItems.length > 0) return null;

  const handledSpecs = await collectHandledMaterializedSpecHistory({
    workDir: input.workDir,
    primaryAbs: specAbs,
    specDirPath: input.specDirPath,
    planManager: input.planManager,
  });
  input.planManager.currentPlan.specFile = input.relative;
  input.planManager.currentPlan.specHash = input.hash;
  const summary = handledSpecs.length > 0
    ? `Recorded canonical accepted spec identity with no loop-work required items; legacy materialized specs already handled: ${handledSpecs.join(', ')}`
    : 'Recorded accepted spec identity with no loop-work required items.';
  input.planManager.recordSpecMigration(input.relative, input.hash, {
    summary,
    specChangeSource: acceptedArtifactContext.specChangeSource,
    requiredFeedbackItems: [],
    feedbackDispositions: [],
  });
  await input.planManager.save();
  log.info(`Recorded no-work accepted artifact migration for ${input.relative}`);
  return {
    specFile: input.relative,
    specHash: input.hash,
    summary,
    source: acceptedArtifactContext.specChangeSource,
    requiredFeedbackItemCount: 0,
    plannerApplied: false,
  };
}

async function collectHandledMaterializedSpecHistory(input: {
  workDir: string;
  primaryAbs: string;
  specDirPath?: string;
  planManager: PlanManager;
}): Promise<string[]> {
  const specsDir = input.specDirPath
    ? path.resolve(input.specDirPath)
    : path.join(input.workDir, 'specs');
  const materializedSpecs = (await collectMarkdownFiles(specsDir))
    .map((file) => path.resolve(file))
    .filter((file) => file !== input.primaryAbs);
  if (materializedSpecs.length === 0) return [];

  const handledSpecs: string[] = [];
  for (const specFile of materializedSpecs) {
    const relative = path.relative(input.workDir, specFile);
    const hash = await input.planManager.computeSpecHash(specFile);
    if (!input.planManager.hasSpecMigration(relative, hash)) {
      return [];
    }
    handledSpecs.push(relative);
  }

  return handledSpecs;
}

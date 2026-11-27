import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { TaskIdSchema, type Task, type VerificationResult, type IterationLog, type VisualEvidenceMode } from '../config/types.js';
import { isQATask } from '../control/qa-planner.js';
import {
  COMMUNITY_QA_CONTEXT_TEMPLATE,
  PRODUCT_SKILL_TEMPLATE,
  UX_SKILL_TEMPLATE,
  renderExecutorAutonomousInstructions,
  renderExecutorActiveWipReconciliation,
  renderExecutorErrorsSection,
  renderExecutorIterationHistory,
  renderExecutorSecretsSection,
  renderExecutorTaskSection,
  renderExecutorVerificationSection,
  renderProjectGoalSection,
  renderReferenceSection,
} from '../prompts/repository.js';

export interface ContextOptions {
  workDir: string;
  task: Task;
  previousErrors?: string[];
  verificationResult?: VerificationResult;
  iteration: number;
  completionPromise: string;
  iterationHistory?: IterationLog[];
  specPath: string;
  projectGoal?: string;
  planSummary?: string;
  activeWipReconciliation?: boolean;
  visualEvidenceMode?: VisualEvidenceMode;
  /** RA-374: hard iteration wall-clock limit; surfaced to the agent as a time budget. */
  iterationTimeoutMinutes?: number;
  // Arena QA feedback
  qaFeedback?: string;
}

export interface ExecutorContextSectionsInput {
  task: Task;
  iteration: number;
  autonomousInstructions: string;
  taskWorkspaceRelativePath?: string;
  platformPromptSection?: string | null;
  secretsSection?: string | null;
  previousErrors?: string[];
  verificationResult?: VerificationResult;
  iterationHistory?: IterationLog[];
  specPath: string;
  projectGoal?: string;
  planSummary?: string;
  activeWipReconciliation?: boolean;
  visualEvidenceMode?: VisualEvidenceMode;
  qaFeedback?: string;
}

export const TASK_WORKSPACE_PLAN_TEMPLATE_HINT = 'Write/update this before product code changes.';

export function getTaskWorkspaceRelativePath(taskId: string): string {
  return path.posix.join('.ralph', 'tasks', TaskIdSchema.parse(taskId));
}

export function getTaskWorkspaceAbsolutePath(workDir: string, taskId: string): string {
  return path.join(workDir, ...getTaskWorkspaceRelativePath(taskId).split('/'));
}

export function buildTaskWorkspacePlanTemplate(taskId: string): string {
  return [
    `# ${TaskIdSchema.parse(taskId)} Plan`,
    '',
    TASK_WORKSPACE_PLAN_TEMPLATE_HINT,
    '',
    '## Approach',
    '- ',
    '',
    '## Files / Surfaces',
    '- ',
    '',
    '## Checks',
    '- ',
    '',
  ].join('\n');
}

export function buildExecutorContextSections(options: ExecutorContextSectionsInput): string {
  const sections: string[] = [];

  sections.push(options.autonomousInstructions);

  if (options.platformPromptSection) {
    sections.push(options.platformPromptSection);
  }

  if (options.secretsSection) {
    sections.push(options.secretsSection);
  }

  sections.push(renderExecutorTaskSection({
    task: options.task,
    iteration: options.iteration,
    taskFolder: options.taskWorkspaceRelativePath,
    withScopeBoundary: true,
    visualEvidenceMode: options.visualEvidenceMode,
  }));

  if (options.activeWipReconciliation) {
    sections.push(renderExecutorActiveWipReconciliation());
  }

  if (options.qaFeedback) {
    sections.push(options.qaFeedback);
  }

  if (isQATask(options.task.id)) {
    sections.push(COMMUNITY_QA_CONTEXT_TEMPLATE);
  }

  if (options.projectGoal) {
    sections.push(renderProjectGoalSection(options.projectGoal));
  }
  sections.push(renderReferenceSection({
    specPath: options.specPath,
    planSummary: options.planSummary,
  }));

  if (options.previousErrors && options.previousErrors.length > 0) {
    sections.push(renderExecutorErrorsSection(options.previousErrors));
  }

  if (options.iterationHistory && options.iterationHistory.length > 0) {
    sections.push(renderExecutorIterationHistory(options.iterationHistory));
  }

  if (options.verificationResult && !options.verificationResult.passed) {
    sections.push(renderExecutorVerificationSection(options.verificationResult));
  }

  return sections.join('\n\n---\n\n');
}

export class ContextBuilder {
  /**
   * Build full context for agent
   */
  async build(options: ContextOptions): Promise<string> {
    const {
      workDir,
      task,
      previousErrors,
      verificationResult,
      iteration,
      completionPromise,
      iterationHistory,
      specPath,
      projectGoal,
      planSummary,
      activeWipReconciliation,
      visualEvidenceMode,
      iterationTimeoutMinutes,
      qaFeedback,
    } = options;

    const taskWorkspace = await this.prepareTaskWorkspace(workDir, task);
    let platformPromptSection: string | null = null;
    const platformPromptPath = path.join(workDir, '.arena', 'platform.md');
    if (await fs.pathExists(platformPromptPath)) {
      platformPromptSection = this.buildPlatformPromptSection(await fs.readFile(platformPromptPath, 'utf-8'));
    }

    const secretsSection = await this.buildSecretsSection(workDir);

    return buildExecutorContextSections({
      task,
      iteration,
      autonomousInstructions: this.buildAutonomousInstructions(completionPromise, iterationTimeoutMinutes),
      taskWorkspaceRelativePath: taskWorkspace.relativePath,
      platformPromptSection,
      secretsSection,
      previousErrors,
      verificationResult,
      iterationHistory,
      specPath,
      projectGoal,
      planSummary,
      activeWipReconciliation,
      visualEvidenceMode,
      qaFeedback,
    });
  }
  
  private buildPlatformPromptSection(rawPrompt: string): string {
    const lines = rawPrompt
      .split(/\r?\n/)
      .filter((line) => !isResultJsonLifecycleInstruction(line));
    const prompt = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!rawPrompt.includes('.arena/result.json')) return prompt;

    return [
      prompt,
      '## Ralph Executor Note',
      'Ralph runtime handles `.arena/result.json`; product executor tasks must not use it as a completion or verification mechanism.',
    ].filter(Boolean).join('\n\n');
  }

  private async buildSecretsSection(workDir: string): Promise<string | null> {
    const hasArenaSecretsFile = await fs.pathExists(path.join(workDir, '.env.arena-secrets'));
    const isArenaRuntime = !!(process.env.ARENA_PROJECT_ID && process.env.ARENA_GOVERNANCE_URL);

    return renderExecutorSecretsSection({ isArenaRuntime, hasArenaSecretsFile });
  }
  
  private async prepareTaskWorkspace(workDir: string, task: Task): Promise<{ relativePath: string }> {
    const relativePath = getTaskWorkspaceRelativePath(task.id);
    const absolutePath = getTaskWorkspaceAbsolutePath(workDir, task.id);
    const skillsPath = path.join(workDir, '.ralph', 'task-skills');

    await fs.ensureDir(absolutePath);
    await fs.ensureDir(skillsPath);
    await fs.outputFile(path.join(skillsPath, 'product.md'), PRODUCT_SKILL_TEMPLATE);
    await fs.outputFile(path.join(skillsPath, 'ux.md'), UX_SKILL_TEMPLATE);
    await fs.outputFile(path.join(absolutePath, 'brief.md'), this.buildTaskWorkspaceBrief(task, relativePath));
    await this.outputFileIfMissing(path.join(absolutePath, 'plan.md'), buildTaskWorkspacePlanTemplate(task.id));

    return { relativePath };
  }

  private async outputFileIfMissing(filePath: string, content: string): Promise<void> {
    if (await fs.pathExists(filePath)) return;
    await fs.outputFile(filePath, content);
  }

  private buildTaskWorkspaceBrief(task: Task, relativePath: string): string {
    const rolePasses = task.requiredRolePasses?.length
      ? task.requiredRolePasses.map((role) => `- ${role}`).join('\n')
      : '- none';
    const linkedRefs = task.feedbackItemRefs?.length
      ? task.feedbackItemRefs.map((ref) => {
        const target = [
          ref.targetType ? `type=${ref.targetType}` : '',
          ref.targetId ? `target=${ref.targetId}` : '',
          ref.changeType ? `change=${ref.changeType}` : '',
          ref.workImpact ? `impact=${ref.workImpact}` : '',
          ref.workSurface ? `surface=${ref.workSurface}` : '',
          ref.status ? `status=${ref.status}` : '',
          ref.diffItemId && ref.diffItemId !== ref.itemId ? `diff=${ref.diffItemId}` : '',
        ].filter(Boolean).join(', ');
        return [
          `- ${ref.itemId}${target ? ` (${target})` : ''}`,
          ref.summary ? `  Summary: ${ref.summary}` : '',
          ref.sourceRefs?.length ? `  Source refs: ${ref.sourceRefs.join(', ')}` : '',
          this.renderSourceEvidenceLines(ref.sourceEvidence),
        ].filter(Boolean).join('\n');
      }).join('\n')
      : '- none';

    return [
      `# ${task.id} Task Workspace`,
      '',
      `Folder: \`${relativePath}/\``,
      '',
      'This folder is private Ralph task working context. Accepted spec/diff remains product truth.',
      '',
      '## Task',
      task.displayTitle ? `Title: ${task.displayTitle}` : undefined,
      task.description,
      '',
      '## Acceptance Criteria',
      ...task.acceptanceCriteria.map((criteria) => `- ${criteria}`),
      '',
      '## Required Role Passes',
      rolePasses,
      '',
      '## Current Accepted Diff Packet',
      'These rows are the accepted spec/diff truth linked to this task. If task prose is vaguer than this packet, follow this packet.',
      'If source evidence says a visible label/control/state must be absent or replaced, verify absence as well as the new presence.',
      linkedRefs,
      '',
      '## Allowed Files In This Folder',
      '- `plan.md` always, written/updated before product code changes',
      '- `product.md` when `product` is required',
      '- `ux.md` when `ux` is required',
      '- `implementation-notes.md` or `audit.md` only when they help this task stay clear',
      '',
      'Do not edit `.ralph/plan.json`, `.ralph/agent-logs/`, `.ralph/controller-reports/`, or `.arena/` files to manufacture closure evidence.',
    ].filter((line): line is string => line !== undefined).join('\n');
  }

  private renderSourceEvidenceLines(evidence: NonNullable<Task['feedbackItemRefs']>[number]['sourceEvidence'] | undefined): string {
    if (!evidence?.length) return '';
    return [
      '  Source evidence:',
      ...evidence.map((entry) => {
        const parts = [
          entry.quote ? `quote=${JSON.stringify(this.compactSingleLine(entry.quote))}` : '',
          entry.intent ? `intent=${JSON.stringify(this.compactSingleLine(entry.intent))}` : '',
        ].filter(Boolean).join('; ');
        return `    - ${entry.sourceRef}${parts ? `: ${parts}` : ''}`;
      }),
    ].join('\n');
  }

  private compactSingleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  // ── Spec-driven mode sections ────────────────────────────────

  private buildAutonomousInstructions(completionPromise: string, iterationTimeoutMinutes?: number): string {
    const seed = crypto.randomBytes(4).toString('hex');
    return renderExecutorAutonomousInstructions({ completionPromise, seed, iterationTimeoutMinutes });
  }
}

function isResultJsonLifecycleInstruction(line: string): boolean {
  const normalized = line.toLowerCase();
  if (!normalized.includes('result.json')) return false;
  if (normalized.includes('do not') || normalized.includes('must not')) return false;

  return (
    normalized.includes('write')
    || normalized.includes('completion')
    || normalized.includes('failure')
    || normalized.includes('loop writes')
    || normalized.includes('lifecycle signal')
  );
}

import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import type {
  AgentError,
  AgentResult,
  Judgment,
  FeedbackEvidence,
  FeedbackItemRef,
  FeedbackSourceEvidence,
  Phase,
  Plan,
  PlanChange,
  ProjectConfig,
  SpecFeedbackDisposition,
  SpecMigrationFeedbackItem,
  SpecMigrationSource,
  Task,
} from '../config/types.js';
import {
  PhaseSchema,
  JudgmentSchema,
  PlanChangeSchema,
  SpecFeedbackDispositionSchema,
  type VisualEvidenceMode,
} from '../config/types.js';
import type { Agent } from '../agents/base.js';
import {
  ProviderCallCheckpointStore,
  executeAgentWithProviderCallCheckpoint,
} from '../agents/provider-call-checkpoint.js';
import { PlanManager } from './plan-manager.js';
import { JudgmentLog } from './judgments.js';
import { log } from '../utils/logger.js';
import { extractTextFromStreamJson } from '../utils/stream-json.js';
import {
  extractCurrentFeedbackItems,
  getWorkRequiredFeedbackItems,
  type SpecFeedbackItem,
} from '../feedback/spec-feedback.js';
import {
  CONCRETE_CLOSURE_EVIDENCE_KINDS,
  hasPositiveFeedbackEvidenceForItem,
} from '../feedback/evidence.js';
import {
  readAcceptedArtifactFeedbackContext,
  type AcceptedArtifactLegacyOperatorRepairCutover,
} from '../feedback/spec-input.js';
import { appendPromptModelCallTrace } from '../prompts/runtime-trace.js';
import {
  renderPlannerInitialPrompt,
  renderPlannerReplanPrompt,
  renderPlannerSpecMigrationPrompt,
} from '../prompts/repository.js';
import {
  parsePlannerAgentOutput,
  validatePlannerParsedAgentOutput,
  type PlannerParsedAgentOutput,
  type PlannerValidatedAgentOutput,
} from './planner-output.js';

export interface PlannerOptions {
  workDir: string;
  specPath: string;
  projectConfig: ProjectConfig;
  agent: Agent;
  model?: string;
  verbose?: boolean;
  visualEvidenceMode?: VisualEvidenceMode;
  timeoutMinutes?: number | null;
}

export const PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY = 'ralph.planner.initial-dry-run' as const;

export interface PlannerInitialDryRunResult {
  ownerBoundary: typeof PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY;
  promptId: 'planner.initial';
  status: 'parsed' | 'agent_failed' | 'parse_or_validation_failed';
  prompt: string;
  spec: {
    path: string;
    relativePath: string;
    sha256: string;
    charCount: number;
  };
  projectContext: {
    charCount: number;
  };
  acceptedDiff: {
    requiredItemCount: number;
    specChangeSource?: SpecMigrationSource;
  };
  agentResult: AgentResult;
  parsedOutput: PlannerParsedAgentOutput | null;
  validatedOutput: PlannerValidatedAgentOutput | null;
  error: null | {
    code: 'agent_failed' | 'parse_or_validation_failed';
    message: string;
  };
}

export interface SpecMigrationApplyResult {
  summary: string;
  appliedChanges: number;
  errors: string[];
  newJudgments: number;
  specChangeSource?: SpecMigrationSource;
  requiredFeedbackItems: SpecMigrationFeedbackItem[];
  feedbackDispositions: SpecFeedbackDisposition[];
}

type LegacyOperatorRepairCutoff = {
  system?: string;
  projectId?: string;
  sourceVersion: number;
  maxAcknowledgedSourceVersion: number;
};

const PLANNER_SPEC_MIGRATION_COMPLETED_TASK_HISTORY_LIMIT = 12;
const PLANNER_SPEC_MIGRATION_JUDGMENT_HISTORY_LIMIT = 12;
const PLANNER_SPEC_MIGRATION_HISTORY_LIMIT = 8;
const CONCRETE_CLOSURE_EVIDENCE_KIND_LIST = CONCRETE_CLOSURE_EVIDENCE_KINDS.map((kind) => `"${kind}"`).join(', ');
const SOURCE_EVIDENCE_CLOSURE_EVIDENCE_KINDS: FeedbackEvidence['kind'][] = [
  'post_deploy_smoke',
  'screenshot',
  'vision_qa',
  'manual_note',
];
const SOURCE_EVIDENCE_CLOSURE_EVIDENCE_KIND_LIST = SOURCE_EVIDENCE_CLOSURE_EVIDENCE_KINDS.map((kind) => `"${kind}"`).join(', ');

function compactText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}


interface SpecMigrationFeedbackContext {
  specChangeSource?: SpecMigrationSource;
  requiredItems: SpecMigrationFeedbackItem[];
  extractedItems: SpecFeedbackItem[];
}

interface InitialAcceptedDiffContext {
  specChangeSource?: SpecMigrationSource;
  requiredItems: SpecMigrationFeedbackItem[];
}

type SpecMigrationFeedbackItemWithSource = SpecMigrationFeedbackItem & {
  specChangeSource?: SpecMigrationSource;
};

interface FeedbackDispositionValidationOptions {
  initialPlanTaskIds?: ReadonlySet<string>;
}

export class PlannerAgentFailure extends Error {
  agentError?: AgentError;

  constructor(message: string, agentError?: AgentError) {
    super(message);
    this.name = 'PlannerAgentFailure';
    this.agentError = agentError;
  }
}

/**
 * Planner — reads spec.md, calls Claude to decompose into phases + tasks + judgments.
 * Produces plan.json via PlanManager.
 */
export class Planner {
  private throwAgentFailure(prefix: string, result: AgentResult): never {
    throw new PlannerAgentFailure(`${prefix}: ${result.output}`, result.error);
  }

  private isRateLimitFailure(error: unknown): error is PlannerAgentFailure {
    return error instanceof PlannerAgentFailure && error.agentError?.category === 'rate_limit';
  }
  
  /**
   * Generate a plan from spec.md
   */
  async createPlan(options: PlannerOptions, planManager: PlanManager, judgmentLog: JudgmentLog): Promise<void> {
    const { workDir, specPath, projectConfig, agent, verbose } = options;

    // 1. Read spec
    const specContent = await fs.readFile(specPath, 'utf-8');
    log.info(`Spec loaded: ${specPath} (${specContent.length} chars)`);

    // 2. Read existing project files for context (if any)
    const projectContext = await this.gatherProjectContext(workDir);
    const relativeSpec = path.relative(workDir, specPath);
    const initialAcceptedDiffContext = await this.buildInitialAcceptedDiffContext(workDir, relativeSpec);

    // 3-10. Execute with retry loop
    let lastError: string | undefined;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // 3. Build planning prompt (with error feedback if retrying)
        const prompt = this.buildPlanningPrompt(
          specContent,
          projectConfig,
          projectContext,
          initialAcceptedDiffContext?.requiredItems ?? [],
          options.visualEvidenceMode,
          lastError,
        );

        // 4. Call agent
        log.info(`Planner: asking agent to decompose spec into phases and tasks... (attempt ${attempt}/${maxAttempts})`);
        const result = await executeAgentWithProviderCallCheckpoint({
          store: new ProviderCallCheckpointStore(workDir),
          owner: 'planner',
          operation: 'planner.initial',
          agent,
          options: {
            workDir,
            prompt,
            model: options.model,
            timeout: options.timeoutMinutes ?? undefined,
            verbose: verbose ?? true,
          },
        });
        await this.recordPromptTrace(workDir, {
          promptId: 'planner.initial',
          label: 'Initial autonomous project plan',
          prompt,
          result,
          model: options.model,
          context: {
            attempt,
            maxAttempts,
            specPath: path.relative(workDir, specPath),
          },
        });

        if (!result.success) this.throwAgentFailure('Planner agent failed', result);

        // 5. Parse structured output from agent
        const parsedOutput = this.parseAgentOutput(result.output);

        // 6. Validate with Zod
        const {
          phases: validPhases,
          judgments: validJudgments,
          projectGoal,
          feedbackDispositions: rawFeedbackDispositions = [],
        } = validatePlannerParsedAgentOutput(parsedOutput);

        // 7. Create plan
        planManager.createPlan(relativeSpec, validPhases, validJudgments, projectGoal);

        // Set spec hash
        const specHash = await planManager.computeSpecHash(specPath);
        planManager.currentPlan.specHash = specHash;
        if (initialAcceptedDiffContext && initialAcceptedDiffContext.requiredItems.length > 0) {
          const feedbackDispositions = this.validateInitialAcceptedDiffDispositions(
            initialAcceptedDiffContext.requiredItems,
            rawFeedbackDispositions,
            planManager.currentPlan,
            validJudgments,
          );
          this.attachFeedbackRefsToTasks(
            planManager,
            feedbackDispositions,
            initialAcceptedDiffContext.requiredItems,
            relativeSpec,
            specHash,
          );
          planManager.recordSpecMigration(relativeSpec, specHash, {
            summary: 'Initial accepted diff bootstrap',
            specChangeSource: initialAcceptedDiffContext.specChangeSource,
            requiredFeedbackItems: initialAcceptedDiffContext.requiredItems,
            feedbackDispositions,
          });
        } else if (await this.shouldRecordInitialSpecBootstrap(workDir, relativeSpec)) {
          planManager.recordSpecMigration(relativeSpec, specHash, 'Initial spec bootstrap');
        } else {
          log.info('Initial plan has accepted diff work; leaving spec migration unrecorded for structured disposition.');
        }

        // 8. Record judgments in audit log
        for (const j of validJudgments) {
          judgmentLog.record(j);
        }

        // 9. Save
        await planManager.save();
        await judgmentLog.save();

        // 10. Report
        const stats = planManager.getStats();
        log.success(`Plan created: ${stats.totalPhases} phases, ${stats.totalTasks} tasks, ${stats.totalJudgments} judgments`);

        return; // Success!

      } catch (err: any) {
        if (this.isRateLimitFailure(err)) {
          throw err;
        }

        lastError = `${err.message}\n\nIf this is a validation error for missing fields (like "madeBy"), make sure ALL required fields are included in your JSON output.`;

        if (attempt >= maxAttempts) {
          throw new Error(`Planner failed after ${maxAttempts} attempts. Last error: ${err.message}`);
        }

        log.warn(`Planner attempt ${attempt} failed: ${err.message}. Retrying...`);
      }
    }
  }

  /**
   * Render and execute the initial planner prompt without applying the result
   * to PlanManager, prompt traces, judgments, task evidence or lifecycle truth.
   *
   * This is the production planner owner exposing a lab-safe dry-run boundary. It
   * intentionally performs one provider call and no retries so the operator can
   * observe exactly one stage execution.
   */
  async dryRunInitialPlan(options: PlannerOptions): Promise<PlannerInitialDryRunResult> {
    const { workDir, specPath, projectConfig, agent, verbose } = options;
    const specContent = await fs.readFile(specPath, 'utf-8');
    const projectContext = await this.gatherProjectContext(workDir);
    const relativeSpec = path.relative(workDir, specPath);
    const initialAcceptedDiffContext = await this.buildInitialAcceptedDiffContext(workDir, relativeSpec);
    const prompt = this.buildPlanningPrompt(
      specContent,
      projectConfig,
      projectContext,
      initialAcceptedDiffContext?.requiredItems ?? [],
      options.visualEvidenceMode,
    );

    const agentResult = await agent.execute({
      workDir,
      prompt,
      model: options.model,
      timeout: options.timeoutMinutes ?? undefined,
      verbose: verbose ?? true,
    });

    const base = {
      ownerBoundary: PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY,
      promptId: 'planner.initial' as const,
      prompt,
      spec: {
        path: specPath,
        relativePath: relativeSpec,
        sha256: crypto.createHash('sha256').update(specContent).digest('hex'),
        charCount: specContent.length,
      },
      projectContext: {
        charCount: projectContext.length,
      },
      acceptedDiff: {
        requiredItemCount: initialAcceptedDiffContext?.requiredItems.length ?? 0,
        ...(initialAcceptedDiffContext?.specChangeSource
          ? { specChangeSource: initialAcceptedDiffContext.specChangeSource }
          : {}),
      },
      agentResult,
    };

    if (!agentResult.success) {
      return {
        ...base,
        status: 'agent_failed',
        parsedOutput: null,
        validatedOutput: null,
        error: {
          code: 'agent_failed',
          message: agentResult.error?.message ?? (agentResult.output.slice(0, 500) || 'Planner dry-run agent failed.'),
        },
      };
    }

    try {
      const parsedOutput = this.parseAgentOutput(agentResult.output);
      const validatedOutput = validatePlannerParsedAgentOutput(parsedOutput);
      return {
        ...base,
        status: 'parsed',
        parsedOutput,
        validatedOutput,
        error: null,
      };
    } catch (error) {
      return {
        ...base,
        status: 'parse_or_validation_failed',
        parsedOutput: null,
        validatedOutput: null,
        error: {
          code: 'parse_or_validation_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Re-plan: update existing plan based on changed spec or controller feedback
   */
  async revisePlan(options: PlannerOptions, planManager: PlanManager, judgmentLog: JudgmentLog, reason: string): Promise<void> {
    const { workDir, specPath, projectConfig, agent, verbose } = options;

    const specContent = await fs.readFile(specPath, 'utf-8');
    const currentPlan = planManager.currentPlan;

    let lastError: string | undefined;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const prompt = this.buildReplanPrompt(specContent, currentPlan, projectConfig, reason, options.visualEvidenceMode, lastError);

        log.info(`Planner: revising plan (reason: ${reason})... (attempt ${attempt}/${maxAttempts})`);
        const result = await executeAgentWithProviderCallCheckpoint({
          store: new ProviderCallCheckpointStore(workDir),
          owner: 'planner',
          operation: 'planner.replan',
          agent,
          options: {
            workDir,
            prompt,
            model: options.model,
            timeout: options.timeoutMinutes ?? undefined,
            verbose: verbose ?? true,
          },
        });
        await this.recordPromptTrace(workDir, {
          promptId: 'planner.replan',
          label: 'Plan revision',
          prompt,
          result,
          model: options.model,
          context: {
            attempt,
            maxAttempts,
            reason,
          },
        });

        if (!result.success) this.throwAgentFailure('Planner revision failed', result);

        const parsedOutput = this.parseAgentOutput(result.output);
        const {
          phases: validPhases,
          judgments: validJudgments,
        } = validatePlannerParsedAgentOutput(parsedOutput);

        // Merge: replace phases (keeping completed statuses), add new judgments
        this.mergePlanRevision(planManager, validPhases, validJudgments, judgmentLog);

        await planManager.save();
        await judgmentLog.save();

        const stats = planManager.getStats();
        log.success(`Plan revised: ${stats.totalPhases} phases, ${stats.totalTasks} tasks, ${stats.totalJudgments} judgments`);

        return; // Success!

      } catch (err: any) {
        if (this.isRateLimitFailure(err)) {
          throw err;
        }

        lastError = `${err.message}\n\nIf this is a validation error for missing fields (like "madeBy"), make sure ALL required fields are included in your JSON output.`;

        if (attempt >= maxAttempts) {
          throw new Error(`Planner revision failed after ${maxAttempts} attempts. Last error: ${err.message}`);
        }

        log.warn(`Planner revision attempt ${attempt} failed: ${err.message}. Retrying...`);
      }
    }
  }

  /**
   * Apply an additional spec (migration-style): generate incremental plan changes
   * instead of rebuilding the whole plan from scratch.
   */
  async applySpecMigration(
    options: PlannerOptions,
    planManager: PlanManager,
    judgmentLog: JudgmentLog,
  ): Promise<SpecMigrationApplyResult> {
    const { workDir, specPath, projectConfig, agent, verbose } = options;
    const specContent = await fs.readFile(specPath, 'utf-8');
    const currentPlan = planManager.currentPlan;
    const specFile = path.relative(workDir, specPath);
    const specHash = await planManager.computeSpecHash(specPath);
    const feedbackContext = await this.buildSpecMigrationFeedbackContext(workDir, specContent, currentPlan, {
      specFile,
      specHash,
    });

    let lastError: string | undefined;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const prompt = this.buildSpecMigrationPrompt(
          specContent,
          currentPlan,
          projectConfig,
          this.nextTaskNumber(currentPlan),
          this.nextJudgmentNumber(currentPlan),
          path.basename(specPath),
          feedbackContext.requiredItems,
          options.visualEvidenceMode,
          lastError,
        );

        log.info(`Planner: applying spec migration from ${path.basename(specPath)}... (attempt ${attempt}/${maxAttempts})`);
        const result = await executeAgentWithProviderCallCheckpoint({
          store: new ProviderCallCheckpointStore(workDir),
          owner: 'planner',
          operation: 'planner.specMigration',
          agent,
          options: {
            workDir,
            prompt,
            model: options.model,
            timeout: options.timeoutMinutes ?? undefined,
            verbose: verbose ?? true,
          },
        });
        await this.recordPromptTrace(workDir, {
          promptId: 'planner.specMigration',
          label: 'Accepted spec migration',
          prompt,
          result,
          model: options.model,
          context: {
            attempt,
            maxAttempts,
            specFile,
            specHash,
          },
        });

        if (!result.success) this.throwAgentFailure('Planner spec migration failed', result);

        const parsed = this.parseSpecMigrationOutput(result.output);

        // Gracefully skip invalid changes instead of crashing the whole migration
        const validChanges: PlanChange[] = [];
        for (const c of parsed.planChanges) {
          const result2 = PlanChangeSchema.safeParse(this.stripRuntimeManagedTaskFields(c));
          if (result2.success) {
            validChanges.push(result2.data);
          } else {
            log.warn(`Planner migration: skipping invalid change (${(c as any).action ?? 'unknown'}): ${result2.error.issues.map(i => i.message).join(', ')}`);
          }
        }

        const validJudgments: Judgment[] = [];
        for (const j of parsed.newJudgments) {
          const result2 = JudgmentSchema.safeParse(j);
          if (result2.success) {
            validJudgments.push(result2.data);
          } else {
            log.warn(`Planner migration: skipping invalid judgment: ${result2.error.issues.map(i => i.message).join(', ')}`);
          }
        }

        // Make judgment IDs unique if the model produced collisions.
        const normalizedJudgments = this.normalizeNewJudgments(validJudgments, planManager);
        const activeWipReconciliation = this.normalizeActiveWipFeedbackReconciliation(
          currentPlan,
          feedbackContext.requiredItems,
          parsed.feedbackDispositions,
          validChanges,
        );

        const feedbackDispositions = this.validateFeedbackDispositions(
          feedbackContext.requiredItems,
          activeWipReconciliation.rawDispositions,
          currentPlan,
          activeWipReconciliation.planChanges,
          normalizedJudgments,
        );

        const planBeforeApply = JSON.parse(JSON.stringify(planManager.currentPlan)) as Plan;
        const applyResult = planManager.applyChanges(activeWipReconciliation.planChanges);
        if (feedbackContext.requiredItems.length > 0 && applyResult.errors.length > 0) {
          Object.assign(planManager.currentPlan, planBeforeApply);
          throw new Error(
            `Planner migration produced invalid plan changes for required feedback: ${applyResult.errors.join('; ')}`,
          );
        }

        for (const j of normalizedJudgments) {
          if (!planManager.getJudgments().find(existing => existing.id === j.id)) {
            planManager.addJudgment(j);
            judgmentLog.record(j);
          }
        }
        this.attachFeedbackRefsToTasks(
          planManager,
          feedbackDispositions,
          feedbackContext.requiredItems,
          specFile,
          specHash,
        );

        if (applyResult.errors.length > 0) {
          log.warn(`Planner migration applied with ${applyResult.errors.length} warning(s)`);
          for (const err of applyResult.errors.slice(0, 10)) {
            log.warn(`  - ${err}`);
          }
        }
        if (applyResult.dropped.length > 0) {
          log.warn(`Planner migration dropped ${applyResult.dropped.length} boundary-violating change(s)`);
          for (const drop of applyResult.dropped.slice(0, 10)) {
            log.warn(`  - ${drop}`);
          }
        }

        return {
          summary: parsed.summary || `Applied incremental changes from ${path.basename(specPath)}`,
          appliedChanges: applyResult.applied,
          errors: applyResult.errors,
          newJudgments: normalizedJudgments.length,
          specChangeSource: feedbackContext.specChangeSource,
          requiredFeedbackItems: feedbackContext.requiredItems,
          feedbackDispositions,
        }; // Success!

      } catch (err: any) {
        if (this.isRateLimitFailure(err)) {
          throw err;
        }

        lastError = `${err.message}\n\nIf this is a validation error for missing fields (like "madeBy"), make sure ALL required fields are included in your JSON output.`;

        if (attempt >= maxAttempts) {
          throw new Error(`Planner spec migration failed after ${maxAttempts} attempts. Last error: ${err.message}`);
        }

        log.warn(`Planner migration attempt ${attempt} failed: ${err.message}. Retrying...`);
      }
    }

    // This should never be reached due to throw in the loop, but TypeScript needs it
    throw new Error(`Planner spec migration failed after ${maxAttempts} attempts`);
  }

  // ── Prompt builders ───────────────────────────────────────────

  private buildPlanningPrompt(
    spec: string,
    project: ProjectConfig,
    projectContext: string,
    requiredFeedbackItemsOrPreviousError: SpecMigrationFeedbackItem[] | string = [],
    visualEvidenceModeOrPreviousError?: VisualEvidenceMode | string,
    previousError?: string,
  ): string {
    const seed = crypto.randomBytes(4).toString('hex');
    const requiredFeedbackItems = Array.isArray(requiredFeedbackItemsOrPreviousError)
      ? requiredFeedbackItemsOrPreviousError
      : [];
    const normalizedPreviousError = typeof requiredFeedbackItemsOrPreviousError === 'string'
      ? requiredFeedbackItemsOrPreviousError
      : (typeof visualEvidenceModeOrPreviousError === 'string' && !this.isVisualEvidenceMode(visualEvidenceModeOrPreviousError)
        ? visualEvidenceModeOrPreviousError
        : previousError);
    const visualEvidenceMode = this.isVisualEvidenceMode(visualEvidenceModeOrPreviousError)
      ? visualEvidenceModeOrPreviousError
      : 'off';
    const acceptedDiffPrompt = this.buildInitialAcceptedDiffPromptParts(requiredFeedbackItems);
    return renderPlannerInitialPrompt({
      seed,
      previousErrorBlock: normalizedPreviousError ? `## ⚠️ Previous Attempt Failed - Validation Error

Your previous JSON output had the following error:
${normalizedPreviousError}

Please fix the JSON and regenerate. Pay special attention to required fields.
` : '',
      projectName: project.name,
      projectDescription: project.description,
      techStack: `${project.techStack.language}${project.techStack.framework ? ` / ${project.techStack.framework}` : ''}${project.techStack.runtime ? ` / ${project.techStack.runtime}` : ''}`,
      deployBlock: project.deploy?.localDocker?.enabled
        ? 'Deploy: in-process (npm start with PORT env var). App runs inside worker container, no Docker Compose needed.'
        : '',
      repositoryBlock: project.repository?.url ? `Repository: ${project.repository.url}` : '',
      spec,
      acceptedDiffDispositionsBlock: acceptedDiffPrompt.block,
      acceptedDiffOutputField: acceptedDiffPrompt.outputField,
      acceptedDiffPlannerRules: acceptedDiffPrompt.rules,
      existingProjectFilesBlock: projectContext ? `## Existing project files\n${projectContext}` : '',
      judgmentTimestamp: new Date().toISOString(),
      visualEvidenceMode,
    });
  }

  private isVisualEvidenceMode(value: unknown): value is VisualEvidenceMode {
    return value === 'off' || value === 'required' || value === 'new_tasks_only';
  }

  private async buildInitialAcceptedDiffContext(
    workDir: string,
    relativeSpec: string,
  ): Promise<InitialAcceptedDiffContext | null> {
    if (relativeSpec !== 'spec.md') return null;

    const acceptedArtifactContext = await readAcceptedArtifactFeedbackContext(workDir);
    if (!acceptedArtifactContext || acceptedArtifactContext.requiredItems.length === 0) return null;

    const itemsWithSource = acceptedArtifactContext.requiredItems as SpecMigrationFeedbackItemWithSource[];
    const requiredItems = this.stripSpecChangeSources(itemsWithSource);
    const specChangeSource = this.selectSpecChangeSourceForItems(
      itemsWithSource,
      acceptedArtifactContext.specChangeSource,
    );

    return {
      specChangeSource: {
        ...specChangeSource,
        itemCount: requiredItems.length,
      },
      requiredItems,
    };
  }

  private buildInitialAcceptedDiffPromptParts(requiredFeedbackItems: SpecMigrationFeedbackItem[]): {
    block: string;
    outputField: string;
    rules: string;
  } {
    if (requiredFeedbackItems.length === 0) {
      return { block: '', outputField: '', rules: '' };
    }

    const firstFeedbackItem = requiredFeedbackItems[0];
    const feedbackDispositionExample = `[
    {
      "itemId": "${firstFeedbackItem.itemId}",
      "feedbackStatus": ${firstFeedbackItem.status ? JSON.stringify(firstFeedbackItem.status) : 'null'},
      "disposition": "coveredByOpenTask",
      "taskIds": ["task-001"],
      "relatedCompletedTaskIds": [],
      "evidence": [],
      "judgmentIds": [],
      "reason": "The generated initial task carries this accepted diff product outcome before execution starts."
    }
  ]`;

    return {
      block: `## Required Accepted Diff Work Dispositions

The accepted spec input contains diff-scoped work items that MUST be mapped to the initial execution plan before any task starts.
Return exactly one \`feedbackDispositions[]\` item for each row below.
Ralph will attach structured \`feedbackItemRefs\` itself from these dispositions; do not put \`feedbackItemRefs\` or \`verificationEvidence\` on tasks.

\`\`\`json
${JSON.stringify(this.buildPromptFeedbackItems(requiredFeedbackItems), null, 2)}
\`\`\`

Important:
- Use \`coveredByOpenTask\` for generated initial tasks that implement the accepted diff row.
- Use meaningful product task descriptions and acceptance criteria. A bare \`DIFF-*\`, item id, or target id is too weak.
- Preserve source-evidence contrast/negation/removal semantics by mapping each row to the task that will implement it, but do NOT copy raw \`quote\` or \`intent\` text into task descriptions or acceptance criteria. The structured refs will carry the private evidence.
- Use \`blocked\` only for a real missing dependency or constraint.
- Do not use completed-task, evidence, judgment-only, or proof shortcuts during initial planning.
`,
      outputField: `,
  "feedbackDispositions": ${feedbackDispositionExample}`,
      rules: `
20. If required accepted diff work is listed above, return exactly one \`feedbackDispositions[]\` item for each row. For generated initial work, use \`coveredByOpenTask\` with task ids from your own \`phases[].tasks[]\`; use \`blocked\` only for a real missing dependency. Do NOT include \`feedbackItemRefs\` or \`verificationEvidence\` in task objects.`,
    };
  }

  private validateInitialAcceptedDiffDispositions(
    requiredItems: SpecMigrationFeedbackItem[],
    rawDispositions: unknown[],
    initialPlan: Plan,
    validJudgments: Judgment[],
  ): SpecFeedbackDisposition[] {
    if (requiredItems.length === 0) return [];
    const initialPlanTaskIds = new Set<string>();
    for (const phase of initialPlan.phases) {
      for (const task of phase.tasks) {
        initialPlanTaskIds.add(task.id);
      }
    }

    return this.validateFeedbackDispositions(
      requiredItems,
      rawDispositions,
      initialPlan,
      [],
      validJudgments,
      { initialPlanTaskIds },
    );
  }

  private buildReplanPrompt(
    spec: string,
    currentPlan: any,
    project: ProjectConfig,
    reason: string,
    visualEvidenceMode: VisualEvidenceMode = 'off',
    previousError?: string,
  ): string {
    const seed = crypto.randomBytes(4).toString('hex');
    return renderPlannerReplanPrompt({
      reason,
      seed,
      previousErrorBlock: previousError ? `## ⚠️ Previous Attempt Failed - Validation Error

Your previous JSON output had the following error:
${previousError}

Please fix the JSON and regenerate. Pay special attention to required fields.
` : '',
      spec,
      currentPlanJson: JSON.stringify(currentPlan, null, 2),
      visualEvidenceMode,
    });
  }

  private buildSpecMigrationPrompt(
    newSpec: string,
    currentPlan: Plan,
    project: ProjectConfig,
    nextTaskNumber: number,
    nextJudgmentNumber: number,
    specLabel: string,
    requiredFeedbackItems: SpecMigrationFeedbackItem[] = [],
    visualEvidenceMode: VisualEvidenceMode = 'off',
    previousError?: string,
  ): string {
    const firstFeedbackItem = requiredFeedbackItems[0];
    const feedbackDispositionExample = firstFeedbackItem
      ? `[
    {
      "itemId": "${firstFeedbackItem.itemId}",
      "feedbackStatus": ${firstFeedbackItem.status ? JSON.stringify(firstFeedbackItem.status) : 'null'},
      "disposition": "addTask",
      "taskIds": ["task-${String(nextTaskNumber).padStart(3, '0')}"],
      "relatedCompletedTaskIds": ["task-010"],
      "evidence": [],
      "judgmentIds": [],
      "reason": "The accepted spec says this current diff work remains unresolved; the completed historical task is context only."
    }
  ]`
      : '[]';

    const nextTaskId = `task-${String(nextTaskNumber).padStart(3, '0')}`;
    const nextJudgmentId = `judgment-${String(nextJudgmentNumber).padStart(3, '0')}`;
    const requiredFeedbackDispositionsBlock = requiredFeedbackItems.length > 0 ? `## Required Accepted Diff Work Dispositions

The accepted spec input contains diff-scoped work items that MUST be accounted for before this spec migration can be recorded as handled.
These rows may target product spec, feedback, assumptions, secret requirements, or assets.
Return exactly one \`feedbackDispositions[]\` item for each row below.

\`\`\`json
${JSON.stringify(this.buildPromptFeedbackItems(requiredFeedbackItems), null, 2)}
\`\`\`

Important:
- A completed historical task is context only. It is NOT a valid reason to skip current accepted diff work.
- If the accepted diff requires product work, add a pending follow-up task or update existing open work.
- If a row includes \`sourceEvidence\`, preserve its contrast/negation/removal semantics as product outcome, but do NOT copy raw \`quote\` or \`intent\` text into task descriptions or acceptance criteria. The structured refs will carry the private evidence.
- For \`sourceEvidence\` rows, every task used by \`addTask\`, \`updateOpenTask\`, or \`coveredByOpenTask\` must either already have the current structured \`feedbackItemRef\` or carry the accepted diff summary/product outcome in its description/acceptance criteria. A bare \`DIFF-*\`, item id, or target id is too weak.
- If an existing \`in_progress\` task already owns the same accepted diff target/topic, use \`coveredByOpenTask\` and cite that task. Do not update, remove, complete, or rewrite active WIP; executor will reconcile the active task with the attached structured accepted diff refs.
- If existing open work already covers the item, use \`coveredByOpenTask\` and cite that open task.
- Use \`closedByEvidence\` only with concrete evidence in \`evidence[]\`; task completion alone is not evidence.
- Concrete \`closedByEvidence\` evidence kinds are: ${CONCRETE_CLOSURE_EVIDENCE_KIND_LIST}.
- For \`sourceEvidence\` rows, \`closedByEvidence\` requires product-facing proof using one of: ${SOURCE_EVIDENCE_CLOSURE_EVIDENCE_KIND_LIST}. Generic unit/integration/source/code inspection is implementation evidence only and must not close the source intent row.
- Do NOT invent domain-specific \`evidence[].kind\` values such as \`accepted_spec_asset_list\`.
- For removed asset/reference rows, use \`closedByEvidence\` with \`kind: "code_inspection"\`, \`result: "pass"\`, and a \`ref\`/summary pointing to the accepted spec section showing that the asset/reference is absent.
- Judgments may explain ambiguity, but they do not satisfy or override a hard \`requires_loop_work\` accepted diff item.
- Do not use \`needsJudgment\` as the sole disposition for \`targetType="spec"\` work; create/update implementable work or use \`blocked\` for a real missing dependency.
- Use \`blocked\` when the work is blocked by a real missing dependency or constraint.
` : `## Required Current Feedback Dispositions

No current implementation feedback items require a new disposition for this spec migration. Return \`"feedbackDispositions": []\`.
`;

    return renderPlannerSpecMigrationPrompt({
      previousErrorBlock: previousError ? `## ⚠️ Previous Attempt Failed - Validation Error

Your previous JSON output had the following error:
${previousError}

Please fix the JSON and regenerate. Pay special attention to required fields.
` : '',
      projectName: project.name,
      projectDescription: project.description,
      techStack: `${project.techStack.language}${project.techStack.framework ? ` / ${project.techStack.framework}` : ''}${project.techStack.runtime ? ` / ${project.techStack.runtime}` : ''}`,
      specLabel,
      newSpec,
      requiredFeedbackDispositionsBlock,
      currentPlanJson: this.buildSpecMigrationPlanJson(currentPlan, requiredFeedbackItems),
      nextTaskId,
      feedbackDispositionExample,
      concreteClosureEvidenceKinds: CONCRETE_CLOSURE_EVIDENCE_KIND_LIST,
      nextJudgmentId,
      judgmentTimestamp: new Date().toISOString(),
      visualEvidenceMode,
    });
  }

  private buildPromptFeedbackItems(items: SpecMigrationFeedbackItem[]): Array<Record<string, unknown>> {
    return items.map((item) => ({
      itemId: item.itemId,
      diffItemId: item.diffItemId,
      targetType: item.targetType,
      targetId: item.targetId,
      kind: item.kind,
      changeType: item.changeType,
      workImpact: item.workImpact,
      workSurface: item.workSurface,
      status: item.status,
      summary: compactText(item.summary, 2_000),
      sourceRefs: item.sourceRefs?.slice(0, 12),
      sourceEvidence: item.sourceEvidence?.slice(0, 8).map((evidence) => ({
        sourceRef: evidence.sourceRef,
        quote: compactText(evidence.quote, 600),
        intent: compactText(evidence.intent, 700),
      })),
      fingerprint: item.fingerprint,
    }));
  }

  private buildSpecMigrationPlanJson(plan: Plan, requiredFeedbackItems: SpecMigrationFeedbackItem[]): string {
    const fullPlanJson = JSON.stringify(plan, null, 2);
    const taskEntries = plan.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase, task })));

    const mustInclude = (task: Task) => {
      if (task.status !== 'completed' && task.status !== 'skipped') return true;
      return this.taskMatchesRequiredMigrationItem(task, requiredFeedbackItems);
    };

    const includedTaskIds = new Set(
      taskEntries
        .filter(({ task }) => mustInclude(task))
        .map(({ task }) => task.id),
    );

    const recentCompleted = taskEntries
      .filter(({ task }) => !includedTaskIds.has(task.id) && (task.status === 'completed' || task.status === 'skipped'))
      .slice(-PLANNER_SPEC_MIGRATION_COMPLETED_TASK_HISTORY_LIMIT);
    for (const { task } of recentCompleted) includedTaskIds.add(task.id);

    const compactTask = (task: Task) => ({
      id: task.id,
      displayTitle: task.displayTitle,
      description: compactText(task.description, 700),
      acceptanceCriteria: task.acceptanceCriteria.slice(0, 6).map((item) => compactText(item, 260)).filter(Boolean),
      status: task.status,
      attempts: task.attempts,
      lastError: compactText(task.lastError, 500),
      priority: task.priority,
      dependencies: task.dependencies,
      addedBy: task.addedBy,
      requiredRolePasses: task.requiredRolePasses,
      feedbackItemRefs: task.feedbackItemRefs?.map((ref) => ({
        itemId: ref.itemId,
        diffItemId: ref.diffItemId,
        targetType: ref.targetType,
        targetId: ref.targetId,
        changeType: ref.changeType,
        workImpact: ref.workImpact,
        workSurface: ref.workSurface,
        status: ref.status,
        summary: compactText(ref.summary, 360),
        sourceRefs: ref.sourceRefs?.slice(0, 8),
        sourceEvidence: ref.sourceEvidence?.slice(0, 4).map((evidence) => ({
          sourceRef: evidence.sourceRef,
          quote: compactText(evidence.quote, 260),
          intent: compactText(evidence.intent, 320),
        })),
        fingerprint: ref.fingerprint,
      })),
      verificationEvidence: task.verificationEvidence?.slice(-4).map((evidence) => ({
        kind: evidence.kind,
        ref: evidence.ref,
        observedAt: evidence.observedAt,
        summary: compactText(evidence.summary, 320),
        result: evidence.result,
        feedbackItemIds: evidence.feedbackItemIds,
        taskId: evidence.taskId,
        command: compactText(evidence.command, 220),
        artifactPath: evidence.artifactPath,
        artifactSha256: evidence.artifactSha256,
        recordedBy: evidence.recordedBy,
        target: evidence.target ? {
          route: evidence.target.route,
          viewport: evidence.target.viewport,
          claim: compactText(evidence.target.claim, 320),
          state: compactText(evidence.target.state, 320),
          interaction: compactText(evidence.target.interaction, 320),
        } : undefined,
      })),
    });

    const compactPhases = plan.phases
      .map((phase) => ({
        id: phase.id,
        name: phase.name,
        description: compactText(phase.description, 500),
        order: phase.order,
        status: phase.status,
        planLater: phase.planLater,
        omittedTaskCount: phase.tasks.filter((task) => !includedTaskIds.has(task.id)).length,
        tasks: phase.tasks
          .filter((task) => includedTaskIds.has(task.id))
          .map(compactTask),
      }))
      .filter((phase) => phase.tasks.length > 0 || phase.status !== 'completed' || phase.planLater);

    const compactJudgment = (judgment: Judgment) => ({
      id: judgment.id,
      timestamp: judgment.timestamp,
      phaseId: judgment.phaseId,
      taskId: judgment.taskId,
      ambiguity: compactText(judgment.ambiguity, 500),
      options: judgment.options.slice(0, 5).map((option) => compactText(option, 260)).filter(Boolean),
      chosen: judgment.chosen,
      reasoning: compactText(judgment.reasoning, 700),
      madeBy: judgment.madeBy,
      revisedBy: judgment.revisedBy,
      previousChoice: judgment.previousChoice,
    });

    const compactSpecMigration = (migration: Plan['specMigrations'][number]) => ({
      id: migration.id,
      specFile: migration.specFile,
      specHash: migration.specHash,
      appliedAt: migration.appliedAt,
      summary: compactText(migration.summary, 700),
      specChangeSource: migration.specChangeSource,
      requiredFeedbackItems: migration.requiredFeedbackItems?.slice(0, 20).map((item) => ({
        itemId: item.itemId,
        diffItemId: item.diffItemId,
        targetType: item.targetType,
        targetId: item.targetId,
        changeType: item.changeType,
        workImpact: item.workImpact,
        workSurface: item.workSurface,
        status: item.status,
        summary: compactText(item.summary, 320),
        sourceRefs: item.sourceRefs?.slice(0, 8),
        sourceEvidence: item.sourceEvidence?.slice(0, 3).map((evidence) => ({
          sourceRef: evidence.sourceRef,
          quote: compactText(evidence.quote, 220),
          intent: compactText(evidence.intent, 260),
        })),
        fingerprint: item.fingerprint,
      })),
      feedbackDispositions: migration.feedbackDispositions?.slice(0, 30).map((disposition) => ({
        itemId: disposition.itemId,
        feedbackStatus: disposition.feedbackStatus,
        disposition: disposition.disposition,
        taskIds: disposition.taskIds?.slice(0, 12),
        reason: compactText(disposition.reason, 320),
        relatedCompletedTaskIds: disposition.relatedCompletedTaskIds?.slice(0, 12),
        judgmentIds: disposition.judgmentIds?.slice(0, 12),
      })),
    });

    return JSON.stringify({
      version: plan.version,
      specFile: plan.specFile,
      specHash: plan.specHash,
      projectGoal: compactText(plan.projectGoal, 900),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      migrationPlannerProjection: {
        originalCharCount: fullPlanJson.length,
        originalPhaseCount: plan.phases.length,
        originalTaskCount: taskEntries.length,
        includedTaskCount: includedTaskIds.size,
        omittedTaskCount: Math.max(0, taskEntries.length - includedTaskIds.size),
        inclusionRule: 'open/failed/in-progress tasks, tasks linked to current accepted diff targets, plus recent completed history',
      },
      phases: compactPhases,
      judgments: plan.judgments.slice(-PLANNER_SPEC_MIGRATION_JUDGMENT_HISTORY_LIMIT).map(compactJudgment),
      specMigrations: plan.specMigrations.slice(-PLANNER_SPEC_MIGRATION_HISTORY_LIMIT).map(compactSpecMigration),
      e2eApplicable: plan.e2eApplicable,
    }, null, 2);
  }

  private taskMatchesRequiredMigrationItem(task: Task, requiredFeedbackItems: SpecMigrationFeedbackItem[]): boolean {
    if (requiredFeedbackItems.length === 0) return false;

    const text = [
      task.id,
      task.displayTitle,
      task.description,
      ...task.acceptanceCriteria,
    ].filter(Boolean).join('\n').toLowerCase();

    for (const item of requiredFeedbackItems) {
      const itemId = item.itemId?.toLowerCase();
      const diffItemId = item.diffItemId?.toLowerCase();
      const targetId = item.targetId?.toLowerCase();
      if ((itemId && text.includes(itemId)) || (diffItemId && text.includes(diffItemId)) || (targetId && text.includes(targetId))) {
        return true;
      }

      for (const ref of task.feedbackItemRefs ?? []) {
        if (ref.itemId === item.itemId) return true;
        if (ref.diffItemId && item.diffItemId && ref.diffItemId === item.diffItemId) return true;
        if (ref.targetType === item.targetType && ref.targetId && item.targetId && ref.targetId === item.targetId) return true;
      }
    }

    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async gatherProjectContext(workDir: string): Promise<string> {
    const contextFiles = ['package.json', 'tsconfig.json', 'Dockerfile', 'docker-compose.yml'];
    const sections: string[] = [];

    for (const file of contextFiles) {
      const filePath = path.join(workDir, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        sections.push(`### ${file}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Parse the agent's output to extract JSON with phases and judgments.
   * First extracts text from NDJSON stream-json format, then looks for
   * ```json ... ``` fenced block, then tries raw JSON extraction.
   */
  private parseAgentOutput(rawOutput: string): {
    phases: any[];
    judgments: any[];
    projectGoal?: string;
    feedbackDispositions?: unknown[];
  } {
    return parsePlannerAgentOutput(rawOutput);
  }

  private parseSpecMigrationOutput(rawOutput: string): {
    summary: string;
    planChanges: any[];
    newJudgments: any[];
    feedbackDispositions: any[];
  } {
    const output = extractTextFromStreamJson(rawOutput);
    let jsonStr: string | null = null;

    const fencedMatch = output.match(/```json\s*\n([\s\S]*?)```/);
    if (fencedMatch) {
      jsonStr = fencedMatch[1].trim();
    }

    if (!jsonStr) {
      const keyIdx = output.indexOf('"planChanges"');
      if (keyIdx !== -1) {
        const braceStart = output.lastIndexOf('{', keyIdx);
        if (braceStart !== -1) {
          let depth = 0;
          for (let i = braceStart; i < output.length; i++) {
            if (output[i] === '{') depth++;
            if (output[i] === '}') depth--;
            if (depth === 0) {
              jsonStr = output.slice(braceStart, i + 1);
              break;
            }
          }
        }
      }
    }

    if (!jsonStr) {
      throw new Error('Planner migration: could not parse JSON output');
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        planChanges: Array.isArray(parsed.planChanges) ? parsed.planChanges : [],
        newJudgments: Array.isArray(parsed.newJudgments) ? parsed.newJudgments : [],
        feedbackDispositions: Array.isArray(parsed.feedbackDispositions) ? parsed.feedbackDispositions : [],
      };
    } catch (err: any) {
      throw new Error(`Planner migration: invalid JSON: ${err.message}`);
    }
  }

  private stripRuntimeManagedTaskFields(change: any): any {
    if (!change || typeof change !== 'object') return change;

    const stripTaskFields = (task: any): any => {
      if (!task || typeof task !== 'object') return task;
      const { feedbackItemRefs, verificationEvidence, ...rest } = task;
      void feedbackItemRefs;
      void verificationEvidence;
      return rest;
    };

    if (change.action === 'addTask') {
      return {
        ...change,
        task: stripTaskFields(change.task),
      };
    }

    if (change.action === 'addPhase' && change.phase && Array.isArray(change.phase.tasks)) {
      return {
        ...change,
        phase: {
          ...change.phase,
          tasks: change.phase.tasks.map(stripTaskFields),
        },
      };
    }

    return change;
  }

  private async buildSpecMigrationFeedbackContext(
    workDir: string,
    specContent: string,
    currentPlan: Plan,
    options: { specFile: string; specHash: string },
  ): Promise<SpecMigrationFeedbackContext> {
    const extractedItems = getWorkRequiredFeedbackItems(
      extractCurrentFeedbackItems(specContent, options),
    );

    const acceptedArtifactContext = options.specFile === 'spec.md'
      ? await readAcceptedArtifactFeedbackContext(workDir)
      : null;
    if (acceptedArtifactContext) {
      const legacyCutoffs = this.resolveLegacyOperatorRepairCutoffs(
        acceptedArtifactContext.legacyOperatorRepairCutovers ?? [],
        currentPlan,
      );
      const selectedRequiredItems = this.selectRequiredSpecMigrationItems(
        acceptedArtifactContext.requiredItems,
        currentPlan,
        legacyCutoffs,
      );
      const requiredItems = this.stripSpecChangeSources(selectedRequiredItems);
      const specChangeSource = this.selectSpecChangeSourceForItems(
        selectedRequiredItems,
        acceptedArtifactContext.specChangeSource,
      );
      return {
        specChangeSource: {
          ...specChangeSource,
          itemCount: requiredItems.length,
        },
        requiredItems,
        extractedItems,
      };
    }

    const requiredItems = this.selectRequiredFeedbackItems(extractedItems, currentPlan)
      .map((item) => this.toSpecMigrationFeedbackItem(item));

    return {
      specChangeSource: {
        kind: requiredItems.length > 0 ? 'extracted_current_feedback' : 'none',
        itemCount: requiredItems.length,
      },
      requiredItems,
      extractedItems,
    };
  }

  private async shouldRecordInitialSpecBootstrap(workDir: string, relativeSpec: string): Promise<boolean> {
    if (relativeSpec !== 'spec.md') return true;

    const acceptedArtifactContext = await readAcceptedArtifactFeedbackContext(workDir);
    return !acceptedArtifactContext || acceptedArtifactContext.requiredItems.length === 0;
  }

  private selectRequiredFeedbackItems(items: SpecFeedbackItem[], currentPlan: Plan): SpecFeedbackItem[] {
    return items.filter((item) => {
      if (item.status.startsWith('reopened#')) return true;

      const previous = this.findLatestTrackedFeedbackItem(currentPlan, item.id);
      if (previous) {
        if (previous.fingerprint && previous.fingerprint !== item.itemTextHash) return true;
        if (previous.status && previous.status !== item.status) return true;
        return false;
      }

      return !this.planReferencesFeedbackItem(currentPlan, item.id);
    });
  }

  private selectRequiredSpecMigrationItems(
    items: SpecMigrationFeedbackItemWithSource[],
    currentPlan: Plan,
    legacyCutoffs: LegacyOperatorRepairCutoff[] = [],
  ): SpecMigrationFeedbackItemWithSource[] {
    return items.filter((item) => {
      if (this.isCoveredByLegacyOperatorRepairCutoff(item, legacyCutoffs)) return false;

      const previous = this.findLatestTrackedFeedbackItem(currentPlan, item.itemId);
      if (previous) {
        return this.specMigrationItemNeedsFreshDisposition(previous, item);
      }

      return !this.planHasCurrentFeedbackItemRef(currentPlan, item);
    });
  }

  private resolveLegacyOperatorRepairCutoffs(
    cutovers: AcceptedArtifactLegacyOperatorRepairCutover[],
    currentPlan: Plan,
  ): LegacyOperatorRepairCutoff[] {
    return cutovers.flatMap((cutover) => {
      const acknowledgedVersions = this.collectPlanAcknowledgedSourceVersions(currentPlan)
        .filter((entry) => this.specSourceMatches(entry, cutover))
        .map((entry) => entry.sourceVersion)
        .filter((sourceVersion) => sourceVersion > cutover.sourceVersion);
      if (acknowledgedVersions.length === 0) return [];

      return [{
        ...cutover,
        maxAcknowledgedSourceVersion: Math.max(...acknowledgedVersions),
      }];
    });
  }

  private collectPlanAcknowledgedSourceVersions(plan: Plan): Array<{
    system?: string;
    projectId?: string;
    sourceVersion: number;
  }> {
    const entries: Array<{ system?: string; projectId?: string; sourceVersion: number }> = [];
    for (const migration of plan.specMigrations) {
      const source = migration.specChangeSource;
      if (!source) continue;
      const sourceVersion = source.version == null ? NaN : Number(source.version);
      if (Number.isFinite(sourceVersion)) {
        entries.push({
          system: source.system,
          projectId: source.projectId,
          sourceVersion,
        });
      }
      for (const covered of source.coveredSourceVersions ?? []) {
        const sourceVersion = typeof covered === 'number' ? covered : Number(covered);
        if (!Number.isFinite(sourceVersion)) continue;
        entries.push({
          system: source.system,
          projectId: source.projectId,
          sourceVersion,
        });
      }
    }
    return entries;
  }

  private isCoveredByLegacyOperatorRepairCutoff(
    item: SpecMigrationFeedbackItemWithSource,
    cutoffs: LegacyOperatorRepairCutoff[],
  ): boolean {
    const source = item.specChangeSource;
    if (!source) return false;
    const sourceVersion = typeof source.version === 'number' ? source.version : Number(source.version);
    if (!Number.isFinite(sourceVersion)) return false;

    return cutoffs.some((cutoff) => (
      this.specSourceMatches(source, cutoff)
        && sourceVersion > cutoff.sourceVersion
        && sourceVersion <= cutoff.maxAcknowledgedSourceVersion
    ));
  }

  private specSourceMatches(
    source: { system?: string; projectId?: string },
    target: { system?: string; projectId?: string },
  ): boolean {
    return (source.system ?? '') === (target.system ?? '')
      && (source.projectId ?? '') === (target.projectId ?? '');
  }

  private specMigrationItemNeedsFreshDisposition(
    previous: SpecMigrationFeedbackItem,
    item: SpecMigrationFeedbackItem,
  ): boolean {
    if (item.fingerprint && (!previous.fingerprint || previous.fingerprint !== item.fingerprint)) {
      return !this.specMigrationItemSemanticsMatch(previous, item);
    }
    if (previous.status && item.status && previous.status !== item.status) return true;
    if (
      (item.sourceEvidence ?? []).length > 0
      && !this.sourceEvidenceMatches(previous.sourceEvidence, item.sourceEvidence)
    ) {
      return true;
    }
    return false;
  }

  private specMigrationItemSemanticsMatch(
    previous: SpecMigrationFeedbackItem,
    item: SpecMigrationFeedbackItem,
  ): boolean {
    return previous.itemId === item.itemId
      && previous.diffItemId === item.diffItemId
      && previous.targetType === item.targetType
      && previous.targetId === item.targetId
      && previous.changeType === item.changeType
      && this.optionalLegacyFieldMatches(previous.workImpact, item.workImpact)
      && this.optionalLegacyFieldMatches(previous.workSurface, item.workSurface)
      && previous.status === item.status
      && previous.summary === item.summary
      && this.stringArrayMatches(previous.sourceRefs, item.sourceRefs)
      && this.sourceEvidenceMatches(previous.sourceEvidence, item.sourceEvidence);
  }

  private optionalLegacyFieldMatches(previous: string | undefined, current: string | undefined): boolean {
    return previous === current || previous === undefined;
  }

  private stringArrayMatches(previous: string[] | undefined, current: string[] | undefined): boolean {
    return JSON.stringify(previous ?? []) === JSON.stringify(current ?? []);
  }

  private sourceEvidenceMatches(
    previous: FeedbackSourceEvidence[] | undefined,
    current: FeedbackSourceEvidence[] | undefined,
  ): boolean {
    return this.sourceEvidenceSignature(previous) === this.sourceEvidenceSignature(current);
  }

  private sourceEvidenceSignature(value: FeedbackSourceEvidence[] | undefined): string {
    return JSON.stringify((value ?? []).map((entry) => ({
      sourceRef: entry.sourceRef,
      quote: entry.quote ?? '',
      intent: entry.intent ?? '',
    })));
  }

  private findLatestTrackedFeedbackItem(plan: Plan, itemId: string): SpecMigrationFeedbackItem | undefined {
    for (const migration of [...plan.specMigrations].reverse()) {
      const item = (migration.requiredFeedbackItems ?? []).find((row) => row.itemId === itemId);
      if (item) return item;
    }
    // RA-373: payloads older than the retention window live in the feedback
    // ledger; retained migrations above are always newer than ledger entries.
    return plan.feedbackLedger?.[itemId]?.item;
  }

  private planReferencesFeedbackItem(plan: Plan, itemId: string): boolean {
    const itemNeedle = itemId.toLowerCase();
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if ((task.feedbackItemRefs ?? []).some((ref) => ref.itemId === itemId)) return true;
        const taskText = [task.description, ...task.acceptanceCriteria].join('\n').toLowerCase();
        if (taskText.includes(itemNeedle)) return true;
      }
    }
    return false;
  }

  private planHasCurrentFeedbackItemRef(plan: Plan, item: SpecMigrationFeedbackItem): boolean {
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (this.taskHasCurrentFeedbackItemRef(task, item)) return true;
      }
    }
    return false;
  }

  private selectSpecChangeSourceForItems(
    items: SpecMigrationFeedbackItemWithSource[],
    fallback: SpecMigrationSource,
  ): SpecMigrationSource {
    let selected: SpecMigrationSource | undefined;
    let selectedTime = Number.NEGATIVE_INFINITY;

    for (const item of items) {
      const source = item.specChangeSource;
      if (!source) continue;

      const time = source.acceptedAt ? Date.parse(source.acceptedAt) : Number.NEGATIVE_INFINITY;
      if (!selected || time >= selectedTime) {
        selected = source;
        selectedTime = time;
      }
    }

    const source = selected ?? fallback;
    const coveredSourceVersions = this.collectCoveredSourceVersions(items);
    return coveredSourceVersions.length > 1
      ? { ...source, coveredSourceVersions }
      : source;
  }

  private collectCoveredSourceVersions(items: SpecMigrationFeedbackItemWithSource[]): Array<string | number> {
    const seen = new Set<string>();
    const versions: Array<string | number> = [];

    for (const item of items) {
      const version = item.specChangeSource?.version;
      if (version == null) continue;
      const key = String(version);
      if (seen.has(key)) continue;
      seen.add(key);
      versions.push(version);
    }

    return versions;
  }

  private stripSpecChangeSources(items: SpecMigrationFeedbackItemWithSource[]): SpecMigrationFeedbackItem[] {
    return items.map((item) => {
      const { specChangeSource, ...rest } = item;
      void specChangeSource;
      return rest;
    });
  }

  private toSpecMigrationFeedbackItem(item: SpecFeedbackItem): SpecMigrationFeedbackItem {
    const summaryParts = [
      item.summary,
      item.title,
      item.expected ? `Expected: ${item.expected}` : '',
      item.actual ? `Actual: ${item.actual}` : '',
    ].filter(Boolean);

    return {
      itemId: item.id,
      kind: 'implementation_gap',
      changeType: item.status.startsWith('reopened#')
        ? 'reopened'
        : item.status === 'blocked' || item.status === 'needs_clarification'
          ? item.status
          : 'current_feedback_snapshot',
      status: item.status,
      summary: summaryParts.join(' | ') || item.itemText.slice(0, 500),
      fingerprint: item.itemTextHash,
    };
  }

  private normalizeActiveWipFeedbackReconciliation(
    currentPlan: Plan,
    requiredItems: SpecMigrationFeedbackItem[],
    rawDispositions: any[],
    validChanges: PlanChange[],
  ): { rawDispositions: any[]; planChanges: PlanChange[] } {
    if (requiredItems.length === 0 || rawDispositions.length === 0) {
      return { rawDispositions, planChanges: validChanges };
    }

    const requiredById = new Map(requiredItems.map((item) => [item.itemId, item]));
    const activeReconciliationTaskIds = new Set<string>();
    let normalizedDispositionCount = 0;

    const normalizedDispositions = rawDispositions.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const itemId = typeof raw.itemId === 'string' ? raw.itemId : undefined;
      if (!itemId) return raw;
      const requiredItem = requiredById.get(itemId);
      if (!requiredItem) return raw;
      const rawTaskIds: unknown[] = Array.isArray(raw.taskIds) ? raw.taskIds : [];
      const taskIds = rawTaskIds.filter((taskId: unknown): taskId is string => typeof taskId === 'string');
      const activeTaskIds = taskIds.filter((taskId: string) => {
        const task = this.findTaskInPlan(currentPlan, taskId);
        return !!task && task.status === 'in_progress' && this.taskCoversRequiredItem(task, requiredItem);
      });
      if (activeTaskIds.length === 0) return raw;

      for (const taskId of activeTaskIds) activeReconciliationTaskIds.add(taskId);

      if (raw.disposition !== 'updateOpenTask') return raw;

      normalizedDispositionCount++;
      const baseReason = typeof raw.reason === 'string' && raw.reason.trim()
        ? raw.reason.trim()
        : 'Accepted diff targets active executor WIP.';
      return {
        ...raw,
        disposition: 'coveredByOpenTask',
        reason: `${baseReason} Planner cannot mutate active in_progress task; executor must reconcile the WIP with attached accepted feedback.`,
      };
    });

    if (activeReconciliationTaskIds.size === 0) {
      return { rawDispositions: normalizedDispositions, planChanges: validChanges };
    }

    const planChanges = validChanges.filter((change) => {
      if (
        (change.action === 'updateTask' || change.action === 'removeTask')
        && activeReconciliationTaskIds.has(change.taskId)
      ) {
        return false;
      }
      return true;
    });

    const droppedChangeCount = validChanges.length - planChanges.length;
    if (normalizedDispositionCount > 0 || droppedChangeCount > 0) {
      log.warn(
        `Planner migration: reconciled accepted feedback with active WIP task(s) ${Array.from(activeReconciliationTaskIds).join(', ')}; `
        + `normalized ${normalizedDispositionCount} disposition(s), ignored ${droppedChangeCount} active WIP mutation(s).`,
      );
    }

    return { rawDispositions: normalizedDispositions, planChanges };
  }

  private validateFeedbackDispositions(
    requiredItems: SpecMigrationFeedbackItem[],
    rawDispositions: any[],
    currentPlan: Plan,
    validChanges: PlanChange[],
    validJudgments: Judgment[],
    options: FeedbackDispositionValidationOptions = {},
  ): SpecFeedbackDisposition[] {
    if (requiredItems.length === 0) return [];

    const requiredById = new Map(requiredItems.map((item) => [item.itemId, item]));
    const existingTasks = new Map<string, Task>();
    for (const phase of currentPlan.phases) {
      for (const task of phase.tasks) {
        existingTasks.set(task.id, task);
      }
    }

    const addedTaskIds = new Set<string>();
    const updatedTaskIds = new Set<string>();
    for (const change of validChanges) {
      if (change.action === 'addTask') addedTaskIds.add(change.task.id);
      if (change.action === 'addPhase') {
        for (const task of change.phase.tasks) {
          addedTaskIds.add(task.id);
        }
      }
      if (change.action === 'updateTask') updatedTaskIds.add(change.taskId);
    }
    const validJudgmentIds = new Set(validJudgments.map((judgment) => judgment.id));

    const dispositions: SpecFeedbackDisposition[] = [];
    for (const raw of rawDispositions) {
      const parsed = SpecFeedbackDispositionSchema.safeParse(raw);
      if (!parsed.success) {
        const issueSummary = parsed.error.issues.map(i => i.message).join(', ');
        const evidenceKindIssue = parsed.error.issues.some((issue) => {
          const path = issue.path.map(String);
          return path.includes('evidence') && path[path.length - 1] === 'kind';
        });
        const guidance = evidenceKindIssue
          ? ` Use only existing FeedbackEvidence.kind values. For closedByEvidence, concrete closure kinds are: ${CONCRETE_CLOSURE_EVIDENCE_KIND_LIST}. Do not invent domain-specific evidence kinds; use "code_inspection" for accepted-spec/document inspection.`
          : '';
        throw new Error(`Planner migration feedback disposition is invalid: ${issueSummary}.${guidance}`);
      }
      dispositions.push({
        taskIds: [],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        ...parsed.data,
      });
    }

    const seen = new Set<string>();
    for (const disposition of dispositions) {
      const requiredItem = requiredById.get(disposition.itemId);
      const taskIds = disposition.taskIds ?? [];
      const evidence = disposition.evidence ?? [];
      const judgmentIds = disposition.judgmentIds ?? [];
      if (!requiredItem) {
        throw new Error(`Planner migration feedback disposition references unknown item ${disposition.itemId}`);
      }
      if (seen.has(disposition.itemId)) {
        throw new Error(`Planner migration feedback disposition duplicates ${disposition.itemId}`);
      }
      seen.add(disposition.itemId);

      const hasTaskIds = taskIds.length > 0;
      const taskIsOpen = (taskId: string): boolean => {
        if (addedTaskIds.has(taskId)) return true;
        const existing = existingTasks.get(taskId);
        return !!existing && existing.status !== 'completed' && existing.status !== 'skipped';
      };

      if (disposition.disposition === 'addTask') {
        if (!hasTaskIds || !taskIds.some(taskId => addedTaskIds.has(taskId))) {
          throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses addTask without referencing a valid added task`);
        }
      }

      if (disposition.disposition === 'updateOpenTask') {
        if (!hasTaskIds || !taskIds.some(taskId => updatedTaskIds.has(taskId))) {
          throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses updateOpenTask without an updateTask plan change`);
        }
      }

      if (
        disposition.disposition === 'addTask'
        || disposition.disposition === 'updateOpenTask'
        || disposition.disposition === 'coveredByOpenTask'
      ) {
        for (const taskId of taskIds) {
          if (!taskIsOpen(taskId)) {
            throw new Error(`Planner migration feedback disposition ${disposition.itemId} references non-open task ${taskId}`);
          }
          const task = this.resolveDispositionTask(currentPlan, validChanges, taskId);
          if (
            task
            && !this.dispositionWillAttachCurrentFeedbackRef(disposition, taskId, addedTaskIds, updatedTaskIds)
            && !this.dispositionWillAttachInitialPlanFeedbackRef(disposition, taskId, options.initialPlanTaskIds)
            && !this.dispositionReconcilesActiveWip(disposition, taskId, currentPlan, requiredItem)
            && !this.taskCarriesSourceEvidenceOutcome(task, requiredItem)
          ) {
            throw new Error(`Planner migration feedback disposition ${disposition.itemId} references task ${taskId} that does not carry the sourceEvidence product outcome. For sourceEvidence rows, task description or acceptanceCriteria must include the accepted diff summary/product outcome unless the task already has the current structured feedbackItemRef. A DIFF id, item id, or target id alone is too weak.`);
          }
        }
      }

      if (disposition.disposition === 'coveredByOpenTask') {
        const uncoveredTaskIds = taskIds.filter((taskId) => {
          if (this.dispositionWillAttachInitialPlanFeedbackRef(disposition, taskId, options.initialPlanTaskIds)) {
            return false;
          }
          const existing = existingTasks.get(taskId);
          return !existing || !this.taskCoversRequiredItem(existing, requiredItem);
        });
        if (uncoveredTaskIds.length > 0) {
          throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses coveredByOpenTask with task(s) that do not reference the accepted diff item: ${uncoveredTaskIds.join(', ')}`);
        }
      }

      if (
        disposition.disposition === 'closedByEvidence'
        && !hasPositiveFeedbackEvidenceForItem(disposition.itemId, evidence, { allowImplicitItemLink: true })
      ) {
        throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses closedByEvidence without concrete evidence. Evidence must include at least one passing row using one of these concrete evidence kinds: ${CONCRETE_CLOSURE_EVIDENCE_KIND_LIST}`);
      }
      if (
        disposition.disposition === 'closedByEvidence'
        && !this.hasProductFacingClosureEvidenceForSourceEvidenceItem(requiredItem, evidence)
      ) {
        throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses closedByEvidence for sourceEvidence without product-facing proof. Source evidence rows require passing evidence using one of these kinds: ${SOURCE_EVIDENCE_CLOSURE_EVIDENCE_KIND_LIST}`);
      }

      if (disposition.disposition === 'needsJudgment') {
        if (this.disallowsJudgmentOnlyDisposition(requiredItem)) {
          throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses needsJudgment for hard accepted diff work`);
        }
        if (judgmentIds.length === 0) {
          throw new Error(`Planner migration feedback disposition ${disposition.itemId} uses needsJudgment without judgmentIds`);
        }
        for (const judgmentId of judgmentIds) {
          if (!validJudgmentIds.has(judgmentId)) {
            throw new Error(`Planner migration feedback disposition ${disposition.itemId} references unknown judgment ${judgmentId}`);
          }
        }
      }
    }

    const missing = requiredItems
      .filter((item) => !seen.has(item.itemId))
      .map((item) => item.itemId);
    if (missing.length > 0) {
      throw new Error(`Planner migration missing feedback disposition(s): ${missing.join(', ')}`);
    }

    return dispositions;
  }

  private dispositionWillAttachCurrentFeedbackRef(
    disposition: SpecFeedbackDisposition,
    taskId: string,
    addedTaskIds: Set<string>,
    updatedTaskIds: Set<string>,
  ): boolean {
    if (disposition.disposition === 'addTask') return addedTaskIds.has(taskId);
    if (disposition.disposition === 'updateOpenTask') return updatedTaskIds.has(taskId);
    return false;
  }

  private dispositionWillAttachInitialPlanFeedbackRef(
    disposition: SpecFeedbackDisposition,
    taskId: string,
    initialPlanTaskIds?: ReadonlySet<string>,
  ): boolean {
    return disposition.disposition === 'coveredByOpenTask' && initialPlanTaskIds?.has(taskId) === true;
  }

  private dispositionReconcilesActiveWip(
    disposition: SpecFeedbackDisposition,
    taskId: string,
    currentPlan: Plan,
    item: SpecMigrationFeedbackItem,
  ): boolean {
    if (disposition.disposition !== 'coveredByOpenTask') return false;
    const task = this.findTaskInPlan(currentPlan, taskId);
    return !!task && task.status === 'in_progress' && this.taskCoversRequiredItem(task, item);
  }

  private disallowsJudgmentOnlyDisposition(item: SpecMigrationFeedbackItem): boolean {
    return !!item.targetType && item.targetType !== 'feedback';
  }

  private hasProductFacingClosureEvidenceForSourceEvidenceItem(
    item: SpecMigrationFeedbackItem,
    evidence: FeedbackEvidence[],
  ): boolean {
    if ((item.sourceEvidence ?? []).length === 0) return true;
    const productEvidence = evidence.filter((row) => (
      SOURCE_EVIDENCE_CLOSURE_EVIDENCE_KINDS.includes(row.kind)
    ));
    return hasPositiveFeedbackEvidenceForItem(item.itemId, productEvidence, { allowImplicitItemLink: true });
  }

  private taskCoversRequiredItem(task: Task, item: SpecMigrationFeedbackItem): boolean {
    if (this.taskHasCurrentFeedbackItemRef(task, item)) return true;
    if (this.taskCarriesAcceptedDiffOutcome(task, item)) return true;

    const needles = [item.itemId, item.diffItemId, item.targetId]
      .filter((value): value is string => !!value)
      .map((value) => value.toLowerCase());
    if (needles.length === 0) return false;

    const taskText = [task.description, ...task.acceptanceCriteria].join('\n').toLowerCase();
    return needles.some((needle) => taskText.includes(needle));
  }

  private taskCarriesAcceptedDiffOutcome(task: Task, item: SpecMigrationFeedbackItem): boolean {
    const taskText = this.normalizeSourceSignalText([
      task.description,
      ...task.acceptanceCriteria,
    ].join('\n'));
    return this.sourceSignalSummaryNeedles(item).some((needle) => taskText.includes(needle));
  }

  private taskCarriesSourceEvidenceOutcome(task: Task, item: SpecMigrationFeedbackItem): boolean {
    if ((item.sourceEvidence ?? []).length === 0) return true;
    if (this.taskHasCurrentFeedbackItemRef(task, item)) return true;
    if (this.taskHasCurrentSourceEvidenceLineage(task, item)) return true;

    return this.taskCarriesAcceptedDiffOutcome(task, item);
  }

  private taskHasCurrentSourceEvidenceLineage(task: Task, item: SpecMigrationFeedbackItem): boolean {
    if ((item.sourceEvidence ?? []).length === 0) return false;
    return (task.feedbackItemRefs ?? []).some((ref) => {
      if (!this.feedbackItemRefMatchesItemIdentity(ref, item)) return false;
      return this.sourceEvidenceMatches(ref.sourceEvidence, item.sourceEvidence);
    });
  }

  private feedbackItemRefMatchesItemIdentity(ref: FeedbackItemRef, item: SpecMigrationFeedbackItem): boolean {
    if (ref.itemId === item.itemId) return true;
    if (ref.diffItemId && item.diffItemId && ref.diffItemId === item.diffItemId) return true;
    return !!ref.targetType
      && !!item.targetType
      && ref.targetType === item.targetType
      && !!ref.targetId
      && !!item.targetId
      && ref.targetId === item.targetId
      && ref.changeType === item.changeType;
  }

  private sourceSignalSummaryNeedles(item: SpecMigrationFeedbackItem): string[] {
    const summary = this.normalizeSourceSignalText(item.summary);
    const parts = item.summary
      .split('|')
      .map((part) => this.normalizeSourceSignalText(part));

    return Array.from(new Set([
      ...parts,
      summary,
    ])).filter((part) => part.length >= 12);
  }

  private normalizeSourceSignalText(value: string): string {
    return value
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  private resolveDispositionTask(
    currentPlan: Plan,
    validChanges: PlanChange[],
    taskId: string,
  ): Task | undefined {
    for (const change of validChanges) {
      if (change.action === 'addTask' && change.task.id === taskId) {
        return change.task;
      }
      if (change.action === 'addPhase') {
        const task = change.phase.tasks.find((entry) => entry.id === taskId);
        if (task) return task;
      }
      if (change.action === 'updateTask' && change.taskId === taskId) {
        const current = this.findTaskInPlan(currentPlan, taskId);
        if (!current) return undefined;
        return {
          ...current,
          ...change.changes,
          acceptanceCriteria: change.changes.acceptanceCriteria ?? current.acceptanceCriteria,
          dependencies: change.changes.dependencies ?? current.dependencies,
          requiredRolePasses: change.changes.requiredRolePasses ?? current.requiredRolePasses,
        };
      }
    }

    return this.findTaskInPlan(currentPlan, taskId);
  }

  private findTaskInPlan(plan: Plan, taskId: string): Task | undefined {
    for (const phase of plan.phases) {
      const task = phase.tasks.find((entry) => entry.id === taskId);
      if (task) return task;
    }
    return undefined;
  }

  private taskHasCurrentFeedbackItemRef(task: Task, item: SpecMigrationFeedbackItem): boolean {
    return (task.feedbackItemRefs ?? []).some((ref) => {
      if (ref.itemId !== item.itemId) return false;
      if (item.fingerprint) return ref.fingerprint === item.fingerprint;
      return ref.targetType === item.targetType
        && ref.targetId === item.targetId
        && ref.changeType === item.changeType
        && ref.summary === item.summary;
    });
  }

  private attachFeedbackRefsToTasks(
    planManager: PlanManager,
    dispositions: SpecFeedbackDisposition[],
    requiredItems: SpecMigrationFeedbackItem[],
    specFile: string,
    specHash: string,
  ): void {
    if (dispositions.length === 0) return;
    const requiredById = new Map(requiredItems.map((item) => [item.itemId, item]));

    for (const disposition of dispositions) {
      const required = requiredById.get(disposition.itemId);
      for (const taskId of disposition.taskIds ?? []) {
        const task = planManager.findTask(taskId);
        if (!task) continue;
        task.feedbackItemRefs ??= [];
        const alreadyLinked = task.feedbackItemRefs.some((ref) => (
          ref.itemId === disposition.itemId
          && ref.specFile === specFile
          && ref.specHash === specHash
        ));
        if (alreadyLinked) continue;
        task.feedbackItemRefs.push({
          itemId: disposition.itemId,
          ...(required?.diffItemId ? { diffItemId: required.diffItemId } : {}),
          ...(required?.targetType ? { targetType: required.targetType } : {}),
          ...(required?.targetId ? { targetId: required.targetId } : {}),
          ...(required?.changeType ? { changeType: required.changeType } : {}),
          ...(required?.workImpact ? { workImpact: required.workImpact } : {}),
          ...(required?.workSurface ? { workSurface: required.workSurface } : {}),
          ...(required?.status !== undefined ? { status: required.status } : {}),
          ...(required?.summary ? { summary: required.summary } : {}),
          ...(required?.sourceRefs?.length ? { sourceRefs: required.sourceRefs } : {}),
          ...(required?.sourceEvidence?.length ? { sourceEvidence: required.sourceEvidence } : {}),
          specFile,
          specHash,
          ...(required?.fingerprint ? { fingerprint: required.fingerprint } : {}),
        });
      }
    }
  }

  private nextTaskNumber(plan: Plan): number {
    let max = 0;
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        const m = task.id.match(/^task-(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    return max + 1;
  }

  private nextJudgmentNumber(plan: Plan): number {
    // RA-373: pruned judgments keep numbering monotonic through the watermark.
    let max = plan.compaction?.judgmentIdWatermark ?? 0;
    for (const j of plan.judgments) {
      const m = j.id.match(/^judgment-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }

  private normalizeNewJudgments(judgments: Judgment[], planManager: PlanManager): Judgment[] {
    const existingIds = new Set(planManager.getJudgments().map(j => j.id));
    let nextNumber = this.nextJudgmentNumber(planManager.currentPlan);

    return judgments.map(j => {
      if (!existingIds.has(j.id)) {
        existingIds.add(j.id);
        return j;
      }
      const newId = `judgment-${String(nextNumber++).padStart(3, '0')}`;
      existingIds.add(newId);
      return { ...j, id: newId };
    });
  }

  /**
   * Merge a plan revision with the current plan, preserving completed work
   */
  private mergePlanRevision(planManager: PlanManager, newPhases: Phase[], newJudgments: Judgment[], judgmentLog: JudgmentLog): void {
    const current = planManager.currentPlan;

    // Build a map of current tasks by id. Executor-owned active work must
    // survive revisions unchanged; planner revisions may only reshape pending work.
    const currentTaskMap = new Map<string, { task: Task; status: Task['status']; attempts: number }>();
    const activeTaskIds = new Set<string>();
    for (const phase of current.phases) {
      for (const task of phase.tasks) {
        currentTaskMap.set(task.id, { task, status: task.status, attempts: task.attempts });
        if (task.status === 'in_progress') activeTaskIds.add(task.id);
      }
    }
    const seenActiveTaskIds = new Set<string>();

    // Merge: restore executor-owned and terminal statuses in new phases.
    for (const phase of newPhases) {
      for (const [taskIndex, task] of phase.tasks.entries()) {
        const existing = currentTaskMap.get(task.id);
        if (existing?.status === 'in_progress') {
          phase.tasks[taskIndex] = existing.task;
          seenActiveTaskIds.add(task.id);
          continue;
        }
        if (task.status === 'in_progress') {
          throw new Error(`mergePlanRevision: ${task.id} cannot start as in_progress; only the executor may claim active work`);
        }
        if (existing && existing.status === 'completed') {
          task.status = 'completed' as any;
          task.attempts = existing.attempts;
        }
      }
      // Empty planLater phases are unresolved planning work, not completed work.
      if (phase.planLater && phase.tasks.length === 0) {
        phase.status = 'pending' as any;
        continue;
      }

      if (phase.tasks.some(t => t.status === 'in_progress')) {
        phase.status = 'in_progress' as any;
        continue;
      }

      // If all concrete tasks in phase are completed, mark phase completed.
      // Guard length: [].every(...) is true, but an empty phase is not done.
      if (phase.tasks.length > 0 && phase.tasks.every(t => t.status === 'completed')) {
        phase.status = 'completed' as any;
      }
    }

    for (const activeTaskId of activeTaskIds) {
      if (!seenActiveTaskIds.has(activeTaskId)) {
        throw new Error(`mergePlanRevision: cannot remove active in_progress task ${activeTaskId}; executor must reconcile the WIP`);
      }
    }

    // Replace phases
    current.phases = newPhases;

    // Add new judgments
    for (const j of newJudgments) {
      if (!current.judgments.find(existing => existing.id === j.id)) {
        current.judgments.push(j);
        judgmentLog.record(j);
      }
    }
  }

  private async recordPromptTrace(
    workDir: string,
    input: {
      promptId: string;
      label: string;
      prompt: string;
      result: Pick<AgentResult, 'success' | 'output'>;
      model?: string;
      context?: Record<string, string | number | boolean | null | undefined>;
    },
  ): Promise<void> {
    try {
      await appendPromptModelCallTrace(workDir, {
        owner: 'planner',
        parse: this.describePromptTraceParse(input),
        ...input,
      });
    } catch (err: any) {
      log.warn(`Planner: failed to write prompt trace: ${err.message}`);
    }
  }

  private describePromptTraceParse(input: {
    promptId: string;
    result: Pick<AgentResult, 'success' | 'output'>;
  }): { status: 'not_recorded' | 'ok' | 'error'; summary?: string } {
    if (!input.result.success) {
      return { status: 'error', summary: 'agent call failed' };
    }

    try {
      if (input.promptId === 'planner.initial' || input.promptId === 'planner.replan') {
        const parsed = this.parseAgentOutput(input.result.output);
        return {
          status: 'ok',
          summary: [
            `phases=${parsed.phases.length}`,
            `judgments=${parsed.judgments.length}`,
            parsed.projectGoal ? 'projectGoal=recorded' : null,
          ].filter(Boolean).join('; '),
        };
      }

      if (input.promptId === 'planner.specMigration') {
        const parsed = this.parseSpecMigrationOutput(input.result.output);
        return {
          status: 'ok',
          summary: [
            `planChanges=${parsed.planChanges.length}`,
            `newJudgments=${parsed.newJudgments.length}`,
            `feedbackDispositions=${parsed.feedbackDispositions.length}`,
          ].join('; '),
        };
      }

    } catch (err: any) {
      return {
        status: 'error',
        summary: this.traceSummary(err.message),
      };
    }

    return { status: 'not_recorded' };
  }

  private traceSummary(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
}

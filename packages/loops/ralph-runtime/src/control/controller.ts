import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import nodeFs from 'node:fs';
import {
  getVisualWorkbenchManifestIssueDetails,
  parseVisualWorkbenchManifest,
  VISUAL_WORKBENCH_MANIFEST_PATH,
  type VisualWorkbenchManifestIssueDetail,
} from '@arena/contracts';
import type { AgentError, AgentResult, ControllerReport, Plan, Judgment, IterationLog, ProjectConfig, RalphConfig, PlanChange, Task, FeedbackEvidence, FeedbackEvidenceMatrixRow, SpecFeedbackDisposition, SpecMigration, SpecMigrationFeedbackItem, VisualEvidenceMode } from '../config/types.js';
import { JudgmentSchema, PlanChangeSchema, RevisedJudgmentSchema } from '../config/types.js';
import { parseControllerAgentReport } from './controller-output.js';
import type { Agent } from '../agents/base.js';
import {
  ProviderCallCheckpointStore,
  executeAgentWithProviderCallCheckpoint,
} from '../agents/provider-call-checkpoint.js';
import { PlanManager } from '../planning/plan-manager.js';
import { JudgmentLog } from '../planning/judgments.js';
import { log } from '../utils/logger.js';
import { extractTextFromStreamJson } from '../utils/stream-json.js';
import { applyE2EEnforcement, E2E_ENFORCER_MIN_FEATURE_TASKS } from './e2e-enforcer.js';
import {
  extractCurrentFeedbackItems,
  getWorkRequiredFeedbackItems,
  type SpecFeedbackItem,
} from '../feedback/spec-feedback.js';
import { hasPositiveFeedbackEvidenceForItem } from '../feedback/evidence.js';
import { appendPromptModelCallTrace } from '../prompts/runtime-trace.js';
import {
  renderControllerAuditPrompt,
  renderE2EApplicabilityPrompt,
} from '../prompts/repository.js';
import type { VisionQAReport } from '../verification/vision-qa.js';
import {
  getVisualWorkbenchSelectorReadinessForPlan,
  type VisualWorkbenchSelectorReadinessAmbiguity,
  type VisualWorkbenchSelectorReadinessResult,
  type VisualWorkbenchSelectorReadinessTask,
} from '../verification/visual-workbench-evidence.js';

export type ControllerTrigger = 'phase_complete' | 'periodic' | 'failure_threshold' | 'replan' | 'manual' | 'final' | 'startup' | 'spec_migration';

const SOURCE_EVIDENCE_CLOSURE_KINDS = new Set<FeedbackEvidence['kind']>([
  'screenshot',
  'vision_qa',
  'manual_note',
]);

const CONTROLLER_FULL_PLAN_MAX_CHARS = Number(process.env.RALPH_CONTROLLER_FULL_PLAN_MAX_CHARS ?? 240_000);
const CONTROLLER_COMPLETED_TASK_HISTORY_LIMIT = Number(process.env.RALPH_CONTROLLER_COMPLETED_TASK_HISTORY_LIMIT ?? 12);
const CONTROLLER_JUDGMENT_HISTORY_LIMIT = Number(process.env.RALPH_CONTROLLER_JUDGMENT_HISTORY_LIMIT ?? 20);
const CONTROLLER_SPEC_MIGRATION_HISTORY_LIMIT = Number(process.env.RALPH_CONTROLLER_SPEC_MIGRATION_HISTORY_LIMIT ?? 8);

function compactText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

export interface ControllerOptions {
  workDir: string;
  specPath: string;
  projectConfig: ProjectConfig;
  ralphConfig: RalphConfig;
  agent: Agent;
  model?: string;
  planManager: PlanManager;
  judgmentLog: JudgmentLog;
  iterationHistory: IterationLog[];
  verbose?: boolean;
  /** Structured report from Vision QA (e2e video analysis) — included in final audit */
  visionReport?: VisionQAReport;
}

export interface ControllerDryRunAuditOptions {
  workDir: string;
  specPath: string;
  ralphConfig: RalphConfig;
  agent: Agent;
  model?: string;
  timeoutMinutes?: number | null;
  planManager: PlanManager;
  iterationHistory: IterationLog[];
  trigger: Exclude<ControllerTrigger, 'startup'>;
  verbose?: boolean;
  visionReport?: VisionQAReport;
}

export const CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY = 'ralph.controller.audit-dry-run' as const;

export interface ControllerDryRunAuditResult {
  ownerBoundary: typeof CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY;
  promptId: 'controller.audit';
  status: 'parsed' | 'agent_failed' | 'parse_or_validation_failed';
  trigger: Exclude<ControllerTrigger, 'startup'>;
  prompt: string;
  context: {
    specCharCount: number;
    projectSnapshotCharCount: number;
    recentHistoryCount: number;
    feedbackMatrixRows: number;
    visualWorkbenchSourceContractStatus: VisualWorkbenchSourceContractGuard['status'] | null;
    e2eEnabled: boolean;
  };
  agentResult: AgentResult;
  report: ControllerReport | null;
  error: null | {
    code: 'agent_failed' | 'parse_or_validation_failed';
    message: string;
  };
}

type VisualWorkbenchSourceContractBlocker =
  | 'manifest_missing'
  | 'manifest_invalid_json'
  | 'manifest_contract_invalid'
  | 'selector_readiness_blocked';

interface VisualWorkbenchSourceContractSelectorIssue {
  taskId: string;
  title: string;
  blockers: string[];
  selectorIdentities: string[];
  ambiguities: VisualWorkbenchSelectorReadinessAmbiguity[];
  selectedStories: string[];
  selectedViewports: string[];
}

interface VisualWorkbenchSourceContractGuard {
  status: 'not_applicable' | 'ready' | 'blocked';
  visualEvidenceMode: VisualEvidenceMode;
  manifestPath: string;
  rows: FeedbackEvidenceMatrixRow[];
  blockers: VisualWorkbenchSourceContractBlocker[];
  issueDetails: VisualWorkbenchManifestIssueDetail[];
  selectorIssues: VisualWorkbenchSourceContractSelectorIssue[];
}

export class ControllerAuditFailure extends Error {
  constructor(
    public readonly trigger: ControllerTrigger,
    message: string,
    public readonly agentError?: AgentError,
  ) {
    super(message);
    this.name = 'ControllerAuditFailure';
  }
}

/**
 * Controller — periodic auditor that reviews project progress against the spec,
 * can modify the plan, add/remove tasks, and create/revise judgments.
 */
export class Controller {
  private reportCount = 0;
  private reportsDir: string;

  constructor(private workDir: string) {
    this.reportsDir = path.join(workDir, '.ralph', 'controller-reports');
  }

  private enforceUnresolvedPlanLater(report: ControllerReport, planManager: PlanManager): void {
    if (report.verdict === 'escalate') return;

    const unresolvedPhases = planManager.currentPlan.phases.filter(phase => phase.planLater && phase.tasks.length === 0);
    if (unresolvedPhases.length === 0) return;

    const existingTaskIds = new Set<string>();
    for (const phase of planManager.currentPlan.phases) {
      for (const task of phase.tasks) {
        existingTaskIds.add(task.id);
      }
    }

    for (const phase of unresolvedPhases) {
      const baseId = 'task-planlater-' + phase.id.replace(/[^a-zA-Z0-9-]/g, '-');
      let taskId = baseId;
      let suffix = 2;
      while (existingTaskIds.has(taskId)) {
        taskId = baseId + '-' + suffix;
        suffix++;
      }
      existingTaskIds.add(taskId);

      report.planChanges.push({
        action: 'addTask',
        phaseId: phase.id,
        task: {
          id: taskId,
          description: 'Implement deferred phase "' + phase.name + '" from the current spec: ' + phase.description,
          acceptanceCriteria: [
            'Current spec requirements covered by this phase are implemented in the app.',
            'The implementation is not represented as a product deferral unless the spec explicitly says it is out of scope.',
            'The phase can be verified by the normal Ralph execution and controller audit loop.',
          ],
          status: 'pending',
          attempts: 0,
          dependencies: [],
          priority: 3,
          estimatedComplexity: 'high',
          addedBy: 'controller',
        },
      });
    }

    report.verdict = 'revise';
    const phaseList = unresolvedPhases.map(phase => phase.id).join(', ');
    report.summary = report.summary + '\n\nController guard: unresolved planLater phases converted to implementation tasks: ' + phaseList + '.';
    log.warn('Controller: converted unresolved planLater phases to tasks: ' + phaseList);
  }

  /**
   * Run a controller audit session.
   * Returns the report with verdict and any plan changes.
   */
  async audit(options: ControllerOptions, trigger: ControllerTrigger): Promise<ControllerReport> {
    const { workDir, specPath, agent, planManager, judgmentLog, iterationHistory, verbose, visionReport } = options;

    log.info(`Controller: audit triggered (${trigger})`);

    // For startup trigger: resolve e2e applicability + run enforcer
    if (trigger === 'startup') {
      const e2eEnabled = await this.resolveE2EEnabled(options);

      const e2eResult = e2eEnabled
        ? applyE2EEnforcement(planManager)
        : { tasksAdded: 0, changesApplied: 0, phaseCreated: false, taskIds: [] as string[] };
      if (e2eResult.changesApplied > 0) {
        await planManager.save();
      }
      if (e2eResult.tasksAdded > 0) {
        log.info(`Controller: E2E enforcer added ${e2eResult.tasksAdded} task(s): ${e2eResult.taskIds.join(', ')}`);
      }
      const verdict = e2eResult.tasksAdded > 0 ? 'revise' as const : 'continue' as const;
      const report: ControllerReport = {
        id: this.nextReportId(),
        timestamp: new Date().toISOString(),
        trigger,
        reportType: 'startup_e2e_enforcer',
        semanticAudit: false,
        verdict,
        summary: e2eEnabled
          ? (e2eResult.tasksAdded > 0
            ? `Startup: added ${e2eResult.tasksAdded} e2e test task(s) for completed features`
            : 'Startup: plan is up to date, all completed features have e2e tasks')
          : 'Startup: E2E enforcer disabled by project policy',
        planChanges: [],
        newJudgments: [],
        revisedJudgments: [],
        feedbackMatrix: [],
        overclaimWarnings: [],
      };
      await this.saveReport(report);
      const icon = verdict === 'continue' ? '✅' : '🔄';
      log.info(`Controller verdict: ${icon} ${verdict} — ${report.summary}`);
      return report;
    }

    // 1. Gather context
    const specContent = await fs.readFile(specPath, 'utf-8');
    const plan = planManager.currentPlan;
    const recentHistory = iterationHistory.slice(-10);
    const projectSnapshot = await this.gatherProjectSnapshot(workDir);
    const feedbackMatrix = this.shouldRunFeedbackSemanticGuard(trigger)
      ? this.buildFeedbackEvidenceMatrix(specContent, specPath, workDir, plan)
      : [];
    const visualEvidenceMode = options.ralphConfig.visualWorkbench?.visualEvidenceMode ?? 'off';
    const visualWorkbenchSourceContract = this.shouldRunVisualWorkbenchSourceContractGuard(trigger, visualEvidenceMode)
      ? await this.buildVisualWorkbenchSourceContractGuard(workDir, plan, feedbackMatrix, visualEvidenceMode)
      : null;

    // 2. Build audit prompt
    const e2eEnabled = this.isE2EEnabled(options);
    const prompt = this.buildAuditPrompt(specContent, plan, recentHistory, projectSnapshot, trigger, e2eEnabled, visionReport, feedbackMatrix);

    // Replan and final audit can repair one invalid report. A controller report
    // is a single plan mutation packet, so parsing must not silently retain a
    // valid subset of changes from an otherwise invalid response.
    const maxReportAttempts = trigger === 'final' || trigger === 'replan' ? 2 : 1;
    let report: ControllerReport | null = null;
    let parseError: Error | null = null;
    let previousOutput = '';

    for (let attempt = 1; attempt <= maxReportAttempts; attempt++) {
      const attemptPrompt = attempt === 1
        ? prompt
        : this.buildControllerReportRepairPrompt(prompt, previousOutput, parseError);
      const result = await executeAgentWithProviderCallCheckpoint({
        store: new ProviderCallCheckpointStore(workDir),
        owner: 'controller',
        operation: 'controller.audit',
        agent,
        options: {
          workDir,
          prompt: attemptPrompt,
          allowedTools: [],
          model: options.model,
          verbose: verbose ?? true,
        },
      });

      // Save controller agent log
      await this.saveControllerLog(workDir, trigger, attemptPrompt, result);
      await this.recordPromptTrace(workDir, {
        promptId: 'controller.audit',
        label: attempt === 1 ? 'Controller audit' : 'Controller audit report repair',
        prompt: attemptPrompt,
        result,
        model: options.model,
        context: {
          trigger,
          e2eEnabled,
          feedbackMatrixRows: feedbackMatrix.length,
          recentHistoryCount: recentHistory.length,
          attempt,
          maxReportAttempts,
        },
      });

      if (!result.success) {
        log.error(`Controller agent failed: ${result.output}`);
        if (trigger === 'final') {
          throw new ControllerAuditFailure(
            trigger,
            `Final controller audit failed: ${result.output.slice(0, 200)}`,
            result.error,
          );
        }
        return this.fallbackReport(trigger, `Agent error: ${result.output.slice(0, 200)}`);
      }

      try {
        report = this.parseAgentReport(result.output, trigger);
        parseError = null;
        break;
      } catch (err: any) {
        parseError = err;
        previousOutput = result.output;
        log.error(`Controller: failed to parse agent output: ${err.message}`);
        if (attempt < maxReportAttempts) {
          log.warn(`Controller: retrying ${trigger} report contract (${attempt + 1}/${maxReportAttempts})`);
          continue;
        }
        if (trigger === 'final') {
          throw new ControllerAuditFailure(trigger, `Final controller audit parse error: ${err.message}`);
        }
        return this.fallbackReport(trigger, `Parse error: ${err.message}`);
      }
    }

    if (!report) {
      const message = parseError?.message ?? 'missing controller report';
      if (trigger === 'final') {
        throw new ControllerAuditFailure(trigger, `Final controller audit parse error: ${message}`);
      }
      return this.fallbackReport(trigger, `Parse error: ${message}`);
    }

    this.enforceUnresolvedPlanLater(report, planManager);
    report = this.enforceLoopOwnedLifecycleBoundary(report);
    report = this.enforceFeedbackOverclaimGuard(report, feedbackMatrix, trigger, planManager);
    report = this.enforceVisualWorkbenchSourceContractGuard(report, visualWorkbenchSourceContract, planManager);
    report = this.normalizeEscalationVerdict(report);

    // 5. Apply plan changes
    if (report.verdict === 'revise' && report.planChanges.length > 0) {
      const { applied, errors, dropped } = planManager.applyChanges(report.planChanges);
      log.info(`Controller: applied ${applied} plan changes${errors.length > 0 ? `, ${errors.length} errors` : ''}${dropped.length > 0 ? `, ${dropped.length} dropped` : ''}`);
      for (const err of errors) {
        log.warn(`  Plan change error: ${err}`);
      }
      for (const drop of dropped) {
        log.warn(`  Plan change dropped (boundary): ${drop}`);
      }
    }

    // 5.5. Run E2E enforcement AFTER LLM changes (enforcer has the last word)
    if (this.isE2EEnabled(options)) {
      const e2eResult = applyE2EEnforcement(planManager);
      if (e2eResult.tasksAdded > 0) {
        log.info(`Controller: E2E enforcer added ${e2eResult.tasksAdded} task(s): ${e2eResult.taskIds.join(', ')}`);
      }
    }

    // 6. Add new judgments
    for (const j of report.newJudgments) {
      const judgment = JudgmentSchema.parse(j);
      planManager.addJudgment(judgment);
      judgmentLog.record(judgment);
    }

    // 7. Revise existing judgments
    for (const rev of report.revisedJudgments) {
      try {
        planManager.reviseJudgment(rev.id, rev.newChoice, rev.reasoning);
        const existing = plan.judgments.find(j => j.id === rev.id);
        if (existing) {
          judgmentLog.recordRevision(rev.id, existing.previousChoice ?? existing.chosen, rev.newChoice, rev.reasoning);
        }
      } catch (err: any) {
        log.warn(`Controller: failed to revise judgment ${rev.id}: ${err.message}`);
      }
    }

    // 8. Save
    await planManager.save();
    await judgmentLog.save();

    // 9. Save report
    await this.saveReport(report);

    // 10. Log verdict
    const verdictIcon = report.verdict === 'continue' ? '✅'
      : report.verdict === 'revise' ? '🔄'
      : '⚠️';
    log.info(`Controller verdict: ${verdictIcon} ${report.verdict} — ${report.summary}`);

    return report;
  }

  /**
   * Run the controller prompt/parser/guard path without applying controller
   * outputs to plan, judgments, prompt traces, reports, evidence or lifecycle
   * truth.
   *
   * Startup audits are intentionally excluded: production startup can persist
   * the E2E applicability decision and add E2E tasks.
   */
  async dryRunAudit(options: ControllerDryRunAuditOptions): Promise<ControllerDryRunAuditResult> {
    const { workDir, specPath, agent, planManager, iterationHistory, trigger, verbose, visionReport } = options;
    const specContent = await fs.readFile(specPath, 'utf-8');
    const plan = planManager.currentPlan;
    const recentHistory = iterationHistory.slice(-10);
    const projectSnapshot = await this.gatherProjectSnapshot(workDir);
    const feedbackMatrix = this.shouldRunFeedbackSemanticGuard(trigger)
      ? this.buildFeedbackEvidenceMatrix(specContent, specPath, workDir, plan)
      : [];
    const visualEvidenceMode = options.ralphConfig.visualWorkbench?.visualEvidenceMode ?? 'off';
    const visualWorkbenchSourceContract = this.shouldRunVisualWorkbenchSourceContractGuard(trigger, visualEvidenceMode)
      ? await this.buildVisualWorkbenchSourceContractGuard(workDir, plan, feedbackMatrix, visualEvidenceMode)
      : null;
    const e2eEnabled = this.isE2EEnabled(options);
    const prompt = this.buildAuditPrompt(specContent, plan, recentHistory, projectSnapshot, trigger, e2eEnabled, visionReport, feedbackMatrix);

    const agentResult = await agent.execute({
      workDir,
      prompt,
      allowedTools: [],
      model: options.model,
      timeout: options.timeoutMinutes ?? undefined,
      verbose: verbose ?? true,
    });

    const context = {
      specCharCount: specContent.length,
      projectSnapshotCharCount: projectSnapshot.length,
      recentHistoryCount: recentHistory.length,
      feedbackMatrixRows: feedbackMatrix.length,
      visualWorkbenchSourceContractStatus: visualWorkbenchSourceContract?.status ?? null,
      e2eEnabled,
    };
    const base = {
      ownerBoundary: CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY,
      promptId: 'controller.audit' as const,
      trigger,
      prompt,
      context,
      agentResult,
    };

    if (!agentResult.success) {
      return {
        ...base,
        status: 'agent_failed',
        report: null,
        error: {
          code: 'agent_failed',
          message: agentResult.error?.message ?? (agentResult.output.slice(0, 500) || 'Controller dry-run agent failed.'),
        },
      };
    }

    try {
      let report = this.parseDryRunAgentReport(agentResult.output, trigger);
      this.enforceUnresolvedPlanLater(report, planManager);
      report = this.enforceLoopOwnedLifecycleBoundary(report);
      report = this.enforceFeedbackOverclaimGuard(report, feedbackMatrix, trigger, planManager);
      report = this.enforceVisualWorkbenchSourceContractGuard(report, visualWorkbenchSourceContract, planManager);
      report = this.normalizeEscalationVerdict(report);
      return {
        ...base,
        status: 'parsed',
        report,
        error: null,
      };
    } catch (error) {
      return {
        ...base,
        status: 'parse_or_validation_failed',
        report: null,
        error: {
          code: 'parse_or_validation_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // ── Prompt builder ────────────────────────────────────────────

  private formatVisionReportBlock(visionReport: VisionQAReport): string {
    if (visionReport.status === 'infra_unavailable') {
      return `
## Visual QA Report (skipped: platform browser unavailable)
${visionReport.summary}

Vision QA did not run because platform browser readiness was unavailable.
Do NOT treat this as visual closure evidence or as a project bug. Continue with non-browser checks and current product work.`;
    }

    if (visionReport.status === 'skipped') {
      return `
## Visual QA Report (skipped)
${visionReport.summary}

Vision QA did not run. Do NOT treat this as visual closure evidence.`;
    }

    return `
## Visual QA Report (from e2e video analysis)
${visionReport.summary}

The Vision QA system ran all e2e tests with video recording, extracted frames, and analyzed them with GPT-4o.
Vision FAIL means the UI/game does NOT look correct visually (blank screens, broken rendering, missing elements).
Use this to identify tasks that pass Playwright assertions but have VISUAL problems the assertions don't catch.`;
  }

  private buildAuditPrompt(
    spec: string,
    plan: Plan,
    history: IterationLog[],
    projectSnapshot: string,
    trigger: ControllerTrigger,
    e2eEnabled: boolean,
    visionReport?: VisionQAReport,
    feedbackMatrix: FeedbackEvidenceMatrixRow[] = [],
  ): string {
    const historyText = history.map(h => {
      const icon = h.outcome === 'completed' ? '✅'
        : h.outcome === 'verification_failed' ? '❌'
        : h.outcome === 'deploy_failed' ? '🐳'
        : '💥';
      return `  [iter ${h.iteration}] ${icon} ${h.taskId} — ${h.outcome}${h.summary ? ` — ${h.summary}` : ''}`;
    }).join('\n');

    const visionReportBlock = visionReport ? this.formatVisionReportBlock(visionReport) : '';
    const feedbackMatrixBlock = feedbackMatrix.length > 0 ? `
## Current Feedback Evidence Matrix

The following rows are derived locally from the current accepted spec and Ralph plan. Treat them as mandatory semantic guardrails for this audit.

\`\`\`json
${JSON.stringify(feedbackMatrix, null, 2)}
\`\`\`

Rules:
- Current accepted feedback outranks completed task history.
- A completed task is not closure evidence by itself.
- Final/spec_migration audits must not claim "all bugs evidence-closed" while any row is \`needs_disposition\`, \`open_task\`, or \`implemented_unverified\`.
- \`needs_disposition\` and \`open_task\` are real work blockers: return \`revise\` with concrete work or keep existing open work visible.
- \`implemented_unverified\` is not automatic new work for feedback-only rows. If current product behavior is still wrong, return \`revise\` with concrete implementable work; otherwise return \`continue\` with \`overclaimWarnings\`.
- For hard accepted diff rows where \`targetType\` is \`spec\`, \`asset\`, or another non-\`feedback\` target, \`implemented_unverified\` is weak execution evidence, not automatic public work. If current product behavior is still wrong, return \`revise\` with concrete implementable work; otherwise return \`continue\` with \`overclaimWarnings\`.
- If a row is implemented but lacks target evidence, say "implemented by Ralph work history, not semantically verified" rather than "resolved".
- If a row includes \`sourceEvidence\`, generic unit/integration/source checks are implementation evidence, not semantic closure by themselves. Semantic closure needs product-facing smoke, screenshot, vision QA, or explicit manual proof tied to the row.
- If a row includes \`sourceEvidence\` with absence/contrast semantics such as "instead of", "not text", "remove", or "must not show", closure evidence must prove the disallowed visible text/control/state is absent; presence of the new element alone is not enough.
- Do not turn \`implemented_unverified\`, missing production proof, or "needs confirmation" into a public assumption/action-required review. These are loop evidence and overclaim warnings unless they reveal concrete implementable work.
- Do not create \`newJudgments\` for \`implemented_unverified\`; judgments are only for real product/spec ambiguity.
- \`feedbackMatrix\` is runtime-owned and will be attached by Ralph after your audit. Do NOT return a \`feedbackMatrix\` field.
- \`overclaimWarnings\` must be an array of strings only, not objects.
` : '';
    const e2ePolicyBlock = e2eEnabled ? `## E2E Test Policy
Ralph automatically enforces Playwright e2e tests for completed features only when the project has at least ${E2E_ENFORCER_MIN_FEATURE_TASKS} feature tasks.
Tasks with IDs starting with "e2e-" are system-managed by the E2E Enforcer module.
- DO NOT remove, modify, or re-prioritize e2e-* tasks — they are outside your scope
- DO NOT create judgments about whether e2e tests should exist — this is a system-level policy
- Browser verification infrastructure is platform-owned. Do NOT add tasks that install Chromium, Chrome, Playwright browsers, \`npx playwright install\`, \`playwright install-deps\`, or equivalent browser infra inside the project workspace.
- If platform browser readiness is missing, classify the result as INFRA_BROWSER_UNAVAILABLE rather than a project bug or ad hoc install task.
- If e2e-* tasks seem redundant or problematic, ignore them — the Enforcer handles it` : `## E2E Test Policy
The E2E enforcer is **disabled** for this project by default policy.
No new e2e-* tasks will be generated. You MAY remove existing e2e-* tasks if they are blocking progress or wasting iterations.
Browser verification infrastructure is platform-owned. Do NOT add tasks that install Chromium, Chrome, Playwright browsers, \`npx playwright install\`, \`playwright install-deps\`, or equivalent browser infra inside the project workspace.
If platform browser readiness is missing, classify the result as INFRA_BROWSER_UNAVAILABLE rather than a project bug or ad hoc install task.`;

    return renderControllerAuditPrompt({
      trigger,
      spec,
      planJson: this.buildControllerPlanJson(plan, feedbackMatrix),
      historyText: historyText || '(no iterations yet)',
      projectSnapshot,
      visionReportBlock,
      feedbackMatrixBlock,
      judgmentTimestamp: new Date().toISOString(),
      e2ePolicyBlock,
    });
  }

  private buildControllerPlanJson(plan: Plan, feedbackMatrix: FeedbackEvidenceMatrixRow[]): string {
    const fullPlanJson = JSON.stringify(plan, null, 2);
    if (fullPlanJson.length <= CONTROLLER_FULL_PLAN_MAX_CHARS) {
      return fullPlanJson;
    }

    const linkedTaskIds = new Set(
      feedbackMatrix.flatMap(row => row.linkedTaskIds ?? []),
    );
    const taskEntries = plan.phases.flatMap((phase, phaseIndex) => (
      phase.tasks.map((task, taskIndex) => ({ phase, phaseIndex, task, taskIndex }))
    ));
    const mustInclude = (task: Task): boolean => (
      task.status !== 'completed'
      && task.status !== 'skipped'
    ) || linkedTaskIds.has(task.id);

    const includedTaskIds = new Set(
      taskEntries
        .filter(({ task }) => mustInclude(task))
        .map(({ task }) => task.id),
    );

    const recentCompleted = taskEntries
      .filter(({ task }) => !includedTaskIds.has(task.id) && (task.status === 'completed' || task.status === 'skipped'))
      .slice(-CONTROLLER_COMPLETED_TASK_HISTORY_LIMIT);
    for (const { task } of recentCompleted) includedTaskIds.add(task.id);

    const compactTask = (task: Task) => ({
      id: task.id,
      displayTitle: task.displayTitle,
      description: compactText(task.description, 700),
      acceptanceCriteria: task.acceptanceCriteria.slice(0, 6).map(item => compactText(item, 260)).filter(Boolean),
      status: task.status,
      attempts: task.attempts,
      lastError: compactText(task.lastError, 500),
      priority: task.priority,
      addedBy: task.addedBy,
      requiredRolePasses: task.requiredRolePasses,
      feedbackItemRefs: task.feedbackItemRefs?.map(ref => ({
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
        sourceEvidence: ref.sourceEvidence?.slice(0, 4).map(evidence => ({
          sourceRef: evidence.sourceRef,
          quote: compactText(evidence.quote, 260),
          intent: compactText(evidence.intent, 320),
        })),
        fingerprint: ref.fingerprint,
      })),
      verificationEvidence: task.verificationEvidence?.slice(-6).map(evidence => ({
        kind: evidence.kind,
        ref: evidence.ref,
        observedAt: evidence.observedAt,
        summary: compactText(evidence.summary, 360),
        result: evidence.result,
        feedbackItemIds: evidence.feedbackItemIds,
        taskId: evidence.taskId,
        sourceEvidenceRef: evidence.sourceEvidenceRef,
        command: compactText(evidence.command, 220),
        artifactPath: evidence.artifactPath,
        artifactSha256: evidence.artifactSha256,
        recordedBy: evidence.recordedBy,
        screenshotProof: evidence.screenshotProof,
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
      .map(phase => ({
        id: phase.id,
        name: phase.name,
        description: compactText(phase.description, 500),
        order: phase.order,
        status: phase.status,
        planLater: phase.planLater,
        omittedTaskCount: phase.tasks.filter(task => !includedTaskIds.has(task.id)).length,
        tasks: phase.tasks
          .filter(task => includedTaskIds.has(task.id))
          .map(compactTask),
      }))
      .filter(phase => phase.tasks.length > 0 || phase.status !== 'completed' || phase.planLater);

    const compactJudgment = (judgment: Judgment) => ({
      id: judgment.id,
      timestamp: judgment.timestamp,
      phaseId: judgment.phaseId,
      taskId: judgment.taskId,
      ambiguity: compactText(judgment.ambiguity, 500),
      options: judgment.options.slice(0, 5).map(option => compactText(option, 260)).filter(Boolean),
      chosen: judgment.chosen,
      reasoning: compactText(judgment.reasoning, 700),
      madeBy: judgment.madeBy,
      revisedBy: judgment.revisedBy,
      previousChoice: judgment.previousChoice,
      publicAssumption: judgment.publicAssumption ? {
        id: judgment.publicAssumption.id,
        title: compactText(judgment.publicAssumption.title, 200),
        statement: compactText(judgment.publicAssumption.statement, 700),
        sourceRefs: judgment.publicAssumption.sourceRefs.slice(0, 8),
      } : undefined,
    });

    const compactSpecMigration = (migration: SpecMigration) => ({
      id: migration.id,
      specFile: migration.specFile,
      specHash: migration.specHash,
      appliedAt: migration.appliedAt,
      summary: compactText(migration.summary, 700),
      specChangeSource: migration.specChangeSource,
      requiredFeedbackItems: migration.requiredFeedbackItems?.slice(0, 20).map(item => ({
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
        sourceEvidence: item.sourceEvidence?.slice(0, 3).map(evidence => ({
          sourceRef: evidence.sourceRef,
          quote: compactText(evidence.quote, 220),
          intent: compactText(evidence.intent, 260),
        })),
        fingerprint: item.fingerprint,
      })),
      feedbackDispositions: migration.feedbackDispositions?.slice(0, 30).map(disposition => ({
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
      controllerAuditProjection: {
        originalCharCount: fullPlanJson.length,
        originalPhaseCount: plan.phases.length,
        originalTaskCount: taskEntries.length,
        includedTaskCount: includedTaskIds.size,
        omittedTaskCount: Math.max(0, taskEntries.length - includedTaskIds.size),
        inclusionRule: 'open/failed/in-progress tasks, feedback-linked tasks, plus recent completed history',
      },
      phases: compactPhases,
      judgments: plan.judgments.slice(-CONTROLLER_JUDGMENT_HISTORY_LIMIT).map(compactJudgment),
      specMigrations: plan.specMigrations.slice(-CONTROLLER_SPEC_MIGRATION_HISTORY_LIMIT).map(compactSpecMigration),
      e2eApplicable: plan.e2eApplicable,
    }, null, 2);
  }

  private enforceLoopOwnedLifecycleBoundary(report: ControllerReport): ControllerReport {
    const filteredChanges: PlanChange[] = [];
    const blocked: string[] = [];

    for (const change of report.planChanges) {
      if (this.isLoopTerminalResultPlanChange(change)) {
        blocked.push(this.describePlanChange(change));
        continue;
      }

      if (change.action === 'addPhase') {
        const phaseTasks = change.phase.tasks;
        const keptTasks = phaseTasks.filter(task => !this.isLoopTerminalResultTask(task));
        const removedTasks = phaseTasks.filter(task => this.isLoopTerminalResultTask(task));

        if (removedTasks.length > 0) {
          blocked.push(...removedTasks.map(task => `addPhase:${change.phase.id}/${task.id}`));
          if (keptTasks.length === 0 && !change.phase.planLater) {
            continue;
          }
          filteredChanges.push({
            ...change,
            phase: {
              ...change.phase,
              tasks: keptTasks,
            },
          });
          continue;
        }
      }

      filteredChanges.push(change);
    }

    if (blocked.length === 0) return report;

    log.warn(`Controller: ignored loop-owned lifecycle plan change(s): ${blocked.join(', ')}`);

    const hasOtherReportChanges =
      filteredChanges.length > 0
      || report.newJudgments.length > 0
      || report.revisedJudgments.length > 0;

    return {
      ...report,
      verdict: report.verdict === 'revise' && !hasOtherReportChanges ? 'continue' : report.verdict,
      summary: `${report.summary}\n\nController guard: ignored ${blocked.length} loop-owned lifecycle plan change(s) for .arena/result.json. Ralph writes the terminal result in finalize(); executor tasks must stay product-owned.`,
      planChanges: filteredChanges,
    };
  }

  private normalizeEscalationVerdict(report: ControllerReport): ControllerReport {
    if (report.verdict !== 'escalate') return report;

    const normalizedVerdict = report.planChanges.length > 0 ? 'revise' : 'continue';
    const warning = `Controller requested escalation; normalized to ${normalizedVerdict}. Product judgment is not allowed to pause project lifecycle.`;
    return {
      ...report,
      verdict: normalizedVerdict,
      summary: report.summary.includes('Product judgment is not allowed to pause project lifecycle')
        ? report.summary
        : `${report.summary}\n\nController guard: product judgment is not allowed to pause project lifecycle. Ralph records the judgment and continues.`,
      overclaimWarnings: [
        ...(report.overclaimWarnings ?? []),
        warning,
      ],
    };
  }

  private shouldRunFeedbackSemanticGuard(trigger: ControllerTrigger): boolean {
    return trigger === 'final' || trigger === 'spec_migration';
  }

  private shouldRunVisualWorkbenchSourceContractGuard(trigger: ControllerTrigger, visualEvidenceMode: VisualEvidenceMode): boolean {
    return trigger === 'final' && visualEvidenceMode !== 'off';
  }

  private async buildVisualWorkbenchSourceContractGuard(
    workDir: string,
    plan: Plan,
    feedbackMatrix: FeedbackEvidenceMatrixRow[],
    visualEvidenceMode: VisualEvidenceMode,
  ): Promise<VisualWorkbenchSourceContractGuard> {
    const manifestPath = path.join(workDir, VISUAL_WORKBENCH_MANIFEST_PATH);
    const rows = feedbackMatrix.filter((row) => this.isVisualWorkbenchSourceContractRow(row, plan, visualEvidenceMode));

    if (rows.length === 0) {
      return {
        status: 'not_applicable',
        visualEvidenceMode,
        manifestPath,
        rows,
        blockers: [],
        issueDetails: [],
        selectorIssues: [],
      };
    }

    if (!await fs.pathExists(manifestPath)) {
      return {
        status: 'blocked',
        visualEvidenceMode,
        manifestPath,
        rows,
        blockers: ['manifest_missing'],
        issueDetails: [],
        selectorIssues: [],
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch {
      return {
        status: 'blocked',
        visualEvidenceMode,
        manifestPath,
        rows,
        blockers: ['manifest_invalid_json'],
        issueDetails: [],
        selectorIssues: [],
      };
    }

    const issueDetails = getVisualWorkbenchManifestIssueDetails(raw);
    try {
      parseVisualWorkbenchManifest(raw);
    } catch {
      return {
        status: 'blocked',
        visualEvidenceMode,
        manifestPath,
        rows,
        blockers: ['manifest_contract_invalid'],
        issueDetails,
        selectorIssues: [],
      };
    }

    const relevantTaskIds = this.visualWorkbenchSourceContractTaskIds(rows, plan, visualEvidenceMode);
    const selectorReadiness = await getVisualWorkbenchSelectorReadinessForPlan({
      workDir,
      plan,
      candidateTaskIds: [...relevantTaskIds],
    });
    const selectorIssues = [
      ...this.findVisualWorkbenchSourceOwnerIssues(rows, plan, visualEvidenceMode),
      ...this.findVisualWorkbenchSelectorIssues(selectorReadiness, relevantTaskIds),
    ];
    if (selectorIssues.length > 0) {
      return {
        status: 'blocked',
        visualEvidenceMode,
        manifestPath,
        rows,
        blockers: ['selector_readiness_blocked'],
        issueDetails: [],
        selectorIssues,
      };
    }

    return {
      status: 'ready',
      visualEvidenceMode,
      manifestPath,
      rows,
      blockers: [],
      issueDetails: [],
      selectorIssues: [],
    };
  }

  private findVisualWorkbenchSelectorIssues(
    selectorReadiness: VisualWorkbenchSelectorReadinessResult,
    relevantTaskIds: Set<string>,
  ): VisualWorkbenchSourceContractSelectorIssue[] {
    if (relevantTaskIds.size === 0) return [];

    return selectorReadiness.tasks
      .filter((task) => relevantTaskIds.has(task.taskId) && task.readiness === 'blocked')
      .map((task) => this.visualWorkbenchSelectorIssueFromTask(task));
  }

  private findVisualWorkbenchSourceOwnerIssues(
    rows: FeedbackEvidenceMatrixRow[],
    plan: Plan,
    visualEvidenceMode: VisualEvidenceMode,
  ): VisualWorkbenchSourceContractSelectorIssue[] {
    return rows
      .filter((row) => this.visualWorkbenchSourceOwnerTasksForRow(row, plan, visualEvidenceMode).length === 0)
      .map((row) => ({
        taskId: row.itemId,
        title: `Accepted diff ${row.itemId}`,
        blockers: ['no_non_repair_evidence_owner'],
        selectorIdentities: [row.itemId, row.diffItemId, row.targetId].filter((value): value is string => !!value),
        ambiguities: [],
        selectedStories: [],
        selectedViewports: [],
      }));
  }

  private visualWorkbenchSourceContractTaskIds(
    rows: FeedbackEvidenceMatrixRow[],
    plan: Plan,
    visualEvidenceMode: VisualEvidenceMode,
  ): Set<string> {
    const relevantTaskIds = new Set<string>();
    for (const row of rows) {
      for (const task of this.tasksForMatrixRow(plan, row)) {
        if (this.taskRepairsVisualWorkbenchSourceContract(task)) continue;
        if (this.taskRequiresVisualWorkbenchSourceContract(task, visualEvidenceMode)) {
          relevantTaskIds.add(task.id);
        }
      }
    }
    return relevantTaskIds;
  }

  private visualWorkbenchSelectorIssueFromTask(
    task: VisualWorkbenchSelectorReadinessTask,
  ): VisualWorkbenchSourceContractSelectorIssue {
    return {
      taskId: task.taskId,
      title: task.title,
      blockers: task.blockers,
      selectorIdentities: task.selectorIdentities,
      ambiguities: task.ambiguities,
      selectedStories: task.selections.map((selection) => selection.storyId),
      selectedViewports: task.exportSelections.map((selection) => `${selection.storyId}:${selection.viewportName}`),
    };
  }

  private isVisualWorkbenchSourceContractRow(row: FeedbackEvidenceMatrixRow, plan: Plan, visualEvidenceMode: VisualEvidenceMode): boolean {
    if (visualEvidenceMode === 'off') return false;
    if (row.closureAllowed) return false;
    if (row.workSurface !== 'frontend') return false;
    const linkedTasks = this.tasksForMatrixRow(plan, row)
      .filter((task) => !this.taskRepairsVisualWorkbenchSourceContract(task));
    if (linkedTasks.some((task) => this.taskRequiresVisualWorkbenchSourceContract(task, visualEvidenceMode))) return true;
    return false;
  }

  private taskRequiresVisualWorkbenchSourceContract(task: Task, visualEvidenceMode: VisualEvidenceMode): boolean {
    if (visualEvidenceMode === 'off') return false;
    if (this.taskRepairsVisualWorkbenchSourceContract(task)) return false;
    if (task.visualEvidenceRequired === true) return true;
    if (visualEvidenceMode === 'new_tasks_only') return false;

    const frontendLike = (task.requiredRolePasses ?? []).includes('ux')
      || (task.feedbackItemRefs ?? []).some((ref) => ref.workSurface === 'frontend');
    if (!frontendLike) return false;

    const text = [
      task.displayTitle,
      task.description,
      ...task.acceptanceCriteria,
    ].filter(Boolean).join('\n').toLowerCase();
    return text.includes('visual workbench')
      || text.includes('visual-workbench')
      || text.includes('visual-workbench/manifest.json')
      || text.includes('visual-workbench/stories');
  }

  private tasksForMatrixRow(plan: Plan, row: FeedbackEvidenceMatrixRow): Task[] {
    const linkedIds = new Set(row.linkedTaskIds ?? []);
    return plan.phases.flatMap((phase) => phase.tasks).filter((task) => (
      linkedIds.has(task.id)
      || this.taskReferencesFeedbackNeedles(task, this.feedbackMatrixRowNeedles(row))
    ));
  }

  private buildFeedbackEvidenceMatrix(
    specContent: string,
    specPath: string,
    workDir: string,
    plan: Plan,
  ): FeedbackEvidenceMatrixRow[] {
    const acceptedDiffMatrix = this.buildAcceptedDiffEvidenceMatrix(plan);
    if (acceptedDiffMatrix.length > 0) return acceptedDiffMatrix;

    const specFile = path.relative(workDir, specPath);
    const specHash = crypto.createHash('sha256').update(specContent).digest('hex');
    const currentItems = getWorkRequiredFeedbackItems(
      extractCurrentFeedbackItems(specContent, { specFile, specHash }),
    );
    if (currentItems.length === 0) return [];
    const guardItems = this.selectFeedbackGuardItems(plan, currentItems, specFile, specHash);
    if (guardItems.length === 0) return [];

    const tasksById = new Map<string, Task>();
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        tasksById.set(task.id, task);
      }
    }

    return guardItems.map((item) => {
      const disposition = this.findLatestFeedbackDisposition(plan, item.id);
      const linkedTaskIds = this.findFeedbackLinkedTaskIds(plan, item.id, disposition);
      const linkedTasks = linkedTaskIds
        .map((taskId) => tasksById.get(taskId))
        .filter((task): task is Task => !!task);
      const hasOpenTask = linkedTasks.some((task) => task.status !== 'completed' && task.status !== 'skipped');
      const hasCompletedTask = linkedTasks.some((task) => task.status === 'completed');
      const dispositionEvidence = disposition?.evidence ?? [];
      const taskEvidence = linkedTasks.flatMap((task) => task.verificationEvidence ?? []);
      const hasPositiveClosureEvidence = hasPositiveFeedbackEvidenceForItem(
        item.id,
        dispositionEvidence,
        { allowImplicitItemLink: true },
      ) || hasPositiveFeedbackEvidenceForItem(item.id, taskEvidence);

      let status: FeedbackEvidenceMatrixRow['status'] = 'needs_disposition';
      if (hasOpenTask) {
        status = 'open_task';
      } else if (hasPositiveClosureEvidence) {
        status = 'closed_by_evidence';
      } else if (disposition?.disposition === 'blocked') {
        status = 'blocked';
      } else if (disposition?.disposition === 'needsJudgment') {
        status = 'needs_judgment';
      } else if (hasCompletedTask) {
        status = 'implemented_unverified';
      }

      const closureAllowed = status === 'closed_by_evidence' || status === 'blocked' || status === 'needs_judgment';
      return {
        itemId: item.id,
        specFile,
        specHash,
        status,
        disposition: disposition?.disposition,
        linkedTaskIds,
        closureAllowed,
        operatorSummary: this.describeFeedbackMatrixRow(item.id, status, linkedTaskIds),
      };
    });
  }

  private buildAcceptedDiffEvidenceMatrix(plan: Plan): FeedbackEvidenceMatrixRow[] {
    const migration = this.findCurrentAcceptedDiffRequiredMigration(plan);
    const requiredItems = migration?.requiredFeedbackItems ?? [];
    if (requiredItems.length === 0) return [];

    const tasksById = new Map<string, Task>();
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        tasksById.set(task.id, task);
      }
    }

    return requiredItems.map((item) => {
      const disposition = this.findLatestFeedbackDisposition(plan, item.itemId);
      const linkedTaskIds = this.findRequiredDiffLinkedTaskIds(plan, item, disposition);
      const linkedTasks = linkedTaskIds
        .map((taskId) => tasksById.get(taskId))
        .filter((task): task is Task => !!task);
      const hasOpenTask = linkedTasks.some((task) => task.status !== 'completed' && task.status !== 'skipped');
      const hasCompletedTask = linkedTasks.some((task) => task.status === 'completed');
      const dispositionEvidence = disposition?.evidence ?? [];
      const taskEvidence = linkedTasks.flatMap((task) => task.verificationEvidence ?? []);
      const closureDispositionEvidence = this.closureEvidenceForAcceptedDiffItem(item, dispositionEvidence);
      const closureTaskEvidence = this.closureEvidenceForAcceptedDiffItem(item, taskEvidence);
      const hasPositiveClosureEvidenceForItem = hasPositiveFeedbackEvidenceForItem(
        item.itemId,
        closureDispositionEvidence,
        { allowImplicitItemLink: true },
      ) || hasPositiveFeedbackEvidenceForItem(item.itemId, closureTaskEvidence);
      const hasPositiveClosureEvidenceForTarget = item.targetId
        ? hasPositiveFeedbackEvidenceForItem(
          item.targetId,
          closureDispositionEvidence,
          { allowImplicitItemLink: false },
        ) || hasPositiveFeedbackEvidenceForItem(item.targetId, closureTaskEvidence)
        : false;
      const hasPositiveClosureEvidence = hasPositiveClosureEvidenceForItem || hasPositiveClosureEvidenceForTarget;

      let status: FeedbackEvidenceMatrixRow['status'] = 'needs_disposition';
      if (hasOpenTask) {
        status = 'open_task';
      } else if (hasPositiveClosureEvidence) {
        status = 'closed_by_evidence';
      } else if (disposition?.disposition === 'blocked') {
        status = 'blocked';
      } else if (disposition?.disposition === 'needsJudgment') {
        status = 'needs_judgment';
      } else if (hasCompletedTask) {
        status = 'implemented_unverified';
      }

      const closureAllowed = this.isHardAcceptedDiffRow({ targetType: item.targetType })
        ? status === 'closed_by_evidence' || status === 'blocked'
        : status === 'closed_by_evidence' || status === 'blocked' || status === 'needs_judgment';

      return {
        itemId: item.itemId,
        diffItemId: item.diffItemId,
        targetType: item.targetType,
        targetId: item.targetId,
        changeType: item.changeType,
        workImpact: item.workImpact,
        workSurface: item.workSurface,
        feedbackStatus: item.status,
        summary: item.summary,
        sourceRefs: item.sourceRefs,
        sourceEvidence: item.sourceEvidence,
        specFile: migration?.specFile,
        specHash: migration?.specHash,
        migrationId: migration?.id,
        fingerprint: item.fingerprint,
        status,
        disposition: disposition?.disposition,
        linkedTaskIds,
        closureAllowed,
        operatorSummary: this.describeAcceptedDiffMatrixRow(item, status, linkedTaskIds),
      };
    });
  }

  private closureEvidenceForAcceptedDiffItem(
    item: SpecMigrationFeedbackItem,
    evidence: FeedbackEvidence[],
  ): FeedbackEvidence[] {
    if ((item.sourceEvidence ?? []).length === 0) return evidence;
    return this.filterSourceEvidenceClosureRows(
      item,
      evidence.filter((row) => SOURCE_EVIDENCE_CLOSURE_KINDS.has(row.kind)),
    );
  }

  private filterSourceEvidenceClosureRows(
    item: SpecMigrationFeedbackItem,
    evidence: FeedbackEvidence[],
  ): FeedbackEvidence[] {
    const rows: FeedbackEvidence[] = [];
    const proofGroups = new Map<string, {
      before?: { row: FeedbackEvidence; digest: string };
      after?: { row: FeedbackEvidence; digest: string };
    }>();

    for (const row of evidence) {
      if (row.kind !== 'screenshot' || row.screenshotProof?.expectationKind !== 'before_after_screenshot') {
        rows.push(row);
        continue;
      }

      const role = row.screenshotProof.role;
      if (!this.screenshotProofHasReviewTarget(row)) continue;

      const digest = this.proofEvidenceDigestForComparison(row.artifactSha256);
      if (!digest) continue;

      if (role === 'after_only') {
        rows.push(row);
        continue;
      }

      if (role !== 'before' && role !== 'after') continue;

      for (const key of this.screenshotProofClosureGroupKeys(item, row)) {
        const group = proofGroups.get(key) ?? {};
        if (role === 'before') {
          group.before = { row, digest };
        } else {
          group.after = { row, digest };
        }
        proofGroups.set(key, group);
      }
    }

    const included = new Set<FeedbackEvidence>();
    for (const group of proofGroups.values()) {
      if (!group.before || !group.after) continue;
      if (group.before.digest === group.after.digest) continue;
      included.add(group.before.row);
      included.add(group.after.row);
    }

    return [...rows, ...included];
  }

  private screenshotProofHasReviewTarget(row: FeedbackEvidence): boolean {
    const target = row.target;
    if (!target || typeof target !== 'object') return false;

    const route = target.route;
    if (typeof route !== 'string' || !route.startsWith('/') || route.includes('\\')) return false;

    const width = target.viewport?.width;
    const height = target.viewport?.height;
    if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
    if (width < 1 || height < 1 || width > 10_000 || height > 10_000) return false;

    const claim = target.claim ?? target.state ?? target.interaction;
    return typeof claim === 'string' && claim.trim().length > 0 && claim.trim().length <= 500;
  }

  private screenshotProofClosureGroupKeys(
    item: SpecMigrationFeedbackItem,
    row: FeedbackEvidence,
  ): string[] {
    const taskKey = row.taskId?.trim() || '__no_task__';
    const linkedIds = new Set((row.feedbackItemIds ?? []).filter((id) => typeof id === 'string' && id.length > 0));
    if (linkedIds.size === 0) {
      linkedIds.add(item.itemId);
    }
    return [...linkedIds].sort().map((id) => `${taskKey}:${id}`);
  }

  private proofEvidenceDigestForComparison(value: string | null | undefined): string | null {
    if (!value) return null;
    const text = value.trim().toLowerCase();
    const digest = text.startsWith('sha256:') ? text.slice('sha256:'.length) : text;
    return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
  }

  private findCurrentAcceptedDiffRequiredMigration(plan: Plan): SpecMigration | undefined {
    const specMigrations = plan.specMigrations ?? [];
    return [...specMigrations].reverse().find((migration) => (
      migration.specChangeSource?.kind === 'accepted_artifact'
      && (migration.requiredFeedbackItems ?? []).length > 0
    ));
  }

  private selectFeedbackGuardItems(
    plan: Plan,
    items: SpecFeedbackItem[],
    specFile: string,
    specHash: string,
  ): SpecFeedbackItem[] {
    const scopedIds = this.findCurrentFeedbackGuardScope(plan, specFile, specHash);
    if (scopedIds.size > 0) {
      return items.filter((item) => scopedIds.has(item.id));
    }

    return items.filter((item) => (
      item.status.startsWith('reopened#')
      || this.findFeedbackLinkedTaskIds(plan, item.id, undefined).length === 0
    ));
  }

  private findCurrentFeedbackGuardScope(plan: Plan, specFile: string, specHash: string): Set<string> {
    const specMigrations = plan.specMigrations ?? [];
    const matching = [...specMigrations].reverse().find((migration) => (
      migration.specFile === specFile
      && migration.specHash === specHash
      && (migration.requiredFeedbackItems ?? []).length > 0
    ));
    const scopedItems = matching?.requiredFeedbackItems
      ?? [...specMigrations].reverse().find((migration) => (migration.requiredFeedbackItems ?? []).length > 0)?.requiredFeedbackItems
      ?? [];
    return new Set(scopedItems.map((item) => item.itemId));
  }

  private findLatestFeedbackDisposition(plan: Plan, itemId: string): SpecFeedbackDisposition | undefined {
    for (const migration of [...(plan.specMigrations ?? [])].reverse()) {
      const disposition = (migration.feedbackDispositions ?? []).find((row) => row.itemId === itemId);
      if (disposition) return disposition;
    }
    // RA-373: dispositions older than the retention window live in the
    // feedback ledger; retained migrations above are always newer.
    return plan.feedbackLedger?.[itemId]?.disposition;
  }

  private findFeedbackLinkedTaskIds(
    plan: Plan,
    itemId: string,
    disposition: SpecFeedbackDisposition | undefined,
  ): string[] {
    const linked = new Set<string>(disposition?.taskIds ?? []);
    const itemNeedle = itemId.toLowerCase();

    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if ((task.feedbackItemRefs ?? []).some((ref) => ref.itemId === itemId)) {
          linked.add(task.id);
          continue;
        }
        const taskText = [
          task.description,
          ...task.acceptanceCriteria,
        ].join('\n').toLowerCase();
        if (taskText.includes(itemNeedle)) {
          linked.add(task.id);
        }
      }
    }

    return Array.from(linked).sort();
  }

  private findRequiredDiffLinkedTaskIds(
    plan: Plan,
    item: Pick<SpecMigrationFeedbackItem, 'itemId' | 'diffItemId' | 'targetId'>,
    disposition: SpecFeedbackDisposition | undefined,
  ): string[] {
    const linked = new Set<string>(disposition?.taskIds ?? []);
    const needles = [item.itemId, item.diffItemId, item.targetId]
      .filter((value): value is string => !!value)
      .map((value) => value.toLowerCase());

    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if ((task.feedbackItemRefs ?? []).some((ref) => (
          ref.itemId === item.itemId
          || (!!item.diffItemId && ref.diffItemId === item.diffItemId)
          || (!!item.targetId && ref.targetId === item.targetId)
        ))) {
          linked.add(task.id);
          continue;
        }
        const taskText = [
          task.description,
          ...task.acceptanceCriteria,
        ].join('\n').toLowerCase();
        if (needles.some((needle) => taskText.includes(needle))) {
          linked.add(task.id);
        }
      }
    }

    return Array.from(linked).sort();
  }

  private describeFeedbackMatrixRow(
    itemId: string,
    status: FeedbackEvidenceMatrixRow['status'],
    linkedTaskIds: string[],
  ): string {
    const taskText = linkedTaskIds.length > 0 ? ` linked tasks: ${linkedTaskIds.join(', ')}` : ' no linked tasks';
    switch (status) {
      case 'closed_by_evidence':
        return `${itemId}: closed by concrete evidence;${taskText}`;
      case 'blocked':
        return `${itemId}: blocked with explicit reason;${taskText}`;
      case 'needs_judgment':
        return `${itemId}: needs explicit judgment;${taskText}`;
      case 'open_task':
        return `${itemId}: current feedback has open work;${taskText}`;
      case 'implemented_unverified':
        return `${itemId}: only completed historical work is linked; semantic evidence is still missing`;
      case 'needs_disposition':
        return `${itemId}: current feedback has no saved disposition;${taskText}`;
    }
  }

  private describeAcceptedDiffMatrixRow(
    item: SpecMigrationFeedbackItem,
    status: FeedbackEvidenceMatrixRow['status'],
    linkedTaskIds: string[],
  ): string {
    const target = [item.targetType, item.targetId].filter(Boolean).join(':') || 'accepted diff item';
    const taskText = linkedTaskIds.length > 0 ? ` linked tasks: ${linkedTaskIds.join(', ')}` : ' no linked tasks';
    const summary = item.summary ? ` summary: ${item.summary}` : '';
    return `${item.itemId} (${target}) ${status};${taskText};${summary}`;
  }

  private enforceFeedbackOverclaimGuard(
    report: ControllerReport,
    feedbackMatrix: FeedbackEvidenceMatrixRow[],
    trigger: ControllerTrigger,
    planManager: PlanManager,
  ): ControllerReport {
    if (!this.shouldRunFeedbackSemanticGuard(trigger)) return report;

    const nonClosedRows = feedbackMatrix.filter((row) => !row.closureAllowed);
    const completedControllerFollowupRows = nonClosedRows.filter((row) => this.hasCompletedControllerFollowupForRow(
      planManager.currentPlan,
      row,
    ));
    const completedControllerFollowupKeys = new Set(
      completedControllerFollowupRows.map((row) => this.feedbackMatrixRowKey(row)),
    );
    const workBlockingRows = nonClosedRows.filter((row) => (
      this.isFeedbackWorkBlockingRow(row)
      && !completedControllerFollowupKeys.has(this.feedbackMatrixRowKey(row))
    ));
    const implementedUnverifiedRows = nonClosedRows.filter((row) => row.status === 'implemented_unverified');
    const overclaimWarnings = [
      ...(report.overclaimWarnings ?? []),
      ...nonClosedRows.map((row) => row.operatorSummary),
    ];
    const reportType = trigger === 'replan' ? 'replan_audit' : 'semantic_audit';
    let guarded: ControllerReport = {
      ...report,
      reportType,
      semanticAudit: true,
      feedbackMatrix,
      overclaimWarnings,
    };
    const suppressibleImplementedFeedbackRows = implementedUnverifiedRows.filter((row) => (
      this.isFeedbackItemMatrixRow(row)
      && (row.sourceEvidence ?? []).length > 0
    ));
    const suppressibleImplementedHardProofRows = implementedUnverifiedRows.filter((row) => !this.isFeedbackItemMatrixRow(row));
    const attachableImplementedRows = implementedUnverifiedRows.filter((row) => !this.isFeedbackItemMatrixRow(row));
    const guardedCoveringChanges = this.attachFeedbackRefsToCoveringPlanChanges(guarded.planChanges, feedbackMatrix);
    const suppressedImplementedFeedbackChanges = this.suppressImplementedUnverifiedFeedbackPlanChanges(
      guardedCoveringChanges,
      suppressibleImplementedFeedbackRows,
      feedbackMatrix,
    );
    const suppressedImplementedHardProofChanges = this.suppressImplementedUnverifiedHardProofPlanChanges(
      suppressedImplementedFeedbackChanges.planChanges,
      suppressibleImplementedHardProofRows,
      feedbackMatrix,
    );
    guarded = {
      ...guarded,
      planChanges: this.attachFeedbackRefsToSingleControllerFollowup(
        suppressedImplementedHardProofChanges.planChanges,
        attachableImplementedRows,
      ),
    };
    const additionalPlanChanges = this.buildFeedbackGuardPlanChanges(workBlockingRows, planManager, guarded.planChanges);
    const suppressionSummary = suppressedImplementedFeedbackChanges.suppressedCount > 0
      ? `Controller guard: ignored ${suppressedImplementedFeedbackChanges.suppressedCount} sourceEvidence implemented_unverified feedback follow-up task(s). Missing proof stays in overclaimWarnings unless there is newer accepted feedback or concrete product work beyond proof collection.`
      : '';
    const hardProofSuppressionSummary = suppressedImplementedHardProofChanges.suppressedCount > 0
      ? `Controller guard: ignored ${suppressedImplementedHardProofChanges.suppressedCount} generic implemented_unverified hard accepted diff verification task(s). Missing proof stays in overclaimWarnings unless there is concrete product work.`
      : '';
    const completedFollowupSummary = completedControllerFollowupRows.length > 0
      ? `Controller guard: did not add duplicate follow-up for ${completedControllerFollowupRows.length} hard accepted diff row(s) with completed controller follow-up. Weak closure evidence stays in overclaimWarnings until fresh accepted feedback or concrete product work appears.`
      : '';

    if (workBlockingRows.length === 0) {
      if (implementedUnverifiedRows.length === 0) return guarded;

      const weakEvidenceIds = implementedUnverifiedRows.map((row) => `${row.itemId}:${row.status}`).join(', ');
      const guardSummary = `Controller guard: Ralph has completed linked work but closure evidence is weak or missing (${weakEvidenceIds}). This remains private runtime evidence, not a public assumption; later accepted feedback can reopen it.`;
      const summary = [
        guarded.summary,
        guarded.summary.includes('Controller guard: Ralph has completed linked work but closure evidence is weak or missing') ? '' : guardSummary,
        completedFollowupSummary && !guarded.summary.includes('Controller guard: did not add duplicate follow-up')
          ? completedFollowupSummary
          : '',
        suppressionSummary && !guarded.summary.includes('Controller guard: ignored')
          ? suppressionSummary
          : '',
        hardProofSuppressionSummary && !guarded.summary.includes('Controller guard: ignored')
          ? hardProofSuppressionSummary
          : '',
      ].filter(Boolean).join('\n\n');
      return {
        ...guarded,
        verdict: guarded.planChanges.length > 0 ? guarded.verdict : 'continue',
        summary,
      };
    }

    const blockingIds = workBlockingRows.map((row) => `${row.itemId}:${row.status}`).join(', ');
    const guardSummary = `Controller guard: current accepted diff still has open, undispositioned, or judgment-blocked work (${blockingIds}). Completed task history or judgment alone is not closure evidence.`;
    return {
      ...guarded,
      verdict: 'revise',
      summary: [
        guarded.summary,
        guarded.summary.includes('Controller guard: current accepted diff still has open, undispositioned, or judgment-blocked work') ? '' : guardSummary,
        completedFollowupSummary && !guarded.summary.includes('Controller guard: did not add duplicate follow-up')
          ? completedFollowupSummary
          : '',
        suppressionSummary && !guarded.summary.includes('Controller guard: ignored')
          ? suppressionSummary
          : '',
        hardProofSuppressionSummary && !guarded.summary.includes('Controller guard: ignored')
          ? hardProofSuppressionSummary
          : '',
      ].filter(Boolean).join('\n\n'),
      planChanges: [
        ...guarded.planChanges,
        ...additionalPlanChanges,
      ],
    };
  }

  private enforceVisualWorkbenchSourceContractGuard(
    report: ControllerReport,
    guard: VisualWorkbenchSourceContractGuard | null,
    planManager: PlanManager,
  ): ControllerReport {
    if (!guard || guard.status !== 'blocked' || guard.rows.length === 0) return report;

    const summaryLine = this.describeVisualWorkbenchSourceContractGuard(guard);
    const existingChangesCoverGuard = report.planChanges.some((change) => (
      this.planChangeRepairsVisualWorkbenchSourceContract(change, guard.rows, planManager.currentPlan)
    ));
    const existingTaskExists = this.hasVisualWorkbenchSourceContractTask(planManager.currentPlan, guard.rows);

    if (existingChangesCoverGuard || existingTaskExists) {
      return {
        ...report,
        verdict: report.verdict === 'continue' ? 'revise' : report.verdict,
        summary: report.summary.includes('Controller guard: Visual Workbench source contract is blocked')
          ? report.summary
          : `${report.summary}\n\n${summaryLine}`,
        overclaimWarnings: [
          ...(report.overclaimWarnings ?? []),
          summaryLine,
        ],
      };
    }

    return {
      ...report,
      verdict: 'revise',
      summary: report.summary.includes('Controller guard: Visual Workbench source contract is blocked')
        ? report.summary
        : `${report.summary}\n\n${summaryLine}`,
      planChanges: [
        ...report.planChanges,
        this.buildVisualWorkbenchSourceContractPlanChange(guard, planManager, report.planChanges),
      ],
      overclaimWarnings: [
        ...(report.overclaimWarnings ?? []),
        summaryLine,
      ],
    };
  }

  private describeVisualWorkbenchSourceContractGuard(guard: VisualWorkbenchSourceContractGuard): string {
    const rows = guard.rows.map((row) => row.itemId).join(', ');
    const blockers = guard.blockers.join(', ');
    const details = this.formatVisualWorkbenchIssueDetails(guard.issueDetails);
    const selectorDetails = this.formatVisualWorkbenchSelectorIssues(guard.selectorIssues);
    return [
      `Controller guard: Visual Workbench source contract is blocked for frontend accepted diff row(s) ${rows}; blockers=${blockers}.`,
      details ? `Manifest issue details: ${details}.` : '',
      selectorDetails ? `Selector issue details: ${selectorDetails}.` : '',
      'Fix the source-owned Workbench manifest/stories before screenshot evidence can be captured or reviewed.',
    ].filter(Boolean).join(' ');
  }

  private buildVisualWorkbenchSourceContractPlanChange(
    guard: VisualWorkbenchSourceContractGuard,
    planManager: PlanManager,
    existingChanges: PlanChange[],
  ): PlanChange {
    const existingTaskIds = new Set<string>();
    const existingPhaseIds = new Set<string>();
    for (const phase of planManager.currentPlan.phases) {
      existingPhaseIds.add(phase.id);
      for (const task of phase.tasks) existingTaskIds.add(task.id);
    }
    for (const change of existingChanges) {
      if (change.action === 'addTask') existingTaskIds.add(change.task.id);
      if (change.action === 'addPhase') {
        existingPhaseIds.add(change.phase.id);
        for (const task of change.phase.tasks) existingTaskIds.add(task.id);
      }
    }

    const taskId = this.nextUniqueTaskId(existingTaskIds, this.nextTaskNumber(planManager.currentPlan, existingChanges));
    const affectedRows = guard.rows.map((row) => {
      const target = row.targetType && row.targetId ? `${row.targetType}:${row.targetId}` : 'accepted diff item';
      return `${row.itemId} (${target})`;
    }).join(', ');
    const issueDetails = this.formatVisualWorkbenchIssueDetails(guard.issueDetails);
    const selectorDetails = this.formatVisualWorkbenchSelectorIssues(guard.selectorIssues);
    const sourceOwnerGuidance = this.formatVisualWorkbenchSourceOwnerGuidance(guard, planManager.currentPlan);
    const feedbackItemRefs = this.visualWorkbenchGuardFeedbackRefs(guard.rows);

    const task: Task = {
      id: taskId,
      displayTitle: 'Repair Visual Workbench coverage',
      description: [
        `Repair source-owned Visual Workbench coverage for frontend accepted diff row(s): ${affectedRows}.`,
        `Current blocker(s): ${guard.blockers.join(', ')}.`,
        issueDetails ? `Manifest issue details: ${issueDetails}.` : '',
        selectorDetails ? `Selector issue details: ${selectorDetails}.` : '',
        sourceOwnerGuidance ? `Selector owner guidance: ${sourceOwnerGuidance}.` : '',
        'This is source coverage repair, not manual screenshot proof. Do not reimplement unrelated product work.',
      ].filter(Boolean).join(' '),
      acceptanceCriteria: [
        '`visual-workbench/manifest.json` validates against `ra-355.visual-coverage-manifest.v0` using the shared Workbench contract.',
        'Unsupported story fields are removed; currently accepted optional story fields are `interaction`, `waitAfterLoadMs`, `tags` and `taskRelevance`.',
        '`taskRelevance.defaultFor` maps original frontend evidence-owner tasks to explicit Workbench stories; do not infer selectors from story ids, routes, widgets, states, claims or filenames.',
        'Do not make this repair task the screenshot evidence owner; do not use this repair task id or its attached feedback refs in `taskRelevance.defaultFor`.',
        'Map repaired stories to exact owner selector tokens from Selector owner guidance, preferably `<taskId>#<acceptedRef>`; use a plain task id only when it cannot select multiple tasks or multiple feedback refs.',
        'Each screenshot evidence owner must resolve to exactly one task, one feedback item id and one diff item id.',
        'Each affected Workbench story maps to exactly one task and has unique viewport names for export.',
        'Workbench stories remain source-owned render recipes for the affected feature, widget and important states.',
        'Do not edit `.ralph/`, `.arena/`, raw screenshot directories, `proofReviews`, `ProjectAsset` rows or legacy screenshot proof paths to manufacture evidence.',
        'Do not fall back to unrelated page screenshots; if a story is missing or invalid, fix the Workbench source recipe.',
      ],
      status: 'pending',
      attempts: 0,
      priority: 2,
      dependencies: [],
      estimatedComplexity: 'medium',
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs,
    };

    const targetPhaseId = this.findFeedbackGuardPhaseId(guard.rows[0], planManager);
    if (targetPhaseId) {
      return {
        action: 'addTask',
        phaseId: targetPhaseId,
        task,
      };
    }

    const phaseId = this.nextUniquePhaseId(existingPhaseIds, 'phase-visual-workbench-source');
    return {
      action: 'addPhase',
      phase: {
        id: phaseId,
        name: 'Visual Workbench Source Repair',
        description: 'Controller-created follow-up work for source-owned Workbench coverage that blocks screenshot review evidence.',
        order: this.nextPhaseOrder(planManager.currentPlan),
        status: 'pending',
        tasks: [task],
        planLater: false,
      },
    };
  }

  private visualWorkbenchGuardFeedbackRefs(rows: FeedbackEvidenceMatrixRow[]): NonNullable<Task['feedbackItemRefs']> {
    let refs: NonNullable<Task['feedbackItemRefs']> = [];
    for (const row of rows) {
      refs = this.attachFeedbackRefList(refs, this.feedbackRefFromMatrixRow(row));
    }
    return refs;
  }

  private formatVisualWorkbenchSourceOwnerGuidance(
    guard: VisualWorkbenchSourceContractGuard,
    plan: Plan,
  ): string {
    return guard.rows.slice(0, 8).map((row) => {
      const ownerTasks = this.visualWorkbenchSourceOwnerTasksForRow(row, plan, guard.visualEvidenceMode);
      const ownerTaskIds = ownerTasks.map((task) => task.id);
      const ownerSelectorTokens = this.visualWorkbenchSourceOwnerSelectorTokensForRow(row, ownerTasks);
      const target = row.targetType && row.targetId ? `${row.targetType}:${row.targetId}` : row.itemId;
      return ownerTaskIds.length > 0
        ? `${row.itemId} (${target}) -> exact owner selector token(s) ${ownerSelectorTokens.length > 0 ? ownerSelectorTokens.join('|') : 'none from existing task feedback refs'}; owner task id(s) ${ownerTaskIds.join('|')}`
        : `${row.itemId} (${target}) -> no non-repair original task id selector found`;
    }).join('; ');
  }

  private visualWorkbenchSourceOwnerSelectorTokensForRow(row: FeedbackEvidenceMatrixRow, ownerTasks: Task[]): string[] {
    const needles = this.feedbackMatrixRowNeedles(row);
    return Array.from(new Set(ownerTasks.flatMap((task) => (
      (task.feedbackItemRefs ?? [])
        .filter((ref) => this.feedbackRefMatchesNeedles(ref, needles))
        .flatMap((ref) => [ref.itemId, ref.diffItemId, ref.targetId]
          .filter((value): value is string => !!value && value.trim().length > 0)
          .map((selector) => `${task.id}#${selector}`))
    ))));
  }

  private visualWorkbenchSourceOwnerTasksForRow(
    row: FeedbackEvidenceMatrixRow,
    plan: Plan,
    visualEvidenceMode: VisualEvidenceMode,
  ): Task[] {
    const tasks = this.tasksForMatrixRow(plan, row)
      .filter((task) => !this.taskRepairsVisualWorkbenchSourceContract(task))
      .filter((task) => this.taskRequiresVisualWorkbenchSourceContract(task, visualEvidenceMode));
    const seenTaskIds = new Set<string>();
    return tasks.filter((task) => {
      if (seenTaskIds.has(task.id)) return false;
      seenTaskIds.add(task.id);
      return true;
    });
  }

  private feedbackRefMatchesNeedles(
    ref: NonNullable<Task['feedbackItemRefs']>[number],
    needles: string[],
  ): boolean {
    return needles.includes(ref.itemId.toLowerCase())
      || (!!ref.diffItemId && needles.includes(ref.diffItemId.toLowerCase()))
      || (!!ref.targetId && needles.includes(ref.targetId.toLowerCase()));
  }

  private hasVisualWorkbenchSourceContractTask(plan: Plan, rows: FeedbackEvidenceMatrixRow[]): boolean {
    return plan.phases.some((phase) => phase.tasks.some((task) => (
      task.status !== 'skipped'
      && this.taskRepairsVisualWorkbenchSourceContract(task)
      && this.taskReferencesAnyFeedbackMatrixRow(task, rows)
    )));
  }

  private planChangeRepairsVisualWorkbenchSourceContract(
    change: PlanChange,
    rows: FeedbackEvidenceMatrixRow[],
    plan: Plan,
  ): boolean {
    switch (change.action) {
      case 'addTask':
        return this.taskRepairsVisualWorkbenchSourceContract(change.task)
          && this.taskReferencesAnyFeedbackMatrixRow(change.task, rows);
      case 'addPhase':
        return change.phase.tasks.some((task) => (
          this.taskRepairsVisualWorkbenchSourceContract(task)
          && this.taskReferencesAnyFeedbackMatrixRow(task, rows)
        ));
      case 'updateTask': {
        const task = this.findTaskById(plan, change.taskId);
        return task !== null
          && this.taskUpdateRepairsVisualWorkbenchSourceContract(change.changes)
          && this.taskReferencesAnyFeedbackMatrixRow(task, rows);
      }
      case 'removeTask':
      case 'reorderTasks':
        return false;
    }
  }

  private findTaskById(plan: Plan, taskId: string): Task | null {
    for (const phase of plan.phases) {
      const task = phase.tasks.find((candidate) => candidate.id === taskId);
      if (task) return task;
    }
    return null;
  }

  private taskRepairsVisualWorkbenchSourceContract(
    task: Pick<Task, 'displayTitle' | 'description' | 'acceptanceCriteria'>,
  ): boolean {
    return this.textRepairsVisualWorkbenchSourceContract([
      task.displayTitle,
      task.description,
      ...task.acceptanceCriteria,
    ]);
  }

  private taskUpdateRepairsVisualWorkbenchSourceContract(
    changes: { displayTitle?: string; description?: string; acceptanceCriteria?: string[] },
  ): boolean {
    return this.textRepairsVisualWorkbenchSourceContract([
      changes.displayTitle,
      changes.description,
      ...(changes.acceptanceCriteria ?? []),
    ]);
  }

  private textRepairsVisualWorkbenchSourceContract(parts: Array<string | undefined>): boolean {
    const text = [
      ...parts,
    ].filter(Boolean).join('\n').toLowerCase();
    const mentionsWorkbench = text.includes('visual workbench')
      || text.includes('visual-workbench')
      || text.includes('visual-workbench/manifest.json')
      || text.includes('visual-workbench/stories');
    if (!mentionsWorkbench) return false;

    return [
      'repair visual workbench coverage',
      'repair source-owned visual workbench coverage',
      'visual workbench source repair',
      'source coverage repair',
      'fix the source-owned workbench manifest/stories',
      'current blocker(s):',
      'manifest issue details',
      'selector issue details',
      'taskrelevance.defaultfor',
      'selector_readiness_blocked',
      'story_matches_multiple_tasks',
      'no_story_selection',
      'no_export_selection',
      'duplicate_export_selection',
      'ra-355.visual-coverage-manifest.v0',
    ].some((marker) => text.includes(marker));
  }

  private formatVisualWorkbenchIssueDetails(details: VisualWorkbenchManifestIssueDetail[]): string {
    if (details.length === 0) return '';
    return details.slice(0, 8).map((detail) => {
      const story = detail.storyId ? `story ${detail.storyId}` : detail.path.join('.');
      const field = detail.field ? ` field ${detail.field}` : '';
      return `${story}${field}: ${detail.message}`;
    }).join('; ');
  }

  private formatVisualWorkbenchSelectorIssues(
    issues: VisualWorkbenchSourceContractSelectorIssue[],
  ): string {
    if (issues.length === 0) return '';
    return issues.slice(0, 8).map((issue) => {
      const selectors = issue.selectorIdentities.length > 0
        ? ` selectors=${issue.selectorIdentities.join('|')}`
        : '';
      const selectedStories = issue.selectedStories.length > 0
        ? ` selectedStories=${issue.selectedStories.join('|')}`
        : '';
      const selectedViewports = issue.selectedViewports.length > 0
        ? ` selectedViewports=${issue.selectedViewports.join('|')}`
        : '';
      const ambiguities = this.formatVisualWorkbenchSelectorAmbiguities(issue.ambiguities);
      return `task ${issue.taskId}: blockers=${issue.blockers.join('|')}${selectors}${selectedStories}${selectedViewports}${ambiguities}`;
    }).join('; ');
  }

  private formatVisualWorkbenchSelectorAmbiguities(
    ambiguities: VisualWorkbenchSelectorReadinessAmbiguity[],
  ): string {
    if (ambiguities.length === 0) return '';
    const formatted = ambiguities.slice(0, 4).map((ambiguity) => {
      const matches = ambiguity.matchedSelectorsByTask.slice(0, 6).map((match) => (
        `${match.taskId}[${match.matchedSelectors.length > 0 ? match.matchedSelectors.join('|') : 'no_selectors'}]`
      )).join(',');
      return `${ambiguity.storyId}->${ambiguity.matchedTaskIds.join('|')}(${matches})`;
    }).join(',');
    return ` ambiguities=${formatted}`;
  }

  private isFeedbackWorkBlockingRow(row: FeedbackEvidenceMatrixRow): boolean {
    return row.status === 'needs_disposition'
      || row.status === 'open_task'
      || (this.isHardAcceptedDiffRow(row) && row.status === 'needs_judgment');
  }

  private isHardAcceptedDiffRow(row: Pick<FeedbackEvidenceMatrixRow, 'targetType'>): boolean {
    return !!row.targetType && row.targetType !== 'feedback';
  }

  private hasCompletedControllerFollowupForRow(plan: Plan, row: FeedbackEvidenceMatrixRow): boolean {
    if (row.status !== 'implemented_unverified' || !this.isHardAcceptedDiffRow(row)) return false;
    const needles = this.feedbackMatrixRowNeedles(row);
    if (needles.length === 0) return false;

    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (
          task.addedBy === 'controller'
          && task.status === 'completed'
          && this.taskReferencesFeedbackNeedles(task, needles)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private buildFeedbackGuardPlanChanges(
    blockingRows: FeedbackEvidenceMatrixRow[],
    planManager: PlanManager,
    existingChanges: PlanChange[],
  ): PlanChange[] {
    const changes: PlanChange[] = [];
    const existingTaskIds = new Set<string>();
    const existingPhaseIds = new Set<string>();
    for (const phase of planManager.currentPlan.phases) {
      existingPhaseIds.add(phase.id);
      for (const task of phase.tasks) existingTaskIds.add(task.id);
    }
    for (const change of existingChanges) {
      if (change.action === 'addTask') existingTaskIds.add(change.task.id);
      if (change.action === 'addPhase') {
        existingPhaseIds.add(change.phase.id);
        for (const task of change.phase.tasks) existingTaskIds.add(task.id);
      }
    }

    let nextTaskNumber = this.nextTaskNumber(planManager.currentPlan, existingChanges);
    const needsFollowup = blockingRows.filter((row) => (
      row.status === 'needs_disposition'
      || row.status === 'needs_judgment'
      || (this.isHardAcceptedDiffRow(row) && row.status === 'implemented_unverified')
    ) && !this.planChangesCoverFeedbackRow(existingChanges, row));

    for (const row of needsFollowup) {
      const targetPhaseId = this.findFeedbackGuardPhaseId(row, planManager);
      const taskId = this.nextUniqueTaskId(existingTaskIds, nextTaskNumber++);
      const itemLabel = row.targetType && row.targetId
        ? `${row.itemId} (${row.targetType}:${row.targetId})`
        : row.itemId;
      const displayTitle = this.buildFeedbackGuardTaskDisplayTitle(row);
      const description = this.buildFeedbackGuardTaskDescription(row, itemLabel);
      const acceptanceCriteria = this.buildFeedbackGuardTaskAcceptanceCriteria(row, itemLabel);
      const task: Task = {
        id: taskId,
        displayTitle,
        description,
        acceptanceCriteria,
        status: 'pending',
        attempts: 0,
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        addedBy: 'controller',
        feedbackItemRefs: [this.feedbackRefFromMatrixRow(row)],
      };

      if (targetPhaseId) {
        changes.push({
          action: 'addTask',
          phaseId: targetPhaseId,
          task,
        });
      } else {
        const phaseId = this.nextUniquePhaseId(existingPhaseIds, 'phase-feedback');
        changes.push({
          action: 'addPhase',
          phase: {
            id: phaseId,
            name: 'Accepted Diff Follow-up',
            description: 'Controller-created follow-up work for current accepted diff items that lack open work or closure evidence.',
            order: this.nextPhaseOrder(planManager.currentPlan),
            status: 'pending',
            tasks: [task],
            planLater: false,
          },
        });
      }
    }

    return changes;
  }

  private suppressImplementedUnverifiedFeedbackPlanChanges(
    changes: PlanChange[],
    suppressibleRows: FeedbackEvidenceMatrixRow[],
    allRows: FeedbackEvidenceMatrixRow[],
  ): { planChanges: PlanChange[]; suppressedCount: number } {
    if (changes.length === 0 || suppressibleRows.length === 0) {
      return { planChanges: changes, suppressedCount: 0 };
    }

    const suppressibleKeys = new Set(suppressibleRows.map((row) => this.feedbackMatrixRowKey(row)));
    const allowedRows = allRows.filter((row) => !suppressibleKeys.has(this.feedbackMatrixRowKey(row)));
    const filteredChanges: PlanChange[] = [];
    let suppressedCount = 0;

    for (const change of changes) {
      if (change.action === 'addTask') {
        if (this.shouldSuppressImplementedUnverifiedFeedbackTask(change.task, suppressibleRows, allowedRows)) {
          suppressedCount++;
          continue;
        }
        filteredChanges.push(change);
        continue;
      }

      if (change.action === 'addPhase') {
        const tasks = change.phase.tasks.filter((task) => {
          if (this.shouldSuppressImplementedUnverifiedFeedbackTask(task, suppressibleRows, allowedRows)) {
            suppressedCount++;
            return false;
          }
          return true;
        });
        if (tasks.length === 0) continue;
        filteredChanges.push({
          ...change,
          phase: {
            ...change.phase,
            tasks,
          },
        });
        continue;
      }

      filteredChanges.push(change);
    }

    return { planChanges: filteredChanges, suppressedCount };
  }

  private suppressImplementedUnverifiedHardProofPlanChanges(
    changes: PlanChange[],
    suppressibleRows: FeedbackEvidenceMatrixRow[],
    allRows: FeedbackEvidenceMatrixRow[],
  ): { planChanges: PlanChange[]; suppressedCount: number } {
    if (changes.length === 0 || suppressibleRows.length === 0) {
      return { planChanges: changes, suppressedCount: 0 };
    }

    const suppressibleKeys = new Set(suppressibleRows.map((row) => this.feedbackMatrixRowKey(row)));
    const allowedRows = allRows.filter((row) => !suppressibleKeys.has(this.feedbackMatrixRowKey(row)));
    const filteredChanges: PlanChange[] = [];
    let suppressedCount = 0;

    for (const change of changes) {
      if (change.action === 'addTask') {
        if (this.shouldSuppressImplementedUnverifiedHardProofTask(change.task, suppressibleRows, allowedRows)) {
          suppressedCount++;
          continue;
        }
        filteredChanges.push(change);
        continue;
      }

      if (change.action === 'addPhase') {
        const tasks = change.phase.tasks.filter((task) => {
          if (this.shouldSuppressImplementedUnverifiedHardProofTask(task, suppressibleRows, allowedRows)) {
            suppressedCount++;
            return false;
          }
          return true;
        });
        if (tasks.length === 0) continue;
        filteredChanges.push({
          ...change,
          phase: {
            ...change.phase,
            tasks,
          },
        });
        continue;
      }

      filteredChanges.push(change);
    }

    return { planChanges: filteredChanges, suppressedCount };
  }

  private shouldSuppressImplementedUnverifiedFeedbackTask(
    task: Task,
    suppressibleRows: FeedbackEvidenceMatrixRow[],
    allowedRows: FeedbackEvidenceMatrixRow[],
  ): boolean {
    return this.taskReferencesAnyFeedbackMatrixRow(task, suppressibleRows)
      && !this.taskReferencesAnyFeedbackMatrixRow(task, allowedRows);
  }

  private shouldSuppressImplementedUnverifiedHardProofTask(
    task: Task,
    suppressibleRows: FeedbackEvidenceMatrixRow[],
    allowedRows: FeedbackEvidenceMatrixRow[],
  ): boolean {
    return this.taskReferencesAnyFeedbackMatrixRow(task, suppressibleRows)
      && !this.taskReferencesAnyFeedbackMatrixRow(task, allowedRows)
      && this.isGenericImplementedUnverifiedProofTask(task);
  }

  private isGenericImplementedUnverifiedProofTask(
    task: Pick<Task, 'displayTitle' | 'description' | 'acceptanceCriteria'>,
  ): boolean {
    const title = compactText(task.displayTitle, 120)?.toLowerCase();
    const oldGuardTitle = title === 'verify accepted changes'
      || title === 'verify accepted asset'
      || title === 'verify accepted decision'
      || title === 'verify secret setup';
    const text = compactText([
      task.description,
      ...task.acceptanceCriteria,
    ].filter(Boolean).join('\n'), 4000)?.toLowerCase() ?? '';
    const oldGuardBody = text.includes('verify completed accepted diff work')
      || text.includes('concrete product-facing proof is recorded')
      || text.includes('closure evidence is product-facing proof')
      || text.includes('no broad reimplementation is done; only concrete closure evidence is recorded');

    return oldGuardTitle && oldGuardBody;
  }

  private taskReferencesAnyFeedbackMatrixRow(task: Task, rows: FeedbackEvidenceMatrixRow[]): boolean {
    return rows.some((row) => this.taskReferencesFeedbackNeedles(task, this.feedbackMatrixRowNeedles(row)));
  }

  private feedbackMatrixRowNeedles(row: FeedbackEvidenceMatrixRow): string[] {
    return [row.itemId, row.diffItemId, row.targetId]
      .filter((value): value is string => !!value)
      .map((value) => value.toLowerCase());
  }

  private feedbackMatrixRowKey(row: FeedbackEvidenceMatrixRow): string {
    return [row.itemId, row.diffItemId ?? '', row.targetType ?? '', row.targetId ?? ''].join('\0');
  }

  private isFeedbackItemMatrixRow(row: FeedbackEvidenceMatrixRow): boolean {
    return row.targetType === undefined || row.targetType === 'feedback';
  }

  private buildFeedbackGuardTaskDisplayTitle(row: FeedbackEvidenceMatrixRow): string {
    if (row.status === 'implemented_unverified') {
      if (row.targetType === 'feedback' && row.targetId) return `Verify ${row.targetId}`;
      if (row.targetType === 'asset') return 'Verify accepted asset';
      if (row.targetType === 'assumption') return 'Verify accepted decision';
      if (row.targetType === 'secret_requirement') return 'Verify secret setup';
      return 'Verify accepted changes';
    }

    if (row.targetType === 'feedback' && row.targetId) return `Address ${row.targetId}`;
    if (row.targetType === 'asset') return 'Address accepted asset';
    if (row.targetType === 'assumption') return 'Address accepted decision';
    if (row.targetType === 'secret_requirement') return 'Address secret setup';
    return 'Address accepted changes';
  }

  private buildFeedbackGuardTaskDescription(row: FeedbackEvidenceMatrixRow, itemLabel: string): string {
    if (row.status === 'implemented_unverified') {
      const base = `Verify completed accepted diff work ${itemLabel}: ${row.operatorSummary}.`;
      const guidance = 'Do not reimplement the accepted diff from scratch. Inspect the current product behavior against the accepted spec artifact; if it is already correct, record concrete closure evidence, and if it is still wrong, make only the targeted product fix needed to satisfy the accepted diff.';
      if ((row.sourceEvidence ?? []).length === 0) return [base, guidance].join(' ');

      return [
        base,
        guidance,
        'The accepted diff includes sourceEvidence; closure evidence must name the visible product outcome tied to the same feedback item.',
      ].join(' ');
    }

    const base = `Implement required accepted diff work ${itemLabel}: ${row.operatorSummary}.`;
    if ((row.sourceEvidence ?? []).length === 0) return base;

    return [
      base,
      'The accepted diff includes sourceEvidence; implement the visible product outcome and record closure evidence tied to the same feedback item.',
    ].join(' ');
  }

  private buildFeedbackGuardTaskAcceptanceCriteria(
    row: FeedbackEvidenceMatrixRow,
    itemLabel: string,
  ): string[] {
    const criteria = row.status === 'implemented_unverified'
      ? [
        `${itemLabel} is verified against the current accepted spec artifact, not only historical completed task status or judgment.`,
        'If the current product already satisfies the accepted diff, no broad reimplementation is done; only concrete closure evidence is recorded.',
        'If the current product still violates the accepted diff, only the smallest targeted product fix is made before evidence is recorded.',
      ]
      : [
        `${itemLabel} is handled against the current accepted spec artifact, not only historical completed task status or judgment.`,
        'Product code, tests, or documented product behavior directly address the accepted diff item.',
      ];

    if ((row.sourceEvidence ?? []).length > 0) {
      criteria.push(
        'Closure evidence is product-facing proof tied to this feedback item and its sourceEvidence: before/after screenshot proof, current-state after_only screenshot proof, or vision QA with concrete route, viewport, and claim, or an explicit manual visual proof naming the exact visible state checked.',
        'Generic unit, integration, build, typecheck, or broad responsive test evidence can support the implementation but does not close this frontend sourceEvidence item by itself.',
      );
    } else {
      criteria.push('Relevant product-level tests or manual checks for this accepted diff item have been run when the project supports them.');
    }

    criteria.push('If the item cannot be implemented in product code, the real blocker is documented for the final controller audit.');
    return criteria;
  }

  private attachFeedbackRefsToCoveringPlanChanges(
    changes: PlanChange[],
    rows: FeedbackEvidenceMatrixRow[],
  ): PlanChange[] {
    if (changes.length === 0 || rows.length === 0) return changes;

    return changes.map((change) => {
      if (change.action === 'addTask') {
        return {
          ...change,
          task: this.attachFeedbackRefsToCoveringTask(change.task, rows),
        };
      }
      if (change.action === 'addPhase') {
        return {
          ...change,
          phase: {
            ...change.phase,
            tasks: change.phase.tasks.map((task) => this.attachFeedbackRefsToCoveringTask(task, rows)),
          },
        };
      }
      return change;
    });
  }

  private attachFeedbackRefsToSingleControllerFollowup(
    changes: PlanChange[],
    rows: FeedbackEvidenceMatrixRow[],
  ): PlanChange[] {
    if (changes.length === 0 || rows.length === 0) return changes;

    const locations = changes.flatMap((change, changeIndex) => {
      if (change.action === 'addTask') {
        return [{ changeIndex, taskIndex: null as number | null, task: change.task }];
      }
      if (change.action === 'addPhase') {
        return change.phase.tasks.map((task, taskIndex) => ({ changeIndex, taskIndex, task }));
      }
      return [];
    });

    if (locations.length !== 1) return changes;

    const refs = rows.map((row) => this.feedbackRefFromMatrixRow(row));
    const attach = (task: Task): Task => {
      let nextTask = task;
      for (const ref of refs) {
        nextTask = this.attachFeedbackRefToTask(nextTask, ref);
      }
      return nextTask;
    };
    const location = locations[0];

    return changes.map((change, changeIndex) => {
      if (changeIndex !== location.changeIndex) return change;
      if (change.action === 'addTask') {
        return {
          ...change,
          task: attach(change.task),
        };
      }
      if (change.action === 'addPhase' && location.taskIndex !== null) {
        return {
          ...change,
          phase: {
            ...change.phase,
            tasks: change.phase.tasks.map((task, taskIndex) => (
              taskIndex === location.taskIndex ? attach(task) : task
            )),
          },
        };
      }
      return change;
    });
  }

  private attachFeedbackRefsToCoveringTask(task: Task, rows: FeedbackEvidenceMatrixRow[]): Task {
    const refs = [...(task.feedbackItemRefs ?? [])];
    let changed = false;

    for (const row of rows) {
      const needles = [row.itemId, row.diffItemId, row.targetId]
        .filter((value): value is string => !!value)
        .map((value) => value.toLowerCase());
      if (needles.length === 0 || !this.taskReferencesFeedbackNeedles({ ...task, feedbackItemRefs: refs }, needles)) {
        continue;
      }

      const nextRef = this.feedbackRefFromMatrixRow(row);
      refs.splice(0, refs.length, ...this.attachFeedbackRefList(refs, nextRef));
      changed = true;
    }

    return changed ? { ...task, feedbackItemRefs: refs } : task;
  }

  private attachFeedbackRefToTask(
    task: Task,
    nextRef: NonNullable<Task['feedbackItemRefs']>[number],
  ): Task {
    const refs = this.attachFeedbackRefList(task.feedbackItemRefs ?? [], nextRef);
    return refs === task.feedbackItemRefs ? task : { ...task, feedbackItemRefs: refs };
  }

  private attachFeedbackRefList(
    refs: NonNullable<Task['feedbackItemRefs']>,
    nextRef: NonNullable<Task['feedbackItemRefs']>[number],
  ): NonNullable<Task['feedbackItemRefs']> {
    const existingIndex = refs.findIndex((ref) => (
      ref.itemId === nextRef.itemId
      || (!!nextRef.diffItemId && ref.diffItemId === nextRef.diffItemId)
      || (!!nextRef.targetId && ref.targetId === nextRef.targetId)
    ));

    if (existingIndex >= 0) {
      const nextRefs = [...refs];
      nextRefs[existingIndex] = {
        ...nextRefs[existingIndex],
        ...nextRef,
      };
      return nextRefs;
    }

    return [...refs, nextRef];
  }

  private feedbackRefFromMatrixRow(row: FeedbackEvidenceMatrixRow): NonNullable<Task['feedbackItemRefs']>[number] {
    return {
      itemId: row.itemId,
      ...(row.diffItemId ? { diffItemId: row.diffItemId } : {}),
      ...(row.targetType ? { targetType: row.targetType } : {}),
      ...(row.targetId ? { targetId: row.targetId } : {}),
      ...(row.changeType ? { changeType: row.changeType } : {}),
      ...(row.workImpact ? { workImpact: row.workImpact } : {}),
      ...(row.workSurface ? { workSurface: row.workSurface } : {}),
      ...(row.feedbackStatus !== undefined ? { status: row.feedbackStatus } : {}),
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.sourceRefs?.length ? { sourceRefs: row.sourceRefs } : {}),
      ...(row.sourceEvidence?.length ? { sourceEvidence: row.sourceEvidence } : {}),
      ...(row.specFile ? { specFile: row.specFile } : {}),
      ...(row.specHash ? { specHash: row.specHash } : {}),
      ...(row.migrationId ? { migrationId: row.migrationId } : {}),
      ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
    };
  }

  private planChangesCoverFeedbackRow(changes: PlanChange[], row: FeedbackEvidenceMatrixRow): boolean {
    return this.planChangesCoverFeedbackNeedles(changes, [row.itemId, row.diffItemId, row.targetId]);
  }

  private planChangesCoverFeedbackNeedles(changes: PlanChange[], values: Array<string | undefined>): boolean {
    const needles = values.filter((value): value is string => !!value).map((value) => value.toLowerCase());
    if (needles.length === 0) return false;
    for (const change of changes) {
      if (change.action === 'addTask' && this.taskReferencesFeedbackNeedles(change.task, needles)) {
        return true;
      }
      if (change.action === 'addPhase' && change.phase.tasks.some((task) => this.taskReferencesFeedbackNeedles(task, needles))) {
        return true;
      }
      if (change.action === 'updateTask' && this.taskUpdateReferencesFeedbackNeedles(change.changes, needles)) {
        return true;
      }
    }
    return false;
  }

  private taskReferencesFeedbackNeedles(task: Task, needles: string[]): boolean {
    if ((task.feedbackItemRefs ?? []).some((ref) => (
      needles.includes(ref.itemId.toLowerCase())
      || (!!ref.diffItemId && needles.includes(ref.diffItemId.toLowerCase()))
      || (!!ref.targetId && needles.includes(ref.targetId.toLowerCase()))
    ))) return true;
    return this.taskTextIncludesFeedbackNeedles(task.description, task.acceptanceCriteria, needles);
  }

  private taskUpdateReferencesFeedbackNeedles(
    changes: { displayTitle?: string; description?: string; acceptanceCriteria?: string[] },
    needles: string[],
  ): boolean {
    return this.taskTextIncludesFeedbackNeedles(
      [changes.displayTitle, changes.description].filter(Boolean).join('\n'),
      changes.acceptanceCriteria ?? [],
      needles,
    );
  }

  private taskTextIncludesFeedbackNeedles(description: string, acceptanceCriteria: string[], needles: string[]): boolean {
    const text = [description, ...acceptanceCriteria].join('\n').toLowerCase();
    return needles.some((needle) => text.includes(needle));
  }

  private findFeedbackGuardPhaseId(row: FeedbackEvidenceMatrixRow, planManager: PlanManager): string | null {
    for (const taskId of row.linkedTaskIds ?? []) {
      const phase = planManager.findTaskPhase(taskId);
      if (phase) return phase.id;
    }
    const currentPhase = planManager.getCurrentPhase();
    if (currentPhase) return currentPhase.id;
    const phases = [...planManager.currentPlan.phases].sort((a, b) => a.order - b.order);
    return phases.at(-1)?.id ?? null;
  }

  private nextTaskNumber(plan: Plan, existingChanges: PlanChange[]): number {
    let max = 0;
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        const match = task.id.match(/^task-(\d+)$/);
        if (match) max = Math.max(max, Number.parseInt(match[1], 10));
      }
    }
    for (const change of existingChanges) {
      const tasks = change.action === 'addTask'
        ? [change.task]
        : change.action === 'addPhase'
          ? change.phase.tasks
          : [];
      for (const task of tasks) {
        const match = task.id.match(/^task-(\d+)$/);
        if (match) max = Math.max(max, Number.parseInt(match[1], 10));
      }
    }
    return max + 1;
  }

  private nextUniqueTaskId(existingTaskIds: Set<string>, preferredNumber: number): string {
    let nextNumber = preferredNumber;
    let taskId = `task-${String(nextNumber).padStart(3, '0')}`;
    while (existingTaskIds.has(taskId)) {
      nextNumber++;
      taskId = `task-${String(nextNumber).padStart(3, '0')}`;
    }
    existingTaskIds.add(taskId);
    return taskId;
  }

  private nextUniquePhaseId(existingPhaseIds: Set<string>, baseId: string): string {
    let phaseId = baseId;
    let suffix = 2;
    while (existingPhaseIds.has(phaseId)) {
      phaseId = `${baseId}-${suffix++}`;
    }
    existingPhaseIds.add(phaseId);
    return phaseId;
  }

  private nextPhaseOrder(plan: Plan): number {
    const orders = plan.phases.map((phase) => phase.order);
    return orders.length > 0 ? Math.max(...orders) + 1 : 1;
  }

  private isLoopTerminalResultPlanChange(change: PlanChange): boolean {
    switch (change.action) {
      case 'addTask':
        return this.isLoopTerminalResultTask(change.task);
      case 'updateTask':
        return this.isLoopTerminalResultText([
          change.changes.description,
          ...(change.changes.acceptanceCriteria ?? []),
        ]);
      case 'addPhase':
        return change.phase.tasks.length > 0
          && change.phase.tasks.every(task => this.isLoopTerminalResultTask(task));
      case 'removeTask':
      case 'reorderTasks':
        return false;
    }
  }

  private isLoopTerminalResultTask(task: Task): boolean {
    return this.isLoopTerminalResultText([
      task.description,
      ...task.acceptanceCriteria,
    ]);
  }

  private isLoopTerminalResultText(parts: Array<string | undefined>): boolean {
    const text = parts.filter(Boolean).join('\n').toLowerCase();
    if (!text) return false;

    const mentionsResultJson = text.includes('.arena/result.json')
      || (text.includes('result.json') && (
        text.includes('arena')
        || text.includes('deployment signal')
        || text.includes('lifecycle signal')
        || text.includes('platform contract')
        || text.includes('"status":"deployed"')
        || text.includes('"status": "deployed"')
      ));

    if (!mentionsResultJson) return false;

    return text.includes('deployed')
      || text.includes('deployment signal')
      || text.includes('lifecycle signal')
      || text.includes('platform contract')
      || text.includes('terminal signal');
  }

  private describePlanChange(change: PlanChange): string {
    switch (change.action) {
      case 'addTask':
        return `addTask:${change.task.id}`;
      case 'updateTask':
        return `updateTask:${change.taskId}`;
      case 'addPhase':
        return `addPhase:${change.phase.id}`;
      case 'removeTask':
        return `removeTask:${change.taskId}`;
      case 'reorderTasks':
        return `reorderTasks:${change.phaseId}`;
    }
  }

  // ── E2E applicability ────────────────────────────────────────

  /**
   * Check if e2e enforcement is currently enabled.
   * Uses explicit config override, or the controller's prior LLM decision saved in the plan.
   */
  private isE2EEnabled(options: Pick<ControllerOptions, 'ralphConfig' | 'planManager'>): boolean {
    const configValue = options.ralphConfig.e2eEnforcer?.enabled;
    // Explicit override in config
    if (configValue === true || configValue === false) return configValue;
    // Controller's prior decision (saved in plan)
    return options.planManager.currentPlan.e2eApplicable ?? false;
  }

  /**
   * Resolve whether e2e tests should be enabled for this project.
   * - If config has explicit true/false → use it.
   * - If plan already has a saved decision → use it.
   * - Otherwise → ask the LLM once, save the decision to the plan.
   */
  private async resolveE2EEnabled(options: ControllerOptions): Promise<boolean> {
    const { planManager, agent } = options;
    const configValue = options.ralphConfig.e2eEnforcer?.enabled;

    // Explicit config override
    if (configValue === true) { log.info('Controller: E2E enforcer enabled by config'); return true; }
    if (configValue === false) { log.info('Controller: E2E enforcer disabled by config'); return false; }

    // Already decided in a prior run
    const plan = planManager.currentPlan;
    if (plan.e2eApplicable !== undefined && plan.e2eApplicable !== null) {
      log.info(`Controller: E2E enforcer ${plan.e2eApplicable ? 'enabled' : 'disabled'} (prior decision)`);
      return plan.e2eApplicable;
    }

    if (configValue === undefined) {
      plan.e2eApplicable = false;
      await planManager.save();
      log.info('Controller: E2E enforcer disabled by default policy');
      return false;
    }

    // Explicit null keeps the legacy/experimental auto-decision mode.
    log.info('Controller: asking LLM whether Playwright e2e tests are applicable for this project...');

    const specContent = await fs.readFile(options.specPath, 'utf-8');

    let pkgJson = '';
    const pkgPath = path.join(options.workDir, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      pkgJson = await fs.readFile(pkgPath, 'utf-8');
    }

    const prompt = renderE2EApplicabilityPrompt(specContent, pkgJson);

    try {
      const result = await agent.execute({
        workDir: options.workDir,
        prompt,
        allowedTools: [],
        model: options.model,
        timeout: 1,
        verbose: false,
      });

      const output = extractTextFromStreamJson(result.output);
      const match = output.match(/\{[\s\S]*?"e2eApplicable"\s*:\s*(true|false)[\s\S]*?\}/);
      await this.recordPromptTrace(options.workDir, {
        promptId: 'controller.e2eApplicability',
        label: 'E2E applicability decision',
        prompt,
        result: { ...result, output },
        model: options.model,
        context: {
          packageJsonPresent: pkgJson.length > 0,
          specCharCount: specContent.length,
        },
      });
      if (match) {
        const applicable = match[1] === 'true';
        plan.e2eApplicable = applicable;
        await planManager.save();
        log.info(`Controller: LLM decided e2e tests are ${applicable ? 'applicable' : 'not applicable'} for this project`);
        return applicable;
      }

      log.warn('Controller: could not parse LLM e2e decision, defaulting to disabled');
    } catch (err: any) {
      await this.recordPromptTrace(options.workDir, {
        promptId: 'controller.e2eApplicability',
        label: 'E2E applicability decision',
        prompt,
        result: { success: false, output: err.message },
        model: options.model,
        context: {
          packageJsonPresent: pkgJson.length > 0,
          specCharCount: specContent.length,
        },
      });
      log.warn(`Controller: e2e applicability check failed: ${err.message}, defaulting to disabled`);
    }

    // Conservative default: don't generate e2e tasks if we can't decide
    plan.e2eApplicable = false;
    await planManager.save();
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async gatherProjectSnapshot(workDir: string): Promise<string> {
    const sections: string[] = [];

    // File tree (limited depth)
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa('find', ['.', '-maxdepth', '3', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*', '-not', '-path', '*/.next/*'], {
        cwd: workDir,
      });
      sections.push(`### File tree\n\`\`\`\n${stdout}\n\`\`\``);
    } catch {
      sections.push('### File tree\n(could not list files)');
    }

    // Key files
    const keyFiles = ['package.json', 'Dockerfile', 'prisma/schema.prisma'];
    for (const file of keyFiles) {
      const filePath = path.join(workDir, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        sections.push(`### ${file}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
      }
    }

    // Git log
    try {
      const { execa } = await import('execa');
      const { stdout } = await execa('git', ['log', '--oneline', '-15'], { cwd: workDir });
      sections.push(`### Git log (last 15)\n\`\`\`\n${stdout}\n\`\`\``);
    } catch {
      // no git
    }

    return sections.join('\n\n');
  }

  private parseAgentReport(rawOutput: string, trigger: ControllerTrigger): ControllerReport {
    return parseControllerAgentReport(rawOutput, {
      trigger,
      reportId: this.nextReportId(),
      timestamp: new Date().toISOString(),
      onWarning: (message) => log.warn(message),
    }).report;
  }

  private parseDryRunAgentReport(rawOutput: string, trigger: ControllerTrigger): ControllerReport {
    const parsed = parseControllerAgentReport(rawOutput, {
      trigger,
      reportId: this.nextReportId(),
      timestamp: new Date().toISOString(),
      onWarning: (message) => log.warn(message),
    });
    this.assertNoDryRunSilentNormalization(parsed.rawReport);
    return parsed.report;
  }

  private assertNoDryRunSilentNormalization(rawReport: Record<string, unknown>): void {
    if (rawReport.verdict !== 'continue' && rawReport.verdict !== 'revise' && rawReport.verdict !== 'escalate') {
      throw new Error(`Controller dry-run rejected invalid verdict: ${String(rawReport.verdict)}`);
    }
    if (typeof rawReport.summary !== 'string' || rawReport.summary.trim().length === 0) {
      throw new Error('Controller dry-run rejected missing or empty string summary.');
    }

    this.assertDryRunRequiredArrayField(rawReport, 'planChanges');
    this.assertDryRunRequiredArrayField(rawReport, 'newJudgments');
    this.assertDryRunRequiredArrayField(rawReport, 'revisedJudgments');

    const planChanges = rawReport.planChanges;
    if (Array.isArray(planChanges)) {
      planChanges.forEach((change, index) => {
        const parsed = PlanChangeSchema.safeParse(change);
        if (!parsed.success) {
          throw new Error(`Controller dry-run rejected invalid planChanges[${index}]: ${parsed.error.message}`);
        }
      });
    }

    const newJudgments = rawReport.newJudgments;
    if (Array.isArray(newJudgments)) {
      newJudgments.forEach((judgment, index) => {
        const parsed = JudgmentSchema.safeParse(judgment);
        if (!parsed.success) {
          throw new Error(`Controller dry-run rejected invalid newJudgments[${index}]: ${parsed.error.message}`);
        }
      });
    }

    const revisedJudgments = rawReport.revisedJudgments;
    if (Array.isArray(revisedJudgments)) {
      revisedJudgments.forEach((revision, index) => {
        const parsed = RevisedJudgmentSchema.safeParse(revision);
        if (!parsed.success) {
          throw new Error(`Controller dry-run rejected invalid revisedJudgments[${index}]: ${parsed.error.message}`);
        }
      });
    }

    const overclaimWarnings = rawReport.overclaimWarnings;
    if (overclaimWarnings !== undefined) {
      if (!Array.isArray(overclaimWarnings)) {
        throw new Error('Controller dry-run rejected non-array overclaimWarnings.');
      }
      overclaimWarnings.forEach((warning, index) => {
        if (typeof warning !== 'string') {
          throw new Error(`Controller dry-run rejected invalid overclaimWarnings[${index}]: expected string.`);
        }
      });
    }
  }

  private assertDryRunRequiredArrayField(rawReport: Record<string, unknown>, field: 'planChanges' | 'newJudgments' | 'revisedJudgments'): void {
    if (!Array.isArray(rawReport[field])) {
      throw new Error(`Controller dry-run rejected missing or non-array ${field}.`);
    }
  }

  private buildControllerReportRepairPrompt(
    originalPrompt: string,
    previousOutput: string,
    parseError: Error | null,
  ): string {
    const outputExcerpt = previousOutput
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    const errorText = parseError?.message || 'Controller output did not match the required JSON report contract';

    return `${originalPrompt}

---

## Previous Controller Output Was Invalid

The previous response could not be parsed as the required controller report JSON.

Parse error:
${errorText}

Previous output excerpt:
\`\`\`
${outputExcerpt}
\`\`\`

Return exactly one \`\`\`json fenced block matching the Output Format above.
Do not inspect files, do not call tools, do not explain the error, and do not include any text outside the JSON block.`;
  }

  private fallbackReport(trigger: ControllerTrigger, error: string): ControllerReport {
    return {
      id: this.nextReportId(),
      timestamp: new Date().toISOString(),
      trigger,
      verdict: 'continue',
      summary: `Controller audit failed: ${error}. Continuing with current plan.`,
      planChanges: [],
      newJudgments: [],
      revisedJudgments: [],
    };
  }

  private async saveReport(report: ControllerReport): Promise<void> {
    await fs.ensureDir(this.reportsDir);
    const filePath = path.join(this.reportsDir, `${report.id}.json`);
    await fs.writeJson(filePath, report, { spaces: 2 });
    log.info(`Controller report saved → ${filePath}`);
  }

  private nextReportId(): string {
    let maxFromDisk = 0;
    if (nodeFs.existsSync(this.reportsDir)) {
      for (const entry of nodeFs.readdirSync(this.reportsDir)) {
        const match = entry.match(/^report-(\d+)\.json$/);
        if (!match) continue;
        maxFromDisk = Math.max(maxFromDisk, Number.parseInt(match[1], 10));
      }
    }

    this.reportCount = Math.max(this.reportCount, maxFromDisk) + 1;
    return `report-${String(this.reportCount).padStart(3, '0')}`;
  }

  private async saveControllerLog(
    workDir: string,
    trigger: ControllerTrigger,
    prompt: string,
    result: { success: boolean; output: string },
  ): Promise<void> {
    try {
      const logsDir = path.join(workDir, '.ralph', 'agent-logs');
      await fs.ensureDir(logsDir);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `controller-${trigger}-${timestamp}.md`;
      
      const content = [
        `# Controller Agent Log — ${trigger}`,
        ``,
        `- **Trigger:** ${trigger}`,
        `- **Timestamp:** ${new Date().toISOString()}`,
        `- **Success:** ${result.success}`,
        ``,
        `## Prompt`,
        ``,
        '```',
        prompt,
        '```',
        ``,
        `## Agent Output`,
        ``,
        '```',
        result.output,
        '```',
        ``,
      ].join('\n');
      
      await fs.writeFile(path.join(logsDir, filename), content, 'utf-8');
    } catch {
      // Non-critical
    }
  }

  private async recordPromptTrace(
    workDir: string,
    input: {
      promptId: string;
      label: string;
      prompt: string;
      result: { success: boolean; output: string };
      model?: string;
      context?: Record<string, string | number | boolean | null | undefined>;
    },
  ): Promise<void> {
    try {
      await appendPromptModelCallTrace(workDir, {
        owner: 'controller',
        parse: this.describePromptTraceParse(input),
        ...input,
      });
    } catch {
      // Non-critical observation artifact.
    }
  }

  private describePromptTraceParse(input: {
    promptId: string;
    result: { success: boolean; output: string };
    context?: Record<string, string | number | boolean | null | undefined>;
  }): { status: 'not_recorded' | 'ok' | 'error'; summary?: string } {
    if (!input.result.success) {
      return { status: 'error', summary: 'agent call failed' };
    }

    try {
      if (input.promptId === 'controller.e2eApplicability') {
        const match = input.result.output.match(/\{[\s\S]*?"e2eApplicable"\s*:\s*(true|false)[\s\S]*?\}/);
        if (!match) {
          throw new Error('could not parse e2eApplicable boolean');
        }
        return { status: 'ok', summary: `e2eApplicable=${match[1]}` };
      }

      const report = this.parseAgentReport(
        input.result.output,
        this.traceControllerTrigger(input.context?.trigger),
      );
      return {
        status: 'ok',
        summary: [
          `verdict=${report.verdict}`,
          `planChanges=${report.planChanges.length}`,
          `newJudgments=${report.newJudgments.length}`,
          `revisedJudgments=${report.revisedJudgments.length}`,
          `overclaimWarnings=${report.overclaimWarnings?.length ?? 0}`,
        ].join('; '),
      };
    } catch (err: any) {
      return {
        status: 'error',
        summary: this.traceSummary(err.message),
      };
    }
  }

  private traceControllerTrigger(value: unknown): ControllerTrigger {
    return typeof value === 'string' && [
      'phase_complete',
      'periodic',
      'failure_threshold',
      'replan',
      'manual',
      'final',
      'startup',
      'spec_migration',
    ].includes(value)
      ? value as ControllerTrigger
      : 'periodic';
  }

  private traceSummary(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
}

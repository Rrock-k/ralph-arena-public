import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  exportRalphPromptRepository,
  getRalphPromptRepositoryEntries,
  PROMPT_REPOSITORY_OWNER,
  PROMPT_REPOSITORY_SCHEMA_VERSION,
  renderControllerAuditPrompt,
  renderExecutorAgentPrompt,
  renderExecutorAutonomousInstructions,
  renderExecutorErrorsSection,
  renderExecutorIterationHistory,
  renderExecutorSecretsSection,
  renderExecutorTaskSection,
  renderExecutorVerificationSection,
  renderE2EApplicabilityPrompt,
  renderPlannerInitialPrompt,
  renderPlannerReplanPrompt,
  renderPlannerSpecMigrationPrompt,
  renderQAPlannerSelectTasksPrompt,
  renderQATestRequestTaskDescription,
} from './repository.js';

const REQUIRED_PROMPT_IDS = [
  'planner.initial',
  'planner.replan',
  'planner.specMigration',
  'executor.autonomousInstructions',
  'executor.agentPrompt',
  'executor.taskSection',
  'executor.productSkill',
  'executor.uxSkill',
  'executor.activeWipReconciliation',
  'executor.secretsSection',
  'executor.communityQAContext',
  'controller.audit',
  'controller.e2eApplicability',
  'qaPlanner.selectTasks',
  'qaPlanner.writeTestRequestTask',
  'visionQA.analysis',
] as const;

const RUNTIME_TRACE_SOURCE_FILES = [
  'src/planning/planner.ts',
  'src/loop/executor.ts',
  'src/control/controller.ts',
  'src/control/qa-planner.ts',
  'src/verification/vision-qa.ts',
] as const;

const RUNTIME_MODEL_CALL_COVERAGE = [
  {
    file: 'src/planning/planner.ts',
    callPattern: /(?:agent\.execute|executeAgentWithProviderCallCheckpoint)\(/g,
    expectedCallCount: 4,
    promptIds: ['planner.initial', 'planner.replan', 'planner.specMigration'],
    reportOwnedDryRun: {
      ownerBoundary: 'PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY',
      promptId: 'planner.initial',
    },
  },
  {
    file: 'src/loop/executor-agent-call.ts',
    callPattern: /input\.agent\.execute\(/g,
    expectedCallCount: 1,
    callerFile: 'src/loop/executor.ts',
    callerPattern: /runExecutorActionCore\(/g,
    expectedCallerCount: 1,
    traceFile: 'src/loop/executor.ts',
    traceCouplingPattern: /const result = await runExecutorActionCore\([\s\S]*?await this\.saveAgentLog\(result\.promptEnvelope\.prompt, result\.agentResult\)[\s\S]*?private async saveAgentLog\(prompt: string, result: AgentResult\)[\s\S]*?appendPromptModelCallTrace[\s\S]*?promptId: 'executor\.agentPrompt'[\s\S]*?result,/,
    promptIds: ['executor.agentPrompt'],
  },
  {
    file: 'src/control/controller.ts',
    callPattern: /(?:agent\.execute|executeAgentWithProviderCallCheckpoint)\(/g,
    expectedCallCount: 3,
    promptIds: ['controller.audit', 'controller.e2eApplicability'],
    reportOwnedDryRun: {
      ownerBoundary: 'CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY',
      promptId: 'controller.audit',
    },
  },
  {
    file: 'src/control/qa-planner.ts',
    callPattern: /agent\.execute\(/g,
    expectedCallCount: 1,
    promptIds: ['qaPlanner.selectTasks'],
  },
  {
    file: 'src/verification/vision-qa.ts',
    callPattern: /client\.chat\.completions\.create\(/g,
    expectedCallCount: 1,
    promptIds: ['visionQA.analysis'],
  },
] as const;

test('exports the known Ralph prompt families', () => {
  const ids = new Set(getRalphPromptRepositoryEntries().map(entry => entry.id));

  for (const id of REQUIRED_PROMPT_IDS) {
    assert.equal(ids.has(id), true, `missing prompt repository entry: ${id}`);
  }
});

test('prompt repository entry ids are unique', () => {
  const entries = getRalphPromptRepositoryEntries();
  const ids = entries.map(entry => entry.id);

  assert.equal(new Set(ids).size, ids.length);
});

test('registered llm prompts have runtime trace prompt ids', () => {
  const llmPromptIds = getRalphPromptRepositoryEntries()
    .filter(entry => entry.kind === 'llm_prompt')
    .map(entry => entry.id)
    .sort();
  const runtimeTracePromptIds = Array.from(readRuntimeTracePromptIds()).sort();

  assert.deepEqual(runtimeTracePromptIds, llmPromptIds);
});

test('runtime model execution sites stay prompt-repository accounted', () => {
  for (const coverage of RUNTIME_MODEL_CALL_COVERAGE) {
    const source = fs.readFileSync(coverage.file, 'utf-8');
    const traceSource = 'traceFile' in coverage
      ? fs.readFileSync(coverage.traceFile, 'utf-8')
      : source;
    const callerSource = 'callerFile' in coverage
      ? fs.readFileSync(coverage.callerFile, 'utf-8')
      : null;
    assert.equal(
      countMatches(source, coverage.callPattern),
      coverage.expectedCallCount,
      `${coverage.file} model call count changed; update Prompt Repository accounting`,
    );
    if (callerSource && 'callerPattern' in coverage) {
      assert.equal(
        countMatches(callerSource, coverage.callerPattern),
        coverage.expectedCallerCount,
        `${coverage.callerFile} wrapper call count changed; update Prompt Repository accounting`,
      );
    }

    for (const promptId of coverage.promptIds) {
      assert.match(
        traceSource,
        new RegExp(`promptId: '${escapeRegExp(promptId)}'`),
        `${coverage.file} model call must be accounted to ${promptId}`,
      );
    }

    assert.match(
      traceSource,
      /appendPromptModelCallTrace|recordPromptTrace|recordQAPlannerPromptTrace|recordVisionQAPromptTrace/,
      `${coverage.file} must record Prompt Calls for model execution`,
    );
    if (callerSource && 'traceCouplingPattern' in coverage) {
      assert.match(
        callerSource,
        coverage.traceCouplingPattern,
        `${coverage.callerFile} wrapper call must feed the prompt trace result`,
      );
    }

    if ('reportOwnedDryRun' in coverage) {
      assert.match(
        source,
        new RegExp(escapeRegExp(coverage.reportOwnedDryRun.ownerBoundary)),
        `${coverage.file} report-owned dry-run must expose an owner boundary`,
      );
      assert.match(
        source,
        new RegExp(`promptId: '${escapeRegExp(coverage.reportOwnedDryRun.promptId)}' as const`),
        `${coverage.file} report-owned dry-run must expose its prompt id`,
      );
      assert.match(
        source,
        /prompt traces/,
        `${coverage.file} report-owned dry-run must stay explicit about its prompt trace boundary`,
      );
    }
  }
});

test('prompt repository entries expose strict body ownership metadata', () => {
  const entries = getRalphPromptRepositoryEntries();

  for (const entry of entries) {
    assert.match(entry.id, /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/);
    assert.ok(entry.title.length > 0);
    assert.ok(entry.description.length > 0);
    assert.ok(entry.descriptionRu.length > 0);
    assert.match(entry.source.file, /^packages\/loops\/ralph-runtime\/src\/.+\.ts$/);
    assert.ok(entry.source.symbol.length > 0);
    assert.ok(Array.isArray(entry.variables));
    assert.ok([
      'llm_prompt',
      'context_section',
      'static_context',
      'runtime_artifact',
      'task_template',
    ].includes(entry.kind));
    assert.ok([
      'repository_template',
      'repository_constant',
      'runtime_artifact',
    ].includes(entry.bodyMode));
  }
});

test('simple prompt bodies can be owned by the prompt repository', () => {
  const entries = getRalphPromptRepositoryEntries();
  const projectGoal = entries.find(entry => entry.id === 'executor.projectGoalSection');
  const e2eApplicability = entries.find(entry => entry.id === 'controller.e2eApplicability');
  const qaSelectTasks = entries.find(entry => entry.id === 'qaPlanner.selectTasks');
  const qaWriteTask = entries.find(entry => entry.id === 'qaPlanner.writeTestRequestTask');
  const errorsSection = entries.find(entry => entry.id === 'executor.errorsSection');
  const iterationHistory = entries.find(entry => entry.id === 'executor.iterationHistory');
  const verificationSection = entries.find(entry => entry.id === 'executor.verificationSection');
  const taskSection = entries.find(entry => entry.id === 'executor.taskSection');
  const productSkill = entries.find(entry => entry.id === 'executor.productSkill');
  const uxSkill = entries.find(entry => entry.id === 'executor.uxSkill');
  const secretsSection = entries.find(entry => entry.id === 'executor.secretsSection');
  const referenceSection = entries.find(entry => entry.id === 'executor.referenceSection');
  const autonomousInstructions = entries.find(entry => entry.id === 'executor.autonomousInstructions');
  const controllerAudit = entries.find(entry => entry.id === 'controller.audit');
  const replanPrompt = entries.find(entry => entry.id === 'planner.replan');
  const initialPlanner = entries.find(entry => entry.id === 'planner.initial');
  const specMigration = entries.find(entry => entry.id === 'planner.specMigration');
  const agentPrompt = entries.find(entry => entry.id === 'executor.agentPrompt');

  assert.equal(projectGoal?.bodyMode, 'repository_template');
  assert.equal(projectGoal?.templateBody?.format, 'markdown_template');
  assert.deepEqual(projectGoal?.templateBody?.placeholders, ['projectGoal']);
  assert.match(projectGoal?.templateBody?.text ?? '', /\{\{projectGoal\}\}/);

  assert.equal(e2eApplicability?.bodyMode, 'repository_template');
  assert.deepEqual(e2eApplicability?.templateBody?.placeholders, ['specContent', 'packageJson']);

  assert.equal(qaSelectTasks?.bodyMode, 'repository_template');
  assert.deepEqual(qaSelectTasks?.templateBody?.placeholders, ['specContent', 'taskList', 'remainingSlots']);

  assert.equal(qaWriteTask?.bodyMode, 'repository_template');
  assert.deepEqual(qaWriteTask?.templateBody?.placeholders, ['parentDescription', 'specSummary', 'steps']);

  assert.equal(entries.find(entry => entry.id === 'executor.ralphArenaBoundary'), undefined);
  assert.equal(entries.find(entry => entry.id === 'executor.judgmentsSection'), undefined);
  assert.equal(entries.find(entry => entry.id === 'executor.planSection'), undefined);
  assert.equal(entries.find(entry => entry.id === 'executor.gitSection'), undefined);
  assert.equal(entries.find(entry => entry.id === 'executor.legacyInstructions'), undefined);

  assert.equal(referenceSection?.bodyMode, 'repository_template');
  assert.deepEqual(referenceSection?.templateBody?.placeholders, ['specPath', 'planSummary']);

  assert.equal(errorsSection?.bodyMode, 'repository_template');
  assert.deepEqual(errorsSection?.templateBody?.placeholders, ['heading', 'errors']);

  assert.equal(iterationHistory?.bodyMode, 'repository_template');
  assert.deepEqual(iterationHistory?.templateBody?.placeholders, ['recentCount', 'iterationLines']);

  assert.equal(verificationSection?.bodyMode, 'repository_template');
  assert.deepEqual(verificationSection?.templateBody?.placeholders, ['errorBlocks']);

  assert.equal(taskSection?.bodyMode, 'repository_template');
  assert.deepEqual(taskSection?.variables, ['task', 'iteration', 'taskFolder', 'withScopeBoundary', 'visualEvidenceMode']);
  assert.equal(productSkill?.bodyMode, 'repository_constant');
  assert.equal(uxSkill?.bodyMode, 'repository_constant');
  assert.match(productSkill?.templateBody?.text ?? '', /# Product Skill/);
  assert.match(productSkill?.templateBody?.text ?? '', /primary intent/);
  assert.match(productSkill?.templateBody?.text ?? '', /primary action/);
  assert.match(productSkill?.templateBody?.text ?? '', /nice-to-have detail/);
  assert.match(uxSkill?.templateBody?.text ?? '', /# UX Skill/);
  assert.match(uxSkill?.templateBody?.text ?? '', /design mobile-first/);
  assert.match(uxSkill?.templateBody?.text ?? '', /protect user attention/);
  assert.match(uxSkill?.templateBody?.text ?? '', /viewport fit checks/);
  assert.match(uxSkill?.templateBody?.text ?? '', /wide-mobile check around 430px/);
  assert.match(uxSkill?.templateBody?.text ?? '', /Visual Workbench coverage/);
  assert.match(uxSkill?.templateBody?.text ?? '', /visual-workbench\/manifest\.json/);
  assert.match(uxSkill?.templateBody?.text ?? '', /schemaVersion="ra-355\.visual-coverage-manifest\.v0"/);
  assert.match(uxSkill?.templateBody?.text ?? '', /projectClass="ordinary_web"/);
  assert.match(uxSkill?.templateBody?.text ?? '', /coveragePolicy\.selectionDefault="full_manifest"/);
  assert.match(uxSkill?.templateBody?.text ?? '', /Do not rename the/);
  assert.match(uxSkill?.templateBody?.text ?? '', /invent any other `schemaVersion`/);
  assert.match(uxSkill?.templateBody?.text ?? '', /mockState\.name/);
  assert.match(uxSkill?.templateBody?.text ?? '', /Do not add extra/);
  assert.match(uxSkill?.templateBody?.text ?? '', /such as `source`/);
  assert.match(uxSkill?.templateBody?.text ?? '', /interaction/);
  assert.match(uxSkill?.templateBody?.text ?? '', /taskRelevance/);
  assert.deepEqual(taskSection?.templateBody?.placeholders, [
    'taskId',
    'iteration',
    'attempts',
    'description',
    'acceptanceCriteria',
    'visualWorkbenchBlock',
    'taskWorkspaceBlock',
    'linkedRefsBlock',
    'expectedEvidenceBlock',
    'lastErrorBlock',
    'scopeBoundaryBlock',
  ]);

  assert.equal(secretsSection?.bodyMode, 'repository_template');
  assert.deepEqual(secretsSection?.templateBody?.placeholders, [
    'arenaSecretsPresence',
    'secretsInstructions',
  ]);

  assert.equal(autonomousInstructions?.bodyMode, 'repository_template');
  assert.deepEqual(autonomousInstructions?.templateBody?.placeholders, ['seed', 'completionPromise']);

  assert.equal(controllerAudit?.bodyMode, 'repository_template');
  assert.doesNotMatch(controllerAudit?.templateBody?.text ?? '', /record a judgment instead of creating another verification-only task/);
  assert.doesNotMatch(controllerAudit?.templateBody?.text ?? '', /missing external proof, make and record a judgment/);
  assert.match(controllerAudit?.templateBody?.text ?? '', /Use `newJudgments` only for actual product\/spec ambiguity/);
  assert.deepEqual(controllerAudit?.templateBody?.placeholders, [
    'trigger',
    'spec',
    'planJson',
    'historyText',
    'projectSnapshot',
    'visionReportBlock',
    'feedbackMatrixBlock',
    'judgmentTimestamp',
    'e2ePolicyBlock',
  ]);

  assert.equal(replanPrompt?.bodyMode, 'repository_template');
  assert.deepEqual(replanPrompt?.templateBody?.placeholders, [
    'reason',
    'seed',
    'previousErrorBlock',
    'spec',
    'currentPlanJson',
    'visualEvidencePlannerRule',
  ]);

  assert.equal(initialPlanner?.bodyMode, 'repository_template');
  assert.deepEqual(initialPlanner?.templateBody?.placeholders, [
    'seed',
    'previousErrorBlock',
    'projectName',
    'projectDescription',
    'techStack',
    'deployBlock',
    'repositoryBlock',
    'spec',
    'acceptedDiffDispositionsBlock',
    'acceptedDiffOutputField',
    'acceptedDiffPlannerRules',
    'visualEvidencePlannerRule',
    'existingProjectFilesBlock',
    'judgmentTimestamp',
  ]);

  assert.equal(specMigration?.bodyMode, 'repository_template');
  assert.deepEqual(specMigration?.templateBody?.placeholders, [
    'previousErrorBlock',
    'projectName',
    'projectDescription',
    'techStack',
    'specLabel',
    'newSpec',
    'requiredFeedbackDispositionsBlock',
    'currentPlanJson',
    'nextTaskId',
    'feedbackDispositionExample',
    'concreteClosureEvidenceKinds',
    'nextJudgmentId',
    'judgmentTimestamp',
    'visualEvidencePlannerRule',
  ]);

  assert.equal(agentPrompt?.bodyMode, 'repository_template');
  assert.deepEqual(agentPrompt?.templateBody?.placeholders, ['contextSections']);
});

test('all prompt definitions expose a viewable body preview', () => {
  const entries = getRalphPromptRepositoryEntries();
  const controllerAudit = entries.find(entry => entry.id === 'controller.audit');
  const filesSection = entries.find(entry => entry.id === 'executor.filesSection');

  for (const entry of entries) {
    assert.ok(entry.templateBody ?? entry.bodyPreview, `missing viewable prompt body for ${entry.id}`);
  }

  assert.equal(controllerAudit?.templateBody?.source, 'prompt_repository');
  assert.match(controllerAudit?.templateBody?.text ?? '', /# Role: Project Controller \(Auditor\)/);

  const templateEntries = entries.filter(entry => entry.bodyMode !== 'runtime_artifact');
  assert.ok(templateEntries.length > 0);
  assert.ok(templateEntries.every(entry => entry.templateBody?.source === 'prompt_repository'));

  assert.equal(filesSection, undefined);
});

test('context sections point to the prompt that renders them', () => {
  const entries = getRalphPromptRepositoryEntries();
  const taskSection = entries.find(entry => entry.id === 'executor.taskSection');
  const agentPrompt = entries.find(entry => entry.id === 'executor.agentPrompt');
  const qaTaskTemplate = entries.find(entry => entry.id === 'qaPlanner.writeTestRequestTask');
  const sectionsUsedByAgent = entries.filter(entry => entry.usedByEntryIds?.includes('executor.agentPrompt'));

  assert.equal(agentPrompt?.kind, 'llm_prompt');
  assert.equal(taskSection?.kind, 'context_section');
  assert.equal(qaTaskTemplate?.kind, 'task_template');
  assert.deepEqual(taskSection?.usedByEntryIds, ['executor.agentPrompt']);
  assert.deepEqual(qaTaskTemplate?.usedByEntryIds, ['executor.taskSection']);
  assert.ok(sectionsUsedByAgent.length >= 7);
  assert.ok(sectionsUsedByAgent.every(entry => entry.id.startsWith('executor.')));
});

test('repository-owned prompt renderers preserve runtime substitutions', () => {
  const e2ePrompt = renderE2EApplicabilityPrompt('spec text', '{"scripts":{}}');
  assert.match(e2ePrompt, /## Project spec\nspec text/);
  assert.match(e2ePrompt, /"e2eApplicable": true or false/);
  assert.match(e2ePrompt, /Browser verification infrastructure is platform-owned/);
  assert.match(e2ePrompt, /INFRA_BROWSER_UNAVAILABLE/);

  const qaSelectPrompt = renderQAPlannerSelectTasksPrompt({
    specContent: 'spec text',
    taskList: '- task-001: Drag cards',
    remainingSlots: 2,
  });
  assert.match(qaSelectPrompt, /Maximum 2 QA tasks/);
  assert.match(qaSelectPrompt, /- task-001: Drag cards/);

  const qaTaskDescription = renderQATestRequestTaskDescription({
    parentDescription: 'Drag cards',
    steps: [{ question: 'Can you drag a card?' }],
    specSummary: 'Kanban board',
  });
  assert.match(qaTaskDescription, /Community QA: Write visual test cases for "Drag cards"/);
  assert.match(qaTaskDescription, /## Project Context\nKanban board/);
  assert.match(qaTaskDescription, /- Can you drag a card\?/);

  const errorsSection = renderExecutorErrorsSection(['DEPLOY ERROR: missing start']);
  assert.match(errorsSection, /^# Deploy Error/);
  assert.match(errorsSection, /DEPLOY ERROR: missing start/);

  const iterationHistory = renderExecutorIterationHistory([{
    iteration: 1,
    outcome: 'verification_failed',
    filesChanged: ['src/app.ts'],
    errors: ['Type error'],
    summary: 'Changed app shell',
  }]);
  assert.match(iterationHistory, /Previous Iterations \(recent 1\)/);
  assert.match(iterationHistory, /verification_failed \| files: src\/app\.ts/);
  assert.match(iterationHistory, /Error: Type error/);

  const verificationSection = renderExecutorVerificationSection({
    lint: { passed: false, errors: ['lint failed'] },
    typecheck: { passed: true, errors: [] },
  });
  assert.match(verificationSection, /# Verification Failures/);
  assert.match(verificationSection, /## Lint Errors/);
  assert.doesNotMatch(verificationSection, /## Type Errors/);

  const taskSection = renderExecutorTaskSection({
    task: {
      id: 'task-123',
      attempts: 2,
      description: 'Fix drag controls',
      acceptanceCriteria: ['Drag works', 'No missed taps'],
      lastError: 'Tap target mismatch',
      requiredRolePasses: ['product', 'ux'],
      feedbackItemRefs: [{
        itemId: 'DIFF-001-BUG-005',
        diffItemId: 'DIFF-001',
        targetType: 'feedback',
        targetId: 'BUG-005',
        changeType: 'reopened',
        workImpact: 'requires_loop_work',
        summary: 'BUG-005 is still visible in the accepted diff.',
        sourceRefs: ['SRC-001'],
        sourceEvidence: [{
          sourceRef: 'SRC-001',
          quote: 'кнопку Play не текстом, а той же play-иконкой',
          intent: 'Play icon replaces visible Play/play text; icon plus text is not enough.',
        }],
      }],
    },
    iteration: 7,
    taskFolder: '.ralph/tasks/task-123',
    withScopeBoundary: true,
    visualEvidenceMode: 'required',
  });
  assert.match(taskSection, /# YOUR CURRENT TASK: task-123 \(iteration 7, attempt 2\)/);
  assert.match(taskSection, /- Drag works\n- No missed taps/);
  assert.match(taskSection, /## Task Workspace/);
  assert.match(taskSection, /Folder: `\.ralph\/tasks\/task-123\/`/);
  assert.match(taskSection, /## Required Role Passes/);
  assert.match(taskSection, /product: use `\.ralph\/task-skills\/product\.md`/);
  assert.match(taskSection, /ux: use `\.ralph\/task-skills\/ux\.md`/);
  assert.match(taskSection, /## Visual Workbench Coverage/);
  assert.match(taskSection, /visual-workbench\/manifest\.json/);
  assert.match(taskSection, /visual-workbench\/stories\//);
  assert.match(taskSection, /schemaVersion="ra-355\.visual-coverage-manifest\.v0"/);
  assert.match(taskSection, /projectClass="ordinary_web"/);
  assert.match(taskSection, /workbench\.serveCommand/);
  assert.match(taskSection, /coveragePolicy\.mode="strict_canary"/);
  assert.match(taskSection, /coveragePolicy\.simplificationRequiresEvidence=true/);
  assert.match(taskSection, /Do not rename the schema/);
  assert.match(taskSection, /invent any other `schemaVersion`/);
  assert.match(taskSection, /mockState\.name/);
  assert.match(taskSection, /Manifest and story objects are strict/);
  assert.match(taskSection, /Do not add extra story fields such as `source`/);
  assert.match(taskSection, /interaction/);
  assert.match(taskSection, /taskRelevance/);
  assert.match(taskSection, /render\.path.*workbench\.storyRoutePattern/);
  assert.match(taskSection, /taskRelevance\.defaultFor/);
  assert.match(taskSection, /exact selector tokens/);
  assert.match(taskSection, /`task-123`, `task-123#DIFF-001-BUG-005`, `task-123#DIFF-001`, `task-123#BUG-005`, `DIFF-001-BUG-005`, `DIFF-001`, `BUG-005`/);
  assert.match(taskSection, /prefer the `<taskId>#<acceptedRef>` token/);
  assert.match(taskSection, /only tokens the selector-readiness stage will use/);
  assert.match(taskSection, /Missing or broken Workbench stories are coverage gaps/);
  assert.match(taskSection, /write or update `plan\.md`/);
  assert.match(taskSection, /supports subagents\/delegation/);
  assert.match(taskSection, /## Current Accepted Diff Packet/);
  assert.match(taskSection, /If task prose is vaguer than this packet, follow this packet/);
  assert.match(taskSection, /verify absence as well as the new presence/);
  assert.match(taskSection, /do not paste raw user quotes or sourceEvidence intent text into app UI\/copy/);
  assert.match(taskSection, /DIFF-001-BUG-005 \(type=feedback, target=BUG-005, change=reopened, impact=requires_loop_work, diff=DIFF-001\)/);
  assert.match(taskSection, /Summary: BUG-005 is still visible in the accepted diff\./);
  assert.match(taskSection, /Source refs: SRC-001/);
  assert.match(taskSection, /Source evidence:/);
  assert.match(taskSection, /quote="кнопку Play не текстом, а той же play-иконкой"/);
  assert.match(taskSection, /intent="Play icon replaces visible Play\/play text; icon plus text is not enough\."/);
  assert.match(taskSection, /## Expected Task Evidence/);
  assert.match(taskSection, /Do NOT edit `\.ralph\/plan\.json`/);
  assert.match(taskSection, /## Last Error\nTap target mismatch/);
  assert.match(taskSection, /## ⚠️ Scope Boundary/);

  const repairTaskSection = renderExecutorTaskSection({
    task: {
      id: 'task-020',
      displayTitle: 'Repair Visual Workbench coverage',
      addedBy: 'controller',
      attempts: 0,
      description: [
        'Repair source-owned Visual Workbench coverage for frontend accepted diff row(s): DIFF-STOOK-JAM-ROOM, DIFF-STOOK-VISUAL-CATALOG.',
        'Current blocker(s): selector_readiness_blocked.',
        'Selector issue details: task task-001: blockers=no_story_selection selectors=task-001.',
      ].join(' '),
      acceptanceCriteria: [
        'Do not make this repair task the screenshot evidence owner; map repaired stories to the original implementation task id.',
      ],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{
        itemId: 'DIFF-STOOK-JAM-ROOM',
        diffItemId: 'DIFF-STOOK-JAM-ROOM',
        targetType: 'accepted_diff',
        targetId: 'stook-jam-room',
        workSurface: 'frontend',
      }, {
        itemId: 'DIFF-STOOK-VISUAL-CATALOG',
        diffItemId: 'DIFF-STOOK-VISUAL-CATALOG',
        targetType: 'accepted_diff',
        targetId: 'stook-visual-catalog',
        workSurface: 'frontend',
      }],
    },
    iteration: 8,
    taskFolder: '.ralph/tasks/task-020',
    visualEvidenceMode: 'required',
  });
  assert.match(repairTaskSection, /## Visual Workbench Coverage/);
  assert.match(repairTaskSection, /source repair task, not a screenshot evidence owner/);
  assert.match(repairTaskSection, /Do not put this repair task id or its attached feedback refs in `taskRelevance\.defaultFor`/);
  assert.match(repairTaskSection, /exact owner selector tokens named in Selector owner guidance/);
  assert.match(repairTaskSection, /preferably `<taskId>#<acceptedRef>`/);
  assert.doesNotMatch(repairTaskSection, /these exact selector tokens: `task-020`/);
  assert.doesNotMatch(repairTaskSection, /`task-020`, `DIFF-STOOK-JAM-ROOM`, `stook-jam-room`, `DIFF-STOOK-VISUAL-CATALOG`/);
  assert.match(repairTaskSection, /## Current Accepted Diff Packet/);

  const backendTaskSection = renderExecutorTaskSection({
    task: {
      id: 'task-124',
      attempts: 0,
      description: 'Add API endpoint',
      acceptanceCriteria: ['Endpoint returns JSON'],
      requiredRolePasses: [],
      feedbackItemRefs: [{
        itemId: 'DIFF-002',
        targetType: 'spec',
        targetId: 'REQ-API',
        workSurface: 'backend',
        summary: 'Add an API endpoint.',
      }],
    },
    iteration: 1,
  });
  assert.doesNotMatch(backendTaskSection, /## Visual Workbench Coverage/);

  assert.equal(renderExecutorSecretsSection({
    isArenaRuntime: false,
    hasArenaSecretsFile: false,
  }), null);

  const localSecretsSection = renderExecutorSecretsSection({
    isArenaRuntime: false,
    hasArenaSecretsFile: true,
  });
  assert.match(localSecretsSection ?? '', /Read existing values from env first/);
  assert.doesNotMatch(localSecretsSection ?? '', /Requesting Missing Secrets/);

  const arenaSecretsSection = renderExecutorSecretsSection({
    isArenaRuntime: true,
    hasArenaSecretsFile: true,
  });
  assert.match(arenaSecretsSection ?? '', /present in this run/);
  assert.match(arenaSecretsSection ?? '', /node \/arena\/request-secrets\.js SECRET_KEY/);
  assert.match(arenaSecretsSection ?? '', /Missing required secrets are blocking by default/);
  assert.doesNotMatch(arenaSecretsSection ?? '', /TELEGRAM_BOT_TOKEN/);

  const autonomousInstructions = renderExecutorAutonomousInstructions({
    completionPromise: 'done-456',
    seed: 'abcd1234',
    iterationTimeoutMinutes: 15,
  });
  assert.match(autonomousInstructions, /Variation seed: abcd1234/);
  assert.match(autonomousInstructions, /<promise>done-456<\/promise>/);
  assert.match(autonomousInstructions, /Do NOT edit `\.ralph\/task-skills\/`/);
  assert.match(autonomousInstructions, /Runtime app data belongs in `ARENA_DATA_DIR`/);
  assert.match(autonomousInstructions, /Do not delete SQLite\/DB files in startup scripts/);
  assert.match(autonomousInstructions, /Do NOT install browser\/verification infrastructure/);
  assert.match(autonomousInstructions, /INFRA_BROWSER_UNAVAILABLE/);
  assert.doesNotMatch(autonomousInstructions, /\{\{seed\}\}/);
  // RA-374 (B): the hard limit is surfaced as a time budget.
  assert.match(autonomousInstructions, /Iteration Time Budget/);
  assert.match(autonomousInstructions, /hard-limited to 15 minutes/);
  assert.doesNotMatch(autonomousInstructions, /\{\{timeBudget\}\}/);
  // RA-374 (B) regression guard: the loop owns commits — the time budget must never tell the agent to run git commit itself (violates the executor HEAD mutation guard).
  assert.match(autonomousInstructions, /never run `git commit` yourself/);
  assert.doesNotMatch(autonomousInstructions, /Reserve the final few minutes to commit your work/);
  // RA-374 (C): verification scope discipline is stated.
  assert.match(autonomousInstructions, /Regression across all previous tasks is the controller's audit job/);
  assert.match(autonomousInstructions, /half-written `dist`/);

  // RA-374 (B): no timeout configured → no time budget section rendered.
  const noBudgetInstructions = renderExecutorAutonomousInstructions({
    completionPromise: 'done-456',
    seed: 'abcd1234',
  });
  assert.doesNotMatch(noBudgetInstructions, /Iteration Time Budget/);
  assert.doesNotMatch(noBudgetInstructions, /\{\{timeBudget\}\}/);

  const agentPrompt = renderExecutorAgentPrompt('# Section A\n\n# Section B');
  assert.equal(agentPrompt, '# Section A\n\n# Section B');
  assert.doesNotMatch(agentPrompt, /\{\{contextSections\}\}/);

  const controllerAuditPrompt = renderControllerAuditPrompt({
    trigger: 'final',
    spec: '# Spec',
    planJson: '{ "phases": [] }',
    historyText: '(no iterations yet)',
    projectSnapshot: 'src/app.ts',
    visionReportBlock: '',
    feedbackMatrixBlock: '',
    judgmentTimestamp: '2026-05-20T00:00:00.000Z',
    e2ePolicyBlock: '## E2E Test Policy\nEnabled',
  });
  assert.match(controllerAuditPrompt, /This audit was triggered by: \*\*final\*\*/);
  assert.match(controllerAuditPrompt, /"timestamp": "2026-05-20T00:00:00.000Z"/);
  assert.match(controllerAuditPrompt, /## E2E Test Policy\nEnabled/);
  assert.doesNotMatch(controllerAuditPrompt, /\{\{trigger\}\}/);

  const replanPrompt = renderPlannerReplanPrompt({
    reason: 'task failed',
    seed: 'seed-1',
    previousErrorBlock: '## Previous\nbad json',
    spec: '# Spec',
    currentPlanJson: '{ "phases": [] }',
    visualEvidenceMode: 'required',
  });
  assert.match(replanPrompt, /The reason for revision:\ntask failed/);
  assert.match(replanPrompt, /Variation seed: seed-1/);
  assert.match(replanPrompt, /## Previous\nbad json/);
  assert.match(replanPrompt, /Visual evidence mode is required/);
  assert.doesNotMatch(replanPrompt, /\{\{currentPlanJson\}\}/);

  const initialPrompt = renderPlannerInitialPrompt({
    seed: 'seed-2',
    previousErrorBlock: '',
    projectName: 'Sushi Kitties',
    projectDescription: 'Merge game',
    techStack: 'ts / next / node',
    deployBlock: 'Deploy: in-process',
    repositoryBlock: 'Repository: https://example.test/repo.git',
    spec: '# Spec',
    existingProjectFilesBlock: '## Existing project files\npackage.json',
    judgmentTimestamp: '2026-05-20T00:00:00.000Z',
    visualEvidenceMode: 'required',
  });
  assert.match(initialPrompt, /Variation seed: seed-2/);
  assert.match(initialPrompt, /Name: Sushi Kitties/);
  assert.match(initialPrompt, /"timestamp": "2026-05-20T00:00:00.000Z"/);
  assert.match(initialPrompt, /"requiredRolePasses": \[\]/);
  assert.match(initialPrompt, /`"product"` for complex\/ambiguous product behavior/);
  assert.match(initialPrompt, /`"ux"` for UI, layout, interaction/);
  assert.match(initialPrompt, /Visual evidence mode is required/);
  assert.match(initialPrompt, /visual-workbench\/stories\//);
  assert.match(initialPrompt, /do NOT create separate analysis\/design-only tasks as ceremonial work/i);
  assert.match(initialPrompt, /Browser verification infrastructure is platform-owned/);
  assert.match(initialPrompt, /App runtime data MUST go under `ARENA_DATA_DIR`/);
  assert.match(initialPrompt, /Data under `ARENA_DATA_DIR` persists across project runtime recreate/);
  assert.match(initialPrompt, /Startup and seed logic must be idempotent/);
  assert.match(initialPrompt, /Do NOT plan tasks that install Chromium/);
  assert.match(initialPrompt, /task-001` MUST create root `arena-start\.sh` plus a runnable web app/);
  assert.match(initialPrompt, /`PORT=3000 \.\/arena-start\.sh` MUST work and serve content/);
  assert.doesNotMatch(initialPrompt, /`task-001` MUST create `package\.json`/);
  assert.doesNotMatch(initialPrompt, /install any system packages it needs/);
  assert.doesNotMatch(initialPrompt, /\{\{projectName\}\}/);
  assert.doesNotMatch(initialPrompt, /\{\{acceptedDiffDispositionsBlock\}\}/);

  const acceptedDiffInitialPrompt = renderPlannerInitialPrompt({
    seed: 'seed-3',
    previousErrorBlock: '',
    projectName: 'Mini Synth',
    projectDescription: 'Jam synth',
    techStack: 'ts / vite / node',
    deployBlock: '',
    repositoryBlock: '',
    spec: '# Spec',
    acceptedDiffDispositionsBlock: '## Required Accepted Diff Work Dispositions\nDIFF-001',
    acceptedDiffOutputField: ',\n  "feedbackDispositions": []',
    acceptedDiffPlannerRules: '\n20. Return dispositions for accepted diff work.',
    existingProjectFilesBlock: '',
    judgmentTimestamp: '2026-05-20T00:00:00.000Z',
    visualEvidenceMode: 'required',
  });
  assert.match(acceptedDiffInitialPrompt, /Required Accepted Diff Work Dispositions/);
  assert.match(acceptedDiffInitialPrompt, /DIFF-001/);
  assert.match(acceptedDiffInitialPrompt, /"feedbackDispositions": \[\]/);
  assert.match(acceptedDiffInitialPrompt, /Return dispositions for accepted diff work/);
  assert.doesNotMatch(acceptedDiffInitialPrompt, /\{\{acceptedDiffOutputField\}\}/);

  const specMigrationPrompt = renderPlannerSpecMigrationPrompt({
    previousErrorBlock: '',
    projectName: 'Sushi Kitties',
    projectDescription: 'Merge game',
    techStack: 'ts / next / node',
    specLabel: 'spec.md',
    newSpec: '# New spec',
    requiredFeedbackDispositionsBlock: '## Required Current Feedback Dispositions\nnone',
    currentPlanJson: '{ "phases": [] }',
    nextTaskId: 'task-011',
    feedbackDispositionExample: '[]',
    concreteClosureEvidenceKinds: '"code_inspection"',
    nextJudgmentId: 'judgment-003',
    judgmentTimestamp: '2026-05-20T00:00:00.000Z',
    visualEvidenceMode: 'required',
  });
  assert.match(specMigrationPrompt, /## New Spec \(spec\.md\)\n# New spec/);
  assert.match(specMigrationPrompt, /"id": "task-011"/);
  assert.match(specMigrationPrompt, /"id": "judgment-003"/);
  assert.match(specMigrationPrompt, /"requiredRolePasses": \[\]/);
  assert.match(specMigrationPrompt, /existing concrete closure kind: "code_inspection"/);
  assert.match(specMigrationPrompt, /sourceEvidence`, `closedByEvidence` requires product-facing proof/);
  assert.match(specMigrationPrompt, /bare `DIFF-\*`, item id, or target id is rejected as too weak/);
  assert.match(specMigrationPrompt, /Do NOT create separate analysis\/design-only tasks as ceremonial work/);
  assert.match(specMigrationPrompt, /Visual evidence mode is required/);
  assert.match(specMigrationPrompt, /"visualEvidenceRequired": true/);
  assert.doesNotMatch(specMigrationPrompt, /\{\{nextTaskId\}\}/);
});

test('export shape is stable and timestamp can be injected for snapshots', () => {
  const generatedAt = '2026-05-17T00:00:00.000Z';
  const exported = exportRalphPromptRepository({ generatedAt });

  assert.equal(exported.schemaVersion, PROMPT_REPOSITORY_SCHEMA_VERSION);
  assert.equal(exported.generatedAt, generatedAt);
  assert.equal(exported.owner, PROMPT_REPOSITORY_OWNER);
  assert.equal(exported.bodyContract.templateBodies, 'repository_owned');
  assert.equal(exported.bodyContract.renderedBodies, 'prompt_trace');
  assert.equal(exported.entries.length, getRalphPromptRepositoryEntries().length);
});

test('export returns cloned entries', () => {
  const first = getRalphPromptRepositoryEntries();
  const withBody = first.find(entry => entry.templateBody);
  const withPreview = first.find(entry => entry.bodyPreview);

  first[0].variables.push('mutated');
  first[0].source.file = 'mutated.ts';
  withBody?.templateBody?.placeholders.push('mutated');
  first.find(entry => entry.usedByEntryIds)?.usedByEntryIds?.push('mutated-used-by');
  withPreview?.bodyPreview?.placeholders.push('mutated-preview');

  const second = getRalphPromptRepositoryEntries();
  const secondWithBody = second.find(entry => entry.id === withBody?.id);
  const secondWithUsedBy = second.find(entry => entry.usedByEntryIds);
  const secondWithPreview = withPreview
    ? second.find(entry => entry.id === withPreview.id)
    : undefined;

  assert.equal(second[0].variables.includes('mutated'), false);
  assert.notEqual(second[0].source.file, 'mutated.ts');
  assert.equal(secondWithBody?.templateBody?.placeholders.includes('mutated'), false);
  assert.equal(secondWithUsedBy?.usedByEntryIds?.includes('mutated-used-by'), false);
  if (withPreview) {
    assert.equal(secondWithPreview?.bodyPreview?.placeholders.includes('mutated-preview'), false);
  }
});

function readRuntimeTracePromptIds(): Set<string> {
  const ids = new Set<string>();

  for (const file of RUNTIME_TRACE_SOURCE_FILES) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const match of source.matchAll(/promptId: '([^']+)'/g)) {
      ids.add(match[1]);
    }
  }

  return ids;
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

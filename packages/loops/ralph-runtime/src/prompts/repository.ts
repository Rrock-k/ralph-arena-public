import type { VisualEvidenceMode } from '../config/types.js';

export const PROMPT_REPOSITORY_SCHEMA_VERSION = 'ra-310.prompt-repository.v17' as const;
export const PROMPT_REPOSITORY_OWNER = 'packages/loops/ralph-runtime/src/prompts' as const;

export type PromptOwner =
  | 'planner'
  | 'executor'
  | 'controller'
  | 'qa-planner'
  | 'vision-qa';

export type PromptRepositoryEntryKind =
  | 'llm_prompt'
  | 'context_section'
  | 'static_context'
  | 'runtime_artifact'
  | 'task_template';

export type PromptTemplateStatus =
  | 'dynamic_builder'
  | 'section_builder'
  | 'static_constant'
  | 'external_artifact';

export type PromptVisibility =
  | 'admin_raw'
  | 'safe_summary';

export type PromptBodyMode =
  | 'repository_template'
  | 'repository_constant'
  | 'runtime_artifact';

export type PromptRepositoryTemplateBodyFormat =
  | 'markdown'
  | 'markdown_template';

export type PromptRepositoryBodyPreviewSource =
  | 'prompt_repository'
  | 'runtime_artifact_description';

export interface PromptRepositoryBodyPreview {
  source: PromptRepositoryBodyPreviewSource;
  format: PromptRepositoryTemplateBodyFormat;
  text: string;
  placeholders: string[];
  note?: string;
}

export interface PromptRepositoryTemplateBody extends PromptRepositoryBodyPreview {
  source: 'prompt_repository';
}

export interface PromptSource {
  file: string;
  symbol: string;
  lineHint?: number;
}

export interface PromptRepositoryEntrySource {
  id: string;
  title: string;
  owner: PromptOwner;
  kind: PromptRepositoryEntryKind;
  templateStatus: PromptTemplateStatus;
  source: PromptSource;
  variables: string[];
  visibility: PromptVisibility;
  description: string;
  descriptionRu: string;
  notes?: string[];
  usedByEntryIds?: string[];
  templateBody?: PromptRepositoryTemplateBody;
  bodyPreview?: PromptRepositoryBodyPreview;
}

export interface PromptRepositoryEntry extends PromptRepositoryEntrySource {
  bodyMode: PromptBodyMode;
}

export interface PromptRepositoryBodyContract {
  templateBodies: 'repository_owned';
  renderedBodies: 'prompt_trace';
  note: string;
}

export interface PromptRepositoryExport {
  schemaVersion: typeof PROMPT_REPOSITORY_SCHEMA_VERSION;
  generatedAt: string;
  owner: typeof PROMPT_REPOSITORY_OWNER;
  bodyContract: PromptRepositoryBodyContract;
  entries: PromptRepositoryEntry[];
}

const PROMPT_REPOSITORY_BODY_CONTRACT: PromptRepositoryBodyContract = {
  templateBodies: 'repository_owned',
  renderedBodies: 'prompt_trace',
  note: 'Prompt Repository owns all exported template/static prompt bodies. Executor context should point to live project files instead of embedding runtime file snapshots. Rendered prompt text is recorded by prompt trace events when a prompt runs.',
};

const EXECUTOR_AGENT_PROMPT_ENTRY_ID = 'executor.agentPrompt';
const EXECUTOR_TASK_SECTION_ENTRY_ID = 'executor.taskSection';
const USED_BY_EXECUTOR_AGENT_PROMPT = [EXECUTOR_AGENT_PROMPT_ENTRY_ID];

export const COMMUNITY_QA_CONTEXT_TEMPLATE = `## Community QA — What It Is and Why It Matters

You are writing test cases for REAL HUMANS who will open this app in a browser
and answer your questions with Yes or No. They are NOT developers — they don't
know what a server, API, endpoint, or environment variable is.

### Why this exists
An AI agent (you) can verify code: run linters, type checks, unit tests, e2e tests.
But there are things you CANNOT verify programmatically:
- Does a physics simulation FEEL right?
- Does an animation look SMOOTH to human eyes?
- Does drag-and-drop WORK intuitively?
- Does canvas/WebGL render CORRECTLY?
- Does the UI layout look RIGHT?

Community QA bridges this gap. Real people test what machines can't.

### What makes a GOOD test question
- About something the user can SEE: "Can you see a red button labeled 'Start'?"
- About something the user can DO: "When you click the button, does a modal appear?"
- About visual feedback: "When you hover over the card, does it lift up with a shadow?"
- Simple, specific, one thing at a time
- Answerable with Yes or No

### What makes a BAD test question
- Anything about servers, ports, endpoints, HTTP status codes
- Anything about logs, console output, environment variables
- Anything requiring dev tools or technical knowledge
- Vague questions like "Does the app work?"
- Multiple things in one question

### Output format
Write test requests to \`.arena/outgoing-events.json\`. Read the file first (or create
as empty array \`[]\`), append entries, write back:

\`\`\`json
{
  "type": "test_request",
  "payload": {
    "title": "Short descriptive title",
    "steps": [
      { "question": "Can you see X on the page?" },
      { "question": "When you do Y, does Z happen?" }
    ]
  }
}
\`\`\`

### Before writing tests
INSPECT the code you built. Look at the actual UI components, pages, and styles.
Write questions about what ACTUALLY exists, not what the spec says should exist.
`;

export const VISION_QA_ANALYSIS_TEMPLATE = `You are a QA engineer reviewing a web application through screenshots taken during e2e testing.

Examine the screenshot sequence (chronological order) and determine whether the application works correctly.

For a **game with canvas/physics** (Angry Birds, 2048, etc.):
- Game canvas rendered, objects visible, physics interactions
- Slingshot/controls functional, projectile trajectory, block destruction, score display
- Game appears playable

For a **standard web UI**:
- Correct layouts, forms, navigation, data display

## Response Format (strict JSON)
\`\`\`json
{
  "verdict": "pass" | "fail" | "inconclusive",
  "confidence": 0.0-1.0,
  "summary": "Brief overall assessment",
  "criteriaResults": [
    { "criterion": "criterion text", "met": true/false, "evidence": "what you see" }
  ]
}
\`\`\`
Only output the JSON block.`;

export const PROJECT_GOAL_SECTION_TEMPLATE = `# Project Goal
{{projectGoal}}
`;

export const REFERENCE_SECTION_TEMPLATE = `# References (read-only)
- Full spec: \`{{specPath}}\` — read if you need context beyond the task description and project goal. Do NOT treat it as a to-do list.
- Full plan: \`.ralph/plan.json\` — read-only. The orchestrator manages task assignment. You have exactly ONE task (above). Complete it and stop.
- {{planSummary}}`;

export const EXECUTOR_ERRORS_SECTION_TEMPLATE = `{{heading}}
{{errors}}`;

export const EXECUTOR_ITERATION_HISTORY_TEMPLATE = `# Previous Iterations (recent {{recentCount}})

What was already tried for this task — DO NOT repeat failed approaches:

{{iterationLines}}
`;

export const EXECUTOR_VERIFICATION_SECTION_TEMPLATE = `# Verification Failures

The automated verification pipeline found these issues. Fix only issues YOUR changes caused. If errors are pre-existing, infrastructure-related (build timeout, SSR data collection), or unrelated to your task — document them and emit the completion signal.

{{errorBlocks}}
`;

export const EXECUTOR_TASK_SECTION_TEMPLATE = `# YOUR CURRENT TASK: {{taskId}} (iteration {{iteration}}, attempt {{attempts}})

{{description}}

## Acceptance Criteria
{{acceptanceCriteria}}{{visualWorkbenchBlock}}{{taskWorkspaceBlock}}{{linkedRefsBlock}}{{expectedEvidenceBlock}}{{lastErrorBlock}}{{scopeBoundaryBlock}}`;

export const PRODUCT_SKILL_TEMPLATE = `# Product Skill

Purpose: make what should work for the user precise before implementation.

Use this pass when the current task requires product thinking.

Default stance:
- identify the user's primary intent for this task before listing features;
- keep the product surface small: separate must-have behavior from nice-to-have detail;
- name the main user action and the limited secondary actions that matter for the scenario;
- explicitly defer, hide or exclude product details that do not need to compete for attention now.

Write a short task-local \`product.md\` with:
- user scenario and expected behavior;
- what the user must understand or decide first;
- primary action and truly necessary secondary actions;
- success criteria in product language;
- important edge cases;
- non-goals for this task;
- any spec ambiguity handled as a best implementable interpretation.

Keep it implementation-facing. Do not invent product truth beyond the accepted spec/diff.`;

export const UX_SKILL_TEMPLATE = `# UX Skill

Purpose: make UI, interaction, visual, responsive or gameplay-feel work concrete before implementation.

Use this pass when the current task changes screens, flows, controls, layout, animations, visual hierarchy, or game feel.

Default stance:
- design mobile-first unless the accepted spec explicitly says another target is primary;
- protect user attention: each screen/widget should have one obvious main action and only the secondary actions needed now;
- use familiar simple UI primitives first: button, toggle, tab, link, input, menu, tooltip, popover, modal;
- hide, group or defer details that do not need to compete for attention on the main surface;
- make sure visible entities and actions fit in the intended viewport without clipping, overlap, accidental horizontal scroll or unreadable compression.

Write a short task-local \`ux.md\` with:
- affected surfaces and user flow;
- what the user must understand in the first few seconds;
- primary action and the limited secondary actions for each affected surface/widget;
- required states, including empty/loading/error/mobile where relevant;
- Visual Workbench coverage to add or update under \`visual-workbench/manifest.json\` and \`visual-workbench/stories/\` only when the current task explicitly has \`visualEvidenceRequired: true\` or its acceptance criteria explicitly require Visual Workbench source coverage;
- interaction and visual hierarchy requirements;
- responsive/accessibility constraints;
- viewport fit checks, especially mobile, for the entities and actions introduced by this task;
- if the accepted intent says mobile fullscreen, no modal chrome, no padding, or fixed mobile viewport, include at least one wide-mobile check around 430px in addition to narrower phones;
- checks that prove the result feels finished rather than raw.
- when Visual Workbench is required for the current task, keep the manifest root on the exact existing
  contract: \`schemaVersion="ra-355.visual-coverage-manifest.v0"\`,
  \`projectClass="ordinary_web"\`, \`workbench.serveCommand\`,
  \`workbench.storyRoutePattern\`, \`coveragePolicy.mode="strict_canary"\`,
  \`coveragePolicy.selectionDefault="full_manifest"\` and
  \`coveragePolicy.simplificationRequiresEvidence=true\`. Do not rename the
  schema, invent any other \`schemaVersion\`, or omit these v0 root fields.
- when Visual Workbench is required for the current task, ensure each story has the required v0 fields:
  \`id\`, \`title\`, \`kind\`, \`feature\`, \`widget\`, \`state\`, \`claim\`,
  \`render.type="workbench_route"\`, \`render.path\`, \`mockState.name\` and
  at least one explicit viewport.
- when Visual Workbench is required for the current task, manifest and story objects are strict. Do not add extra
  story fields such as \`source\`; the only optional story fields currently
  accepted are \`interaction\`, \`waitAfterLoadMs\`, \`tags\` and
  \`taskRelevance\`.

Keep it implementation-facing. Do not replace the accepted spec/diff or create a separate design source of truth.`;

export const EXECUTOR_ACTIVE_WIP_RECONCILIATION_TEMPLATE = `# Active WIP Reconciliation
This task was already started in this workspace. Treat the current code state as partial WIP, not as a clean slate.

Before editing:
- Inspect the current source state and recent git history for work already applied to this task.
- Role passes and task-local notes (\`product.md\`, \`ux.md\`, \`plan.md\`) from the earlier attempt may already exist in the task folder. Reuse them; re-run a role pass only if the accepted spec changed since they were written.
- Compare this task against the latest accepted spec/diff. The latest accepted spec outranks stale task wording if they conflict.
- If the task is still valid, finish it from the current partial state.
- If the task was changed by the latest spec, adapt the partial work to the new requirement.
- If the task was cancelled or superseded, clean up or revert any partial work from this task so the project matches the latest spec, then stop.

Do not start later planned tasks. Your job is to close this active WIP boundary honestly: complete, adapt, or clean it up.`;

export const EXECUTOR_SECRETS_SECTION_TEMPLATE = `## Secrets
Project secrets may already be available in environment variables and in \`.env.arena-secrets\` at the repo root{{arenaSecretsPresence}}.
{{secretsInstructions}}`;

export const E2E_APPLICABILITY_PROMPT_TEMPLATE = `You are deciding whether automated Playwright e2e tests are useful for this project.

## Project spec
{{specContent}}

## package.json
{{packageJson}}

## Question
Are Playwright browser e2e tests applicable and useful for this project?

Playwright e2e tests are USEFUL for: standard web apps with DOM elements, forms, navigation, text content, API responses — things Playwright can query and assert on.

Playwright e2e tests are NOT USEFUL for: canvas/WebGL/Three.js games, audio-visual projects, generative art — Playwright cannot inspect canvas pixels or verify 3D rendering. For these projects, visual QA by humans or screenshot-based testing is more appropriate.

Browser verification infrastructure is platform-owned. Do not decide applicability by assuming the project can install Chromium or Playwright browsers. Missing platform browser readiness is INFRA_BROWSER_UNAVAILABLE, not a project task.

Respond with EXACTLY one JSON block:
\`\`\`json
{ "e2eApplicable": true or false, "reasoning": "one sentence why" }
\`\`\``;

export const QA_PLANNER_SELECT_TASKS_TEMPLATE = `You are a QA planning specialist. Your job: decide which features need testing by real humans.

## Why Community QA exists
An AI agent can run linters, type checks, unit tests, and even e2e tests. But there are things
it CANNOT verify — things that require human eyes and hands:
- Does the physics FEEL right? (not just "does it run without errors")
- Does the animation look SMOOTH? (not just "does the CSS class get applied")
- Does drag-and-drop WORK intuitively? (not just "does the event handler fire")
- Does the canvas render CORRECTLY? (not just "does the canvas element exist")
- Does the layout look RIGHT on screen? (not just "do the divs have correct classes")

Community QA sends the app to real people who open it in a browser and answer simple Yes/No questions.

## Your task
Look at the project spec and the list of feature tasks. Select ONLY tasks that involve
visual or interactive behavior that genuinely needs human verification. Be selective —
not every task needs QA. A form with text inputs probably doesn't. A physics simulation definitely does.

## Decision criteria
SELECT tasks involving: canvas/WebGL, physics, animations, transitions, drag-and-drop,
game mechanics, interactive visualizations, complex responsive layouts, audio/video playback.

SKIP tasks involving: API endpoints, database setup, configuration, testing infrastructure,
deployment, CI/CD, backend logic, simple CRUD forms, static content pages.

## Rules
- Maximum {{remainingSlots}} QA tasks
- For each selected task, write 1-3 visual test questions
- Each question must be answerable Yes/No by someone who has NEVER seen code
- Questions must be about what the user SEES and DOES in the browser
- Return [] if the project is backend-only, a CLI tool, or nothing needs human verification

## Good questions
- "Can you see a red bird sitting on a slingshot?"
- "When you drag the bird and release, does it fly in an arc?"
- "Does the score at the top of the screen go up when blocks break?"
- "When you hover over a card, does it lift up with a shadow?"
- "Can you drag a task from 'To Do' to 'Done'?"

## Bad questions (NEVER)
- "Does the server start on port 3000?"
- "Does the API return JSON?"
- "Is the database connection established?"
- "Are environment variables set?"

## Project Spec
{{specContent}}

## Candidate Feature Tasks
{{taskList}}

## Output
Return EXACTLY one JSON array, no markdown fences, no explanation:
[
  {
    "parentTaskId": "task-003",
    "title": "Bird flight physics",
    "steps": [
      { "question": "Can you see a bird on the slingshot?" },
      { "question": "When you drag and release the bird, does it fly smoothly?" }
    ]
  }
]

Return [] if nothing needs community QA.`;

export const QA_TEST_REQUEST_TASK_TEMPLATE = `Community QA: Write visual test cases for "{{parentDescription}}"
{{specSummary}}
## Why this matters
You just built a feature that involves visual/interactive behavior — things like
animations, physics, canvas rendering, drag-and-drop, transitions, or dynamic UI.
An AI agent CANNOT verify these things programmatically. A real human will open the
app in a browser and answer your questions with Yes or No. That's the ONLY way to
know if this feature actually works as intended.

Your job: write questions that a non-technical person can answer by LOOKING at the
app and INTERACTING with it. Think about what the user SEES on screen, not what
happens in the code.

## Rules
- Questions must be about something VISIBLE or INTERACTIVE in the browser
- A non-technical person must understand the question without any dev knowledge
- Focus on: what appears on screen, what happens when you click/drag/scroll, animations, colors, layout
- Questions must be answerable with Yes / No
- Max 3 steps per test case
- NEVER mention: servers, ports, endpoints, logs, HTTP codes, env vars, APIs, databases, config files

## Examples of GOOD questions
- "Can you see a red bird sitting on a slingshot?"
- "When you drag the bird back and release it, does it fly through the air?"
- "Does the score number at the top increase when blocks are destroyed?"
- "When you hover over the 'Start' button, does it change color?"
- "After submitting the form, does a success message appear on screen?"

## Examples of BAD questions (NEVER write these)
- "Does the server start on port 3000?"
- "Is the WebSocket connection established?"
- "Does the health endpoint return 200?"
- "Are the environment variables configured correctly?"
- "Does the API return the correct JSON response?"

## How to write the result
Read the existing \`.arena/outgoing-events.json\` file (create it as an empty array \`[]\` if it doesn't exist).
Append your test request entries to the array and write it back. Each entry format:

\`\`\`json
{
  "type": "test_request",
  "payload": {
    "title": "Short visual test title",
    "steps": [
      { "question": "Can you see X on the page?" },
      { "question": "When you click Y, does Z happen?" }
    ]
  }
}
\`\`\`

## Suggested test cases (refine based on what was ACTUALLY built)
{{steps}}

Before writing the test cases, INSPECT the code you built to understand what the
real UI looks like. Adjust the suggested questions to match the actual implementation
— don't blindly copy them.`;

export const PLANNER_INITIAL_PROMPT_TEMPLATE = `# Role: Project Planner

You are analyzing a project specification to create a detailed execution plan.
An autonomous coding agent will execute this plan task-by-task. Each task = one iteration = one commit.

Variation seed: {{seed}} — use this to vary your architectural decisions, naming, structure, and implementation approach. Do not mention the seed in your output.

{{previousErrorBlock}}

## Project
Name: {{projectName}}
Description: {{projectDescription}}
Tech stack: {{techStack}}
{{deployBlock}}
{{repositoryBlock}}

## Runtime Environment
The agent will execute inside an isolated, ephemeral Docker container (node:20-slim). Plan accordingly:
- **sudo** is available without a password — the agent can install app/runtime system packages required by the product code.
- **No external services** are provided (no managed databases, caches, or queues). If the app needs PostgreSQL, Redis, SQLite, etc., the agent must install and start them itself inside the container.
- The app MUST be **self-contained**: \`npm start\` should bring up everything, including any databases or background services.
- **Runtime data path**: source code and tracked project truth live in \`/workspace\`. App runtime data MUST go under \`ARENA_DATA_DIR\` (default \`/data\`): SQLite DBs, uploads, generated videos/media, thumbnails, app cache, temporary user artifacts and similar non-source data.
- Data under \`ARENA_DATA_DIR\` persists across project runtime recreate. Do not plan source-tree runtime data directories such as \`generated/\`, \`uploads/\`, \`cache/\`, or \`data/\` unless the spec explicitly requires source fixtures there.
- Startup and seed logic must be idempotent. Do not reset stale/test data by deleting SQLite/DB files on startup; migrate or seed only missing rows while preserving user data.
- **Network**: only localhost is available. Do not plan for external hosts or cloud services.
- **Pre-installed**: git, curl, node 20, npm. Product/runtime dependencies may be installed via \`sudo apt-get\` or \`npm install\`.
- **Browser verification infrastructure is platform-owned**. Do NOT plan tasks that install Chromium, Chrome, Playwright browsers, \`npx playwright install\`, \`playwright install-deps\`, or equivalent browser infra inside the project workspace. If browser verification is unavailable, record it as infra/browser unavailable evidence instead of a project bug.
- The container filesystem outside mounted paths is ephemeral.

## Spec
{{spec}}

{{acceptedDiffDispositionsBlock}}

{{existingProjectFilesBlock}}

## Output Format

IMPORTANT: Do NOT use any tools (Write, Edit, Bash, etc.). Do NOT create or edit any files.
Simply output the JSON plan as text in your response. This is a planning step, not a coding step.

You MUST output EXACTLY one JSON block wrapped in \`\`\`json ... \`\`\` fences.
The JSON must have this structure:

\`\`\`json
{
  "projectGoal": "2-3 sentence summary of what this project builds and its core value proposition. Written for a developer who will implement one task at a time and needs to understand the big picture.",
  "phases": [
    {
      "id": "phase-1",
      "name": "Phase Name",
      "description": "What this phase achieves",
      "order": 1,
      "status": "pending",
      "tasks": [
        {
          "id": "task-001",
          "displayTitle": "Build app shell",
          "description": "Detailed task description",
          "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
          "status": "pending",
          "priority": 5,
          "dependencies": [],
          "estimatedComplexity": "low",
          "requiredRolePasses": [],
          "attempts": 0
        }
      ]
    },
    {
      "id": "phase-4",
      "name": "Deferred Phase (example)",
      "description": "Detailed description of WHAT this phase should achieve — enough context for the planner to expand it into concrete tasks later",
      "order": 4,
      "status": "pending",
      "planLater": true,
      "tasks": []
    }
  ],
  "judgments": [
    {
      "id": "judgment-001",
      "timestamp": "{{judgmentTimestamp}}",
      "phaseId": "phase-1",
      "taskId": null,
      "ambiguity": "What is unclear in the spec",
      "options": ["Option A", "Option B", "Option C"],
      "chosen": 0,
      "reasoning": "Why this option was chosen",
      "madeBy": "planner"
    }
  ]{{acceptedDiffOutputField}}
}
\`\`\`

## Rules
1. Right-size the plan to spec complexity (do NOT force fixed phase/task counts).
   - TINY scope (single page/simple utility): as few as 1-3 phases and 1-6 total tasks.
   - SMALL scope: typically 2-5 phases and 4-12 tasks.
   - MEDIUM scope: typically 3-7 phases and 8-25 tasks.
   - LARGE scope: as many phases/tasks as needed; prioritize clarity and dependency safety over compactness.
2. Tasks must be ATOMIC — one task = one meaningful commit that keeps the project in a working state.
3. Avoid ceremonial/planning-only tasks. Add a task only if it changes product behavior, delivery reliability, or verification confidence.
4. Every task MUST include \`displayTitle\`: a short English user-facing title for UI/Telegram, ideally 3-6 words and at most 80 characters. Keep technical details in \`description\`; do not make \`displayTitle\` a truncated paragraph.
5. Bootstrap policy for Phase 1:
   If project bootstrap is NOT present, \`task-001\` MUST create root \`arena-start.sh\` plus a runnable web app. \`package.json\` may be part of that app, but it is NOT the platform bootstrap contract by itself.
   The root \`arena-start.sh\` MUST:
   - Listen on port specified by PORT env var (default 3000)
   - Bind to 0.0.0.0 (NOT 127.0.0.1) to allow external connections
   - Expose \`/\` (root) and \`/health\` endpoints
   After bootstrap, \`PORT=3000 ./arena-start.sh\` MUST work and serve content.
   NOTE: Deployment runs in-process (no Docker Compose). Dockerfile and docker-compose.yml are OPTIONAL and not used by the deployment system.
   If bootstrap is already present and usable in existing files, do NOT add a duplicate bootstrap task; start from the next unmet requirement.
6. Include integration/final validation work only when it adds value for this spec. For tiny scopes, final validation can be folded into the last implementation task.
7. Task IDs are globally unique: task-001, task-002, ... sequential across phases.
8. For EVERY ambiguity in the spec, create a Judgment.
9. Each task must have clear, testable acceptance criteria. Tasks that add business logic, API endpoints, data models, or algorithms MUST include "write unit tests for …" in their acceptance criteria.
10. Dependencies: list task IDs that must complete before this task can start.
11. Be especially careful about:
    - Seed data in production containers (dev tools may not be available)
    - Environment variables needed at runtime vs build time
    - File paths that differ between dev and Docker
    - Dependencies that are devDependencies vs production
12. Assign \`priority\` for every task:
    - Use only this scale: critical=1, high=3, medium=5
    - Default is medium (5) for normal tasks
    - Use high (3) when the task significantly hurts app usability
    - Use critical (1) when the app cannot be used without this fix
13. Keep dependencies authoritative: task priority can reorder runnable work, but must never violate dependencies.
14. If the spec is very small, prefer fewer, broader atomic tasks over many micro-tasks.
15. For tiny MVPs, merge low-risk bootstrap/UI/setup work instead of splitting it.
16. If the spec is complex/high-risk, expand into finer-grained tasks to isolate risk and improve recoverability.
17. **Deferred planning (\`planLater\`)**: For later phases where you don't yet have enough context to plan concrete tasks (e.g. the implementation details depend on research/design done in earlier phases), set \`"planLater": true\` and leave \`tasks: []\`. Write a detailed \`description\` of what the phase should achieve — the planner will expand it into concrete tasks once earlier phases are done and the codebase has more context. Use this for MEDIUM+ scopes when later phases depend heavily on earlier outcomes.
18. **Role passes**: do NOT create separate analysis/design-only tasks as ceremonial work. Instead, set \`requiredRolePasses\` on implementation tasks when extra thinking is needed before code:
    - \`"product"\` for complex/ambiguous product behavior, user flows, edge cases, feature priority or acceptance semantics.
    - \`"ux"\` for UI, layout, interaction, animation, responsive, accessibility, visual hierarchy or gameplay-feel work.
    - Use both when the task is product-heavy and UX-heavy.
    - Omit the field or use \`[]\` for simple backend, infrastructure, copy-only or mechanically obvious tasks.
{{visualEvidencePlannerRule}}
{{acceptedDiffPlannerRules}}

## Judgment Rules

- If the spec is unclear about HOW → Judgment
- If there are multiple valid approaches → Judgment with reasoning
- If the spec OMITS something clearly needed → Judgment
- If there's a dev vs production discrepancy risk → Judgment
`;

export const PLANNER_REPLAN_PROMPT_TEMPLATE = `# Role: Project Planner (Revision)

You are revising an existing project plan. The reason for revision:
{{reason}}

Variation seed: {{seed}}

{{previousErrorBlock}}

## Original Spec
{{spec}}

## Current Plan (statuses reflect progress)
\`\`\`json
{{currentPlanJson}}
\`\`\`

## Rules for Revision
1. DO NOT change tasks that are already "completed" — they are done
2. You MAY add new tasks, modify pending tasks, or reorder pending tasks
3. You MAY add new phases (use order numbers that fit between existing ones)
4. Keep existing task IDs for unchanged tasks
5. New tasks: use the next available task-NNN number
6. Output the FULL plan (including completed phases/tasks with their current status)
7. Set explicit \`priority\` on new or updated pending tasks using only: critical=1, high=3, medium=5
8. Default to medium (5); raise to high/critical only if usability is heavily impacted or app usage is blocked
9. You MAY compress or merge over-segmented pending tasks.
10. You MAY split pending tasks when risk/complexity is high.
{{visualEvidencePlannerRule}}

## Output
Same JSON format as initial planning. Include ALL phases and tasks (even completed ones).
`;

export const PLANNER_SPEC_MIGRATION_PROMPT_TEMPLATE = `# Role: Incremental Planner (Spec Migration)

You are updating an EXISTING project plan from the CURRENT accepted specification.
Treat the accepted spec and accepted diff as current project truth. Existing completed tasks are historical execution evidence only; they do not prove that newer accepted diff work is obsolete.

{{previousErrorBlock}}

## Project
Name: {{projectName}}
Description: {{projectDescription}}
Tech stack: {{techStack}}

## New Spec ({{specLabel}})
{{newSpec}}

{{requiredFeedbackDispositionsBlock}}

## Current Plan
\`\`\`json
{{currentPlanJson}}
\`\`\`

## Output Format

IMPORTANT: Do NOT use any tools (Write, Edit, Bash, etc.). Simply output the JSON as text.

Return EXACTLY one JSON block in \`\`\`json fences with this shape:

\`\`\`json
{
  "summary": "One short paragraph about what changed",
  "planChanges": [
    {
      "action": "addTask",
      "phaseId": "phase-6",
      "task": {
        "id": "{{nextTaskId}}",
        "displayTitle": "Implement feature",
        "description": "Implement ...",
        "acceptanceCriteria": ["..."],
        "status": "pending",
        "priority": 5,
        "dependencies": [],
        "estimatedComplexity": "medium",
        "requiredRolePasses": [],
        "attempts": 0
      }
    }
  ],
  "feedbackDispositions": {{feedbackDispositionExample}},
  "newJudgments": [
    {
      "id": "{{nextJudgmentId}}",
      "timestamp": "{{judgmentTimestamp}}",
      "phaseId": null,
      "taskId": null,
      "ambiguity": "What is unclear in the new spec",
      "options": ["A", "B"],
      "chosen": 0,
      "reasoning": "Why",
      "madeBy": "planner"
    }
  ]
}
\`\`\`

## Rules
1. Apply ONLY incremental changes required by the new spec.
2. Prefer \`addTask\` / \`addPhase\` over rewriting existing completed work.
3. Do NOT remove completed tasks.
4. Do NOT remove or edit \`in_progress\` tasks. They are active WIP owned by the executor session. If current accepted diff overlaps an \`in_progress\` task, prefer \`coveredByOpenTask\` and let the executor reconcile the WIP against the latest accepted spec.
5. If updating existing pending tasks, use \`updateTask\` with a \`changes\` object:
   \`{ "action": "updateTask", "taskId": "task-001", "changes": { "displayTitle": "Short title", "description": "New desc", "acceptanceCriteria": ["..."], "priority": 5, "dependencies": ["task-000"], "requiredRolePasses": ["product", "ux"] } }\`
   The \`changes\` object is REQUIRED and must contain at least one field (displayTitle, description, acceptanceCriteria, priority, dependencies, requiredRolePasses, or status).
6. Use task IDs starting from {{nextTaskId}} for new tasks (increment sequentially).
7. Use judgment IDs starting from {{nextJudgmentId}} for new judgments.
8. If no changes are needed, return empty arrays with a clear summary.
9. Every added/updated pending task must have \`displayTitle\`: short English UI/Telegram title, ideally 3-6 words and at most 80 characters.
10. Every added/updated pending task must have \`priority\` using only: critical=1, high=3, medium=5.
11. Default to medium (5), use high (3) for major usability blockers, critical (1) for app-breaking issues.
12. Every added task must have \`estimatedComplexity\` using only: \`"low"\`, \`"medium"\`, or \`"high"\`. Do not use \`"small"\`, \`"normal"\`, numbers, or any other value.
13. If any required accepted diff item is listed above, it MUST have exactly one \`feedbackDispositions[]\` entry.
14. \`addTask\` dispositions must reference a new task from \`planChanges\`: either a direct \`addTask.task.id\` or a task inside an \`addPhase.phase.tasks[]\` entry. The task description or acceptance criteria should mention the diff item, target id, or hard requirement summary. For rows with \`sourceEvidence\`, the task must carry the accepted diff summary/product outcome; a bare \`DIFF-*\`, item id, or target id is rejected as too weak. Do NOT include \`feedbackItemRefs\` or \`verificationEvidence\` in \`planChanges\`; Ralph records those fields itself from \`feedbackDispositions[]\` and later verification.
15. \`updateOpenTask\` dispositions must reference an existing non-completed task that you update in \`planChanges\`.
16. \`coveredByOpenTask\` dispositions must reference existing non-completed work; do not use completed/skipped tasks here. For rows with \`sourceEvidence\`, the cited task must either already have the current structured \`feedbackItemRef\` or carry the accepted diff summary/product outcome; id-only text is not enough.
17. \`closedByEvidence\` dispositions must include concrete evidence. A completed task, generic lint/build pass, or vague claim is not enough. For \`evidence[].kind\`, use only an existing concrete closure kind: {{concreteClosureEvidenceKinds}}.
    - Do not invent domain-specific evidence kinds.
    - For a row with \`sourceEvidence\`, \`closedByEvidence\` requires product-facing proof: \`post_deploy_smoke\`, \`screenshot\`, \`vision_qa\`, or \`manual_note\`. Unit/integration/source/code inspection is implementation evidence only and must not close the source intent row.
    - For a removed asset/reference row, use \`closedByEvidence\` with \`kind: "code_inspection"\`, \`result: "pass"\`, and a ref/summary that names the accepted spec section proving the asset/reference is absent.
18. Do NOT create separate analysis/design-only tasks as ceremonial work. Use \`requiredRolePasses\` on the implementation task instead:
    - \`"product"\` for complex/ambiguous product behavior, user flows, edge cases, feature priority or acceptance semantics.
    - \`"ux"\` for UI, layout, interaction, animation, responsive, accessibility, visual hierarchy or gameplay-feel work.
    - Omit the field or use \`[]\` when the accepted diff is mechanically obvious.
{{visualEvidencePlannerRule}}
`;

export const EXECUTOR_AUTONOMOUS_INSTRUCTIONS_TEMPLATE = `# Instructions
You are Ralph's executor for one project task. Implement the current task only,
using the accepted spec/diff and task acceptance criteria as the product truth.

Variation seed: {{seed}} — use this to vary your implementation choices, naming conventions, visual style, and code structure. Do not mention the seed in your output.
{{timeBudget}}
## Work Rules

- Work on one task at a time; do not work ahead into later planned tasks.
- Make small product changes and keep generated output out of git.
- Verify only the current task: run its focused checks plus the build. Regression across all previous tasks is the controller's audit job, not every iteration. Re-run a check at most once after a fix; never loop the same smoke test many times.
- The preview server serves the build output (e.g. \`dist/\`). Do NOT run the production build against that served directory during checks — build to a separate output dir/port so tests never read a half-written \`dist\`.
- If a required secret is missing, request it before writing code that depends on fake production behavior. Continue safe work that does not require it.
- The orchestrator starts the app with \`npm start\` and \`PORT\`; do not hardcode ports or deploy manually.
- Runtime is an isolated node:20-slim container with localhost networking and sudo. Install only app/runtime dependencies required by the task.
- Runtime app data belongs in \`ARENA_DATA_DIR\` (default \`/data\`), not in source paths under \`/workspace\`. Put SQLite DBs, uploads, generated videos/media, thumbnails, app cache, and temporary user artifacts there.
- Do not delete SQLite/DB files in startup scripts or to force clean seed state. Fix seed/migration code to be idempotent and preserve user data.
- Do NOT install browser/verification infrastructure inside the project workspace: no system Chromium/Chrome package, no Playwright browser download, no \`npx playwright install\`, no \`playwright install-deps\`, and no equivalent browser setup. Browser readiness belongs to the Arena worker image/platform.
- If Playwright/browser verification cannot run because the browser is missing or its OS deps are unavailable, document \`INFRA_BROWSER_UNAVAILABLE\` and continue with non-browser checks where possible. Do not treat missing platform browser readiness as a product bug.
- If you start a local server for testing, stop it before finishing.

## Current Truth

- Accepted spec/diff and current task criteria outrank historical task completion.
- If the spec is ambiguous, choose the best implementable interpretation and state it briefly; do not stop unless no meaningful progress is possible.

## Verification Failures

If a verification section appears, fix failures caused by your task. If a failure is pre-existing, unrelated, or infrastructure-like, document that and continue when the task itself is complete.

## Off-limits
- Do NOT edit arbitrary files inside the \`.arena/\` directory.
- Do NOT edit \`.ralph/plan.json\`, \`.ralph/ralph-progress.json\`, \`.ralph/iteration-log.json\`, \`.ralph/controller-reports/\`, or \`.ralph/agent-logs/\`.
- The \`.ralph/\` files above are loop-owned bookkeeping. Do not manufacture task completion or feedback closure evidence by editing them; Ralph records verificationEvidence after your product/test work verifies the task.
- Do NOT edit \`.ralph/task-skills/\`; those files are read-only role instructions.
- If the current task section names a \`.ralph/tasks/<task-id>/\` folder, write/update \`plan.md\` there before product code changes. You may also write the named task-local role notes there. That folder is private working context, not product source code and not closure evidence.
- The required app bootstrap contract is \`arena-start.sh\` in the workspace root.
- Do NOT create any other meta-files in \`.arena/\`; only use the documented contract files.
- Do NOT create meta-files like TASK_COMPLETE.txt, DOCKER_SETUP.md, or similar. Only create files that are part of the actual project.
- When writing e2e or integration tests, NEVER modify project configuration files (vite.config, tsconfig, package.json, webpack.config, etc.). Only add test files. Changing configs to fix tests often breaks the production build.

## Completion Signal

When the current task is complete, relevant checks have passed or unrelated failures are documented, output this exact line:

<promise>{{completionPromise}}</promise>

The line must be outside code blocks and must use the exact \`<promise>\` tags.

## Replan Signal
If the task cannot make meaningful progress because it is too vague, blocked by missing required information, or needs a different decomposition, output:

<signal>NEEDS_REPLAN</signal>

Use replan only when you cannot proceed; otherwise make the best implementable change.
`;

export const EXECUTOR_AGENT_PROMPT_TEMPLATE = `{{contextSections}}`;

export const CONTROLLER_AUDIT_PROMPT_TEMPLATE = `# Role: Project Controller (Auditor)

You are auditing the progress of an autonomous coding project.
Your job: compare WHAT WAS ASKED (spec) vs WHAT WAS BUILT (current state).

## Trigger
This audit was triggered by: **{{trigger}}**

## Original Spec
{{spec}}

## Current Plan
\`\`\`json
{{planJson}}
\`\`\`

## Recent Iteration History
{{historyText}}

## Project Snapshot (current file state)
{{projectSnapshot}}
{{visionReportBlock}}
{{feedbackMatrixBlock}}
## Your Job

1. **GAPS**: Things the spec requires but NO task covers (or task is insufficient)
2. **RISKS**: Tasks done but might not work end-to-end (e.g., seed data in Docker)
3. **WASTE**: Tasks not needed or duplicated
4. **JUDGMENT REVIEW**: Are any existing judgments wrong? Should they be revised?

## Ralph Runtime Boundary

- Do NOT add tasks to create, write, read, or verify \`.arena/result.json\`.
- \`.arena/result.json\` is a loop/runner terminal signal. Ralph writes it in \`finalize()\` after the final controller audit succeeds or pauses/fails.
- During final audit, absence of \`.arena/result.json\` is normal and is NOT a product gap.
- Audit product readiness via source files, \`arena-start.sh\`, build/start behavior, and health endpoints instead.

## External Integration and Secret Readiness

- A healthy HTTP preview proves only that the process is running. It does not prove that external integrations required by the spec are live.
- If the spec's core behavior depends on an external API, bot, provider, webhook, database, or credential, missing real integration evidence is a product gap unless the spec explicitly accepts a local/demo-only result.
- Required secrets for core product behavior, production integration, or final verification must be represented honestly in warnings and implementable follow-up tasks. Use judgments only for real product/spec ambiguity. Do not claim a real integration is live only because a local, fake, mocked, or offline adapter can continue development.
- Use non-blocking secrets only for optional extras that are not required to complete the product as specified.

## Controller Authority Boundary

- Do NOT stop project lifecycle for product ambiguity, missing production proof, unclear provider choice, or acceptance uncertainty.
- For real product ambiguity, Ralph should make the best implementable product judgment, record it, and keep moving.
- If a gap is implementable, return \`revise\` with concrete tasks.
- If no implementable work remains and the only issue is weak/missing proof, return \`continue\` with explicit \`overclaimWarnings\`, not \`newJudgments\`.
- Use \`newJudgments\` only for actual product/spec ambiguity, not for \`implemented_unverified\`, missing production proof, or "needs confirmation".
- Do not turn missing production proof, implemented-but-unverified work, or "needs confirmation" into a public assumption/action-required review. Those are loop evidence unless they expose concrete work.
- Lifecycle blockers such as budget, provider rate limits, infra failures, or platform-managed secrets are owned by runtime/platform paths, not by controller product judgment.

## Output Format

Return EXACTLY one JSON block in \`\`\`json ... \`\`\` fences:

\`\`\`json
{
  "verdict": "continue" | "revise",
  "summary": "One paragraph explaining the verdict",
  "overclaimWarnings": [],
  "planChanges": [
    { "action": "addTask", "phaseId": "phase-X", "task": { "id": "task-NNN", "displayTitle": "Short title", "description": "...", "acceptanceCriteria": ["..."], "status": "pending", "priority": 5, "dependencies": [], "estimatedComplexity": "medium", "attempts": 0, "addedBy": "controller" } },
    { "action": "removeTask", "taskId": "task-NNN" },
    { "action": "updateTask", "taskId": "task-NNN", "changes": { "displayTitle": "Short title", "description": "updated...", "dependencies": ["task-010"] } }
  ],
  "newJudgments": [
    {
      "id": "judgment-NNN",
      "timestamp": "{{judgmentTimestamp}}",
      "ambiguity": "...",
      "options": ["A", "B"],
      "chosen": 0,
      "reasoning": "...",
      "madeBy": "controller"
    }
  ],
  "revisedJudgments": [
    { "id": "judgment-001", "newChoice": 1, "reasoning": "..." }
  ]
}
\`\`\`

{{e2ePolicyBlock}}

## QA Test Policy
Tasks with IDs starting with "qa-" are managed by the QA Planner module.
- DO NOT remove, modify, or re-prioritize qa-* tasks — they are outside your scope
- DO NOT create judgments about whether QA tests should exist — this is a system-level policy
- If qa-* tasks seem redundant or problematic, ignore them — the QA Planner handles it

## Replan Policy
When this audit is triggered by **replan** (a task failed after max retries or the loop is stuck):
- Look at which tasks are marked "failed" and WHY (check lastError, iteration history)
- Decide: should the failed task be **split into smaller subtasks**? Or **replaced with an alternative approach**?
- Use "updateTask" to reset a failed task's status to "pending" if you rewrite its description
- Use "addTask" to add replacement subtasks and "removeTask" to remove the original if splitting
- If the failure is due to a missing dependency or wrong ordering, fix the dependencies
- Always provide a verdict of "revise" with concrete planChanges

## Rules
- If everything is on track → verdict: "continue", empty planChanges
- If you find gaps or risks → verdict: "revise", describe changes
- Do not use a controller verdict to block or pause the project. If the project has product ambiguity, record a judgment. If the issue is missing external proof or weak evidence, use \`overclaimWarnings\`. Add implementable tasks if available, and keep the loop moving.
- Do NOT change completed tasks.
- Do NOT remove or edit \`in_progress\` tasks. They are active WIP owned by the executor session; add follow-up work or let the executor reconcile the active task.
- A phase with planLater=true and tasks=[] is NOT completed work, even if the stored phase status says "completed"; if it covers current spec requirements, verdict: "revise" and add concrete implementation tasks
- Do not treat planLater as product deferral unless the current spec explicitly says that scope is deferred or out of scope
- DO NOT create tasks for \`.arena/result.json\`; it is lifecycle-owned by Ralph, not executor/product work
- DO NOT remove or modify e2e-* or qa-* tasks (managed by system modules)
- Current accepted feedback items from the feedback matrix are not evidence-closed merely because a similar historical task is completed
- Only concrete target evidence can evidence-close a current feedback item; generic task completion, lint, build, or typecheck status is not enough
- If current feedback is implemented but not evidence-closed and no implementable work remains, return \`continue\` with an \`overclaimWarnings\` entry instead of creating another verification-only task or judgment
- Frontend \`sourceEvidence\` keeps proof strict, but it does not make missing proof an automatic task source. Return \`revise\` only when current product behavior is still wrong or concrete implementable work remains; otherwise keep the proof gap in \`overclaimWarnings\`.
- New task IDs: use the next available number after existing task IDs
- Be SPECIFIC in task descriptions — the executor agent needs clear instructions
- For judgment IDs: use the next available number after existing judgment IDs
- For task priority: use only critical=1, high=3, medium=5 (lower number = higher priority)
- Default to medium (5); use high (3) for major usability blockers and critical (1) for app-breaking issues
`;

export function renderProjectGoalSection(projectGoal: string): string {
  return renderRepositoryTemplate(PROJECT_GOAL_SECTION_TEMPLATE, { projectGoal });
}

export function renderReferenceSection(input: { specPath: string; planSummary?: string }): string {
  return renderRepositoryTemplate(REFERENCE_SECTION_TEMPLATE, {
    specPath: input.specPath,
    planSummary: input.planSummary ?? 'Progress: not available',
  });
}

export function renderExecutorErrorsSection(errors: string[]): string {
  const heading = errors.some(error => error.includes('DEPLOY ERROR'))
    ? '# Deploy Error (verification passed, Docker failed)'
    : '# Errors to Fix';

  return renderRepositoryTemplate(EXECUTOR_ERRORS_SECTION_TEMPLATE, {
    heading,
    errors: errors.join('\n\n'),
  });
}

export function renderExecutorIterationHistory(history: Array<{
  iteration: number;
  outcome: string;
  filesChanged: string[];
  errors?: string[];
  summary?: string;
}>): string {
  const recent = history.slice(-5);
  const iterationLines = recent.map(entry => {
    const icon = entry.outcome === 'completed' ? '✅'
      : entry.outcome === 'verification_failed' ? '❌ verify'
      : entry.outcome === 'deploy_failed' ? '🐳 deploy'
      : entry.outcome === 'error' ? '💥'
      : '⏭️';

    const files = entry.filesChanged.length > 0
      ? ` | files: ${entry.filesChanged.slice(0, 5).join(', ')}${entry.filesChanged.length > 5 ? ` +${entry.filesChanged.length - 5} more` : ''}`
      : '';
    const err = entry.errors?.length
      ? `\n     Error: ${entry.errors[0]}`
      : '';
    const sum = entry.summary ? `\n     ${entry.summary}` : '';

    return `  [iter ${entry.iteration}] ${icon} ${entry.outcome}${files}${sum}${err}`;
  }).join('\n\n');

  return renderRepositoryTemplate(EXECUTOR_ITERATION_HISTORY_TEMPLATE, {
    recentCount: String(recent.length),
    iterationLines,
  });
}

export function renderExecutorVerificationSection(result: {
  lint?: { passed: boolean; errors: string[] };
  typecheck?: { passed: boolean; errors: string[] };
  build?: { passed: boolean; errors: string[] };
  unitTests?: { passed: boolean; errors: string[] };
}): string {
  const errors: string[] = [];

  if (result.lint && !result.lint.passed) {
    errors.push('## Lint Errors\n```\n' + result.lint.errors.join('\n') + '\n```');
  }
  if (result.typecheck && !result.typecheck.passed) {
    errors.push('## Type Errors\n```\n' + result.typecheck.errors.join('\n') + '\n```');
  }
  if (result.build && !result.build.passed) {
    errors.push('## Build Errors\n```\n' + result.build.errors.join('\n') + '\n```');
  }
  if (result.unitTests && !result.unitTests.passed) {
    errors.push('## Test Failures\n```\n' + result.unitTests.errors.join('\n') + '\n```');
  }

  return renderRepositoryTemplate(EXECUTOR_VERIFICATION_SECTION_TEMPLATE, {
    errorBlocks: errors.join('\n\n'),
  });
}

function renderVisualEvidencePlannerRule(mode: VisualEvidenceMode | undefined, context: 'initial' | 'replan' | 'spec_migration'): string {
  const normalizedMode = mode ?? 'off';
  if (normalizedMode === 'off') {
    const number = context === 'replan' ? '11' : '19';
    return `${number}. **Visual evidence mode is off**: do not add Visual Workbench coverage criteria, \`visualEvidenceRequired\`, or proof-only Workbench tasks unless the accepted spec explicitly asks for Visual Workbench source coverage. UI/UX tasks may still use \`"ux"\` in \`requiredRolePasses\` for design quality.`;
  }

  if (normalizedMode === 'required') {
    const number = context === 'replan' ? '11' : '19';
    return `${number}. **Visual evidence mode is required**: when a task changes ordinary DOM/web UI features, widgets, screens, controls, layout, responsive states, animations or visible bug behavior, include \`"ux"\` in \`requiredRolePasses\`, set \`"visualEvidenceRequired": true\`, and include acceptance criteria that create or update source-owned Visual Workbench coverage in \`visual-workbench/manifest.json\` and \`visual-workbench/stories/\` for the affected feature/widget/states. Do NOT split this into a separate proof-only task. Do NOT force this for backend-only work or canvas/WebGL/Three.js/Roblox/Unity-style surfaces. Missing stories are coverage gaps, not a reason to fall back to unrelated page screenshots.`;
  }

  if (context === 'initial') {
    return '19. **Visual evidence mode is new_tasks_only**: all tasks you create in this initial plan are new. For newly created ordinary DOM/web frontend tasks, include `"ux"` in `requiredRolePasses`, set `"visualEvidenceRequired": true`, and include acceptance criteria that create or update source-owned Visual Workbench coverage in `visual-workbench/manifest.json` and `visual-workbench/stories/` for the affected feature/widget/states. Do NOT split this into a separate proof-only task. Do NOT force this for backend-only work or canvas/WebGL/Three.js/Roblox/Unity-style surfaces.';
  }

  if (context === 'replan') {
    return '11. **Visual evidence mode is new_tasks_only**: only newly added ordinary DOM/web frontend tasks should get `"visualEvidenceRequired": true` plus source-owned Visual Workbench acceptance criteria. Do not retrofit completed tasks, active WIP, or existing pending tasks solely to add Workbench coverage. Existing tasks without `visualEvidenceRequired: true` are legacy/non-required for visual evidence.';
  }

  return '19. **Visual evidence mode is new_tasks_only**: for newly added ordinary DOM/web frontend tasks, include `"ux"` in `requiredRolePasses`, set `"visualEvidenceRequired": true`, and include acceptance criteria that create or update source-owned Visual Workbench coverage in `visual-workbench/manifest.json` and `visual-workbench/stories/` for the affected feature/widget/states. Do not update existing open tasks solely to add Workbench coverage; existing tasks without `visualEvidenceRequired: true` are legacy/non-required for visual evidence.';
}

export function renderExecutorTaskSection(input: {
  task: {
    id: string;
    displayTitle?: string;
    addedBy?: string;
    attempts: number;
    description: string;
    acceptanceCriteria: string[];
    lastError?: string;
    requiredRolePasses?: Array<'product' | 'ux'>;
    visualEvidenceRequired?: boolean;
    feedbackItemRefs?: Array<{
      itemId: string;
      diffItemId?: string;
      targetType?: string;
      targetId?: string;
      changeType?: string;
      workImpact?: string;
      workSurface?: string;
      status?: string | null;
      summary?: string;
      sourceRefs?: string[];
      sourceEvidence?: Array<{
        sourceRef: string;
        quote?: string;
        intent?: string;
      }>;
    }>;
  };
  iteration: number;
  taskFolder?: string;
  withScopeBoundary?: boolean;
  visualEvidenceMode?: VisualEvidenceMode;
}): string {
  const linkedRefs = (input.task.feedbackItemRefs ?? [])
    .map(ref => {
      const target = [
        ref.targetType ? `type=${ref.targetType}` : '',
        ref.targetId ? `target=${ref.targetId}` : '',
        ref.changeType ? `change=${ref.changeType}` : '',
        ref.workImpact ? `impact=${ref.workImpact}` : '',
        ref.workSurface ? `surface=${ref.workSurface}` : '',
        ref.status ? `status=${ref.status}` : '',
        ref.diffItemId && ref.diffItemId !== ref.itemId ? `diff=${ref.diffItemId}` : '',
      ].filter(Boolean).join(', ');
      const details = [
        `- ${ref.itemId}${target ? ` (${target})` : ''}`,
        ref.summary ? `  Summary: ${ref.summary}` : '',
        ref.sourceRefs?.length ? `  Source refs: ${ref.sourceRefs.join(', ')}` : '',
        renderSourceEvidenceLines(ref.sourceEvidence),
      ].filter(Boolean);
      return details.join('\n');
    });
  const requiredRolePasses = input.task.requiredRolePasses ?? [];
  const rolePassLines = requiredRolePasses.map((role) => {
    if (role === 'product') {
      return `- product: use \`.ralph/task-skills/product.md\`, then write \`${input.taskFolder}/product.md\`.`;
    }
    return `- ux: use \`.ralph/task-skills/ux.md\`, then write \`${input.taskFolder}/ux.md\`.`;
  });
  const requiresVisualWorkbenchCoverage = requiredRolePasses.includes('ux')
    || (input.task.feedbackItemRefs ?? []).some(ref => ref.workSurface === 'frontend');
  const visualWorkbenchCoverageEnabled = input.visualEvidenceMode === 'required'
    ? requiresVisualWorkbenchCoverage
    : input.visualEvidenceMode === 'new_tasks_only' && input.task.visualEvidenceRequired === true;
  const visualWorkbenchSelectorTokens = buildVisualWorkbenchSelectorTokens(input.task);
  const visualWorkbenchSelectorLine = visualWorkbenchSelectorLineForTask(input.task, visualWorkbenchSelectorTokens);
  const visualWorkbenchBlock = visualWorkbenchCoverageEnabled
    ? [
      '',
      '',
      '## Visual Workbench Coverage',
      '- For ordinary DOM/web frontend work, create or update source-owned `visual-workbench/manifest.json` and `visual-workbench/stories/` entries for the affected feature, widget and important states.',
      '- The manifest root must keep the exact existing v0 contract: `schemaVersion="ra-355.visual-coverage-manifest.v0"`, `projectClass="ordinary_web"`, `workbench.serveCommand`, `workbench.storyRoutePattern`, `coveragePolicy.mode="strict_canary"`, `coveragePolicy.selectionDefault="full_manifest"` and `coveragePolicy.simplificationRequiresEvidence=true`. Do not rename the schema, invent any other `schemaVersion` or omit these v0 root fields.',
      '- Each story must include `id`, `title`, `kind`, `feature`, `widget`, `state`, `claim`, `render.type="workbench_route"`, `render.path`, `mockState.name` and at least one explicit viewport.',
      '- Manifest and story objects are strict. Do not add extra story fields such as `source`; the only optional story fields currently accepted are `interaction`, `waitAfterLoadMs`, `tags` and `taskRelevance`.',
      '- `render.path` must match `workbench.storyRoutePattern` with `:storyId` replaced by the story `id`; for the default pattern `/__visual/:storyId`, story `synth-pad.ready` must render at `/__visual/synth-pad.ready`.',
      visualWorkbenchSelectorLine,
      '- Treat Workbench stories as product-source render recipes. Do not edit `.ralph/` or `.arena/` files to manufacture evidence.',
      '- Missing or broken Workbench stories are coverage gaps. Do not substitute unrelated page screenshots for missing isolated stories.',
      '- This does not apply to backend-only work or canvas/WebGL/Three.js/Roblox/Unity-style surfaces unless the project already has explicit Workbench support for them.',
    ].join('\n')
    : '';
  const taskWorkspaceBlock = input.taskFolder
    ? [
      '',
      '',
      '## Task Workspace',
      `- Folder: \`${input.taskFolder}/\``,
      '- Ralph seeds `brief.md` there for task-local context.',
      '- Before editing product code, write or update `plan.md` there with the local implementation approach and checks.',
      '- Use this folder for concise planning/design/audit notes only. It is not product truth and not closure evidence.',
      ...(rolePassLines.length > 0
        ? [
          '',
          '## Required Role Passes',
          'Before editing product code, complete these role passes:',
          ...rolePassLines,
          '',
          'If your agent environment supports subagents/delegation, ask those role agents for the pass. If it does not, perform the same skill pass yourself. Keep each output short, practical and tied to this task.',
        ]
        : []),
    ].join('\n')
    : '';

  return renderRepositoryTemplate(EXECUTOR_TASK_SECTION_TEMPLATE, {
    taskId: input.task.id,
    iteration: String(input.iteration),
    attempts: String(input.task.attempts),
    description: input.task.description,
    acceptanceCriteria: input.task.acceptanceCriteria.map(criteria => `- ${criteria}`).join('\n'),
    visualWorkbenchBlock,
    taskWorkspaceBlock,
    linkedRefsBlock: linkedRefs.length > 0
      ? [
        '',
        '',
        '## Current Accepted Diff Packet',
        'These rows are the accepted spec/diff truth linked to this task. If task prose is vaguer than this packet, follow this packet.',
        'If source evidence says a visible label/control/state must be absent or replaced, verify absence as well as the new presence.',
        'Source evidence is private implementation context: implement and verify the product outcome, but do not paste raw user quotes or sourceEvidence intent text into app UI/copy.',
        linkedRefs.join('\n'),
      ].join('\n')
      : '',
    expectedEvidenceBlock: linkedRefs.length > 0
      ? [
        '',
        '',
        '## Expected Task Evidence',
        'In your final response, state which linked refs you covered, what product files changed, and which focused checks or smokes you ran.',
        'Do NOT edit `.ralph/plan.json`, `.ralph/agent-logs/*`, `.ralph/controller-reports/*`, or `.arena/*` to manufacture closure evidence; Ralph records runtime evidence after product/test work.',
      ].join('\n')
      : '',
    lastErrorBlock: input.task.lastError ? `\n\n## Last Error\n${input.task.lastError}` : '',
    scopeBoundaryBlock: input.withScopeBoundary
      ? [
        '',
        '',
        '## ⚠️ Scope Boundary',
        'Do ONLY what this task describes. The project has other planned tasks that will be executed after this one — do NOT work ahead.',
        'When all acceptance criteria above are met and relevant tests pass, emit the completion signal IMMEDIATELY. Do not continue to other work.',
      ].join('\n')
      : '',
  });
}

function renderSourceEvidenceLines(evidence: Array<{ sourceRef: string; quote?: string; intent?: string }> | undefined): string {
  if (!evidence?.length) return '';
  return [
    '  Source evidence:',
    ...evidence.map((entry) => {
      const parts = [
        entry.quote ? `quote=${JSON.stringify(compactSingleLine(entry.quote))}` : '',
        entry.intent ? `intent=${JSON.stringify(compactSingleLine(entry.intent))}` : '',
      ].filter(Boolean).join('; ');
      return `    - ${entry.sourceRef}${parts ? `: ${parts}` : ''}`;
    }),
  ].join('\n');
}

function compactSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildVisualWorkbenchSelectorTokens(task: {
  id: string;
  feedbackItemRefs?: Array<{
    itemId: string;
    diffItemId?: string;
    targetId?: string;
  }>;
}): string[] {
  return Array.from(new Set([
    task.id,
    ...(task.feedbackItemRefs ?? []).flatMap(ref => [
      visualWorkbenchCompositeSelectorToken(task.id, ref.itemId),
      visualWorkbenchCompositeSelectorToken(task.id, ref.diffItemId),
      visualWorkbenchCompositeSelectorToken(task.id, ref.targetId),
      ref.itemId,
      ref.diffItemId,
      ref.targetId,
    ]),
  ].map(value => selectorToken(value)).filter(Boolean)));
}

function selectorToken(value: string | undefined): string {
  return (value ?? '').trim();
}

function visualWorkbenchCompositeSelectorToken(taskId: string, value: string | undefined): string {
  const token = selectorToken(value);
  return token ? `${selectorToken(taskId)}#${token}` : '';
}

function visualWorkbenchSelectorLineForTask(task: {
  id: string;
  displayTitle?: string;
  addedBy?: string;
  description: string;
  acceptanceCriteria: string[];
}, visualWorkbenchSelectorTokens: string[]): string {
  if (isVisualWorkbenchSourceRepairPromptTask(task)) {
    return '- This is a Visual Workbench source repair task, not a screenshot evidence owner. Do not put this repair task id or its attached feedback refs in `taskRelevance.defaultFor`; that selects the repair task instead of the product evidence owner. Repair the source-owned Workbench stories so they map to the exact owner selector tokens named in Selector owner guidance, preferably `<taskId>#<acceptedRef>` for multi-ref or ambiguous owners. If no exact owner selector is available, leave that ownership gap visible instead of inventing refs or assigning stories to this repair task.';
  }
  return visualWorkbenchSelectorTokens.length > 0
    ? `- For every story that should be captured for this task, include \`taskRelevance.defaultFor\` with one or more of these exact selector tokens: ${visualWorkbenchSelectorTokens.map(token => `\`${token}\``).join(', ')}. These are the only tokens the selector-readiness stage will use for this task. If this task has more than one accepted ref, prefer the \`<taskId>#<acceptedRef>\` token so screenshot export can select the exact existing task feedback ref.`
    : '- If this task has no accepted diff refs yet, still create/update source-owned stories for the affected feature/widget/state, but automatic screenshot export will stay blocked until Ralph attaches task `feedbackItemRefs`. Do not invent feedback refs or screenshot evidence.';
}

function isVisualWorkbenchSourceRepairPromptTask(task: {
  displayTitle?: string;
  addedBy?: string;
  description: string;
  acceptanceCriteria: string[];
}): boolean {
  if (task.addedBy !== 'controller') return false;
  if ((task.displayTitle ?? '').trim() === 'Repair Visual Workbench coverage') return true;

  const text = [
    task.displayTitle,
    task.description,
    ...task.acceptanceCriteria,
  ].filter(Boolean).join('\n').toLowerCase();
  if (!text.includes('visual workbench') && !text.includes('visual-workbench')) return false;

  return text.includes('source coverage repair')
    || text.includes('repair source-owned visual workbench coverage')
    || text.includes('visual workbench source repair')
    || text.includes('selector_readiness_blocked')
    || ((text.includes('repair') || text.includes('fix')) && text.includes('selector'));
}

export function renderExecutorActiveWipReconciliation(): string {
  return EXECUTOR_ACTIVE_WIP_RECONCILIATION_TEMPLATE;
}

export function renderExecutorSecretsSection(input: {
  isArenaRuntime: boolean;
  hasArenaSecretsFile: boolean;
}): string | null {
  if (!input.isArenaRuntime && !input.hasArenaSecretsFile) {
    return null;
  }

  if (!input.isArenaRuntime) {
    return renderRepositoryTemplate(EXECUTOR_SECRETS_SECTION_TEMPLATE, {
      arenaSecretsPresence: '',
      secretsInstructions: [
        '- Read existing values from env first; use `.env.arena-secrets` only as a local source file.',
        '- Never commit, rename, or print secret values into source files, logs, tests, or markdown.',
      ].join('\n'),
    });
  }

  return renderRepositoryTemplate(EXECUTOR_SECRETS_SECTION_TEMPLATE, {
    arenaSecretsPresence: input.hasArenaSecretsFile
      ? ' (present in this run)'
      : ' (may appear depending on the run)',
    secretsInstructions: [
      '- If a required secret is missing, run `node /arena/request-secrets.js SECRET_KEY "What this secret is for"`.',
      '- Missing required secrets are blocking by default. Use `--non-blocking` only for optional extras.',
      '- Continue safe work that does not need the real value; if blocked, state which secret blocks completion.',
      '- Never commit, hardcode, echo, print, or log secret values.',
    ].join('\n'),
  });
}

export function renderExecutorAutonomousInstructions(input: {
  completionPromise: string;
  seed: string;
  iterationTimeoutMinutes?: number;
}): string {
  const minutes = input.iterationTimeoutMinutes;
  const timeBudget = minutes && Number.isFinite(minutes) && minutes > 0
    ? `\n## Iteration Time Budget\nThis iteration is hard-limited to ${minutes} minutes of agent wall-clock; after that it is killed and treated as a task failure. Reserve the final few minutes to finish and save your edits to disk, then output the completion signal — the loop commits your work for you; never run \`git commit\` yourself. Do not start verification you cannot finish inside the budget — a completed task with smaller documented checks beats a kill mid-verification.\n`
    : '';
  return renderRepositoryTemplate(EXECUTOR_AUTONOMOUS_INSTRUCTIONS_TEMPLATE, {
    completionPromise: input.completionPromise,
    seed: input.seed,
    timeBudget,
  });
}

export function renderExecutorAgentPrompt(contextSections: string): string {
  return renderRepositoryTemplate(EXECUTOR_AGENT_PROMPT_TEMPLATE, {
    contextSections,
  });
}

export function renderControllerAuditPrompt(input: {
  trigger: string;
  spec: string;
  planJson: string;
  historyText: string;
  projectSnapshot: string;
  visionReportBlock: string;
  feedbackMatrixBlock: string;
  judgmentTimestamp: string;
  e2ePolicyBlock: string;
}): string {
  return renderRepositoryTemplate(CONTROLLER_AUDIT_PROMPT_TEMPLATE, input);
}

export function renderPlannerReplanPrompt(input: {
  reason: string;
  seed: string;
  previousErrorBlock: string;
  spec: string;
  currentPlanJson: string;
  visualEvidenceMode?: VisualEvidenceMode;
}): string {
  return renderRepositoryTemplate(PLANNER_REPLAN_PROMPT_TEMPLATE, {
    ...input,
    visualEvidencePlannerRule: renderVisualEvidencePlannerRule(input.visualEvidenceMode, 'replan'),
  });
}

export function renderPlannerInitialPrompt(input: {
  seed: string;
  previousErrorBlock: string;
  projectName: string;
  projectDescription: string;
  techStack: string;
  deployBlock: string;
  repositoryBlock: string;
  spec: string;
  acceptedDiffDispositionsBlock?: string;
  acceptedDiffOutputField?: string;
  acceptedDiffPlannerRules?: string;
  existingProjectFilesBlock: string;
  judgmentTimestamp: string;
  visualEvidenceMode?: VisualEvidenceMode;
}): string {
  return renderRepositoryTemplate(PLANNER_INITIAL_PROMPT_TEMPLATE, {
    ...input,
    acceptedDiffDispositionsBlock: input.acceptedDiffDispositionsBlock ?? '',
    acceptedDiffOutputField: input.acceptedDiffOutputField ?? '',
    acceptedDiffPlannerRules: input.acceptedDiffPlannerRules ?? '',
    visualEvidencePlannerRule: renderVisualEvidencePlannerRule(input.visualEvidenceMode, 'initial'),
  });
}

export function renderPlannerSpecMigrationPrompt(input: {
  previousErrorBlock: string;
  projectName: string;
  projectDescription: string;
  techStack: string;
  specLabel: string;
  newSpec: string;
  requiredFeedbackDispositionsBlock: string;
  currentPlanJson: string;
  nextTaskId: string;
  feedbackDispositionExample: string;
  concreteClosureEvidenceKinds: string;
  nextJudgmentId: string;
  judgmentTimestamp: string;
  visualEvidenceMode?: VisualEvidenceMode;
}): string {
  return renderRepositoryTemplate(PLANNER_SPEC_MIGRATION_PROMPT_TEMPLATE, {
    ...input,
    visualEvidencePlannerRule: renderVisualEvidencePlannerRule(input.visualEvidenceMode, 'spec_migration'),
  });
}

export function renderE2EApplicabilityPrompt(specContent: string, packageJson: string): string {
  return renderRepositoryTemplate(E2E_APPLICABILITY_PROMPT_TEMPLATE, {
    specContent: specContent.slice(0, 3000),
    packageJson: packageJson.slice(0, 1000) || '(not yet created)',
  });
}

export function renderQAPlannerSelectTasksPrompt(input: {
  specContent: string;
  taskList: string;
  remainingSlots: number;
}): string {
  return renderRepositoryTemplate(QA_PLANNER_SELECT_TASKS_TEMPLATE, {
    remainingSlots: String(input.remainingSlots),
    specContent: truncateWithNotice(input.specContent, 4000),
    taskList: input.taskList,
  });
}

export function renderQATestRequestTaskDescription(input: {
  parentDescription: string;
  steps: Array<{ question: string }>;
  specSummary?: string;
}): string {
  return renderRepositoryTemplate(QA_TEST_REQUEST_TASK_TEMPLATE, {
    parentDescription: input.parentDescription,
    specSummary: input.specSummary ? `\n## Project Context\n${input.specSummary}\n` : '',
    steps: input.steps.map(step => `- ${step.question}`).join('\n'),
  });
}

function renderRepositoryTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.split(`{{${key}}}`).join(value),
    template,
  );
}

function truncateWithNotice(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n... (truncated)` : text;
}

function repositoryConstant(text: string): PromptRepositoryTemplateBody {
  return {
    source: 'prompt_repository',
    format: 'markdown',
    text,
    placeholders: [],
  };
}

function repositoryTemplate(text: string, placeholders: string[]): PromptRepositoryTemplateBody {
  return {
    source: 'prompt_repository',
    format: 'markdown_template',
    text,
    placeholders,
  };
}

function runtimeArtifactPreview(text: string, placeholders: string[], note?: string): PromptRepositoryBodyPreview {
  return {
    source: 'runtime_artifact_description',
    format: 'markdown_template',
    text,
    placeholders,
    ...(note ? { note } : {}),
  };
}

const PROMPT_REPOSITORY_SOURCES: readonly PromptRepositoryEntrySource[] = [
  {
    id: 'planner.initial',
    title: 'Initial autonomous project plan',
    owner: 'planner',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'PLANNER_INITIAL_PROMPT_TEMPLATE',
    },
    variables: ['spec', 'project', 'projectContext', 'acceptedDiffDispositions', 'previousError', 'seed'],
    visibility: 'admin_raw',
    description: 'Builds the first execution plan from an accepted spec and optional existing project context.',
    descriptionRu: 'Собирает первый execution plan из accepted spec и, если есть, текущего контекста проекта.',
    notes: ['Includes a variation seed and embeds the canonical JSON plan schema.'],
    templateBody: repositoryTemplate(PLANNER_INITIAL_PROMPT_TEMPLATE, [
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
    ]),
  },
  {
    id: 'planner.replan',
    title: 'Plan revision',
    owner: 'planner',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'PLANNER_REPLAN_PROMPT_TEMPLATE',
    },
    variables: ['spec', 'currentPlan', 'project', 'reason', 'previousError', 'seed'],
    visibility: 'admin_raw',
    description: 'Revises an existing plan after failures, stuck loops or explicit replanning triggers.',
    descriptionRu: 'Пересобирает существующий plan после ошибок, зависших loop-ов или явного replanning.',
    templateBody: repositoryTemplate(PLANNER_REPLAN_PROMPT_TEMPLATE, [
      'reason',
      'seed',
      'previousErrorBlock',
      'spec',
      'currentPlanJson',
      'visualEvidencePlannerRule',
    ]),
  },
  {
    id: 'planner.specMigration',
    title: 'Accepted spec migration',
    owner: 'planner',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'PLANNER_SPEC_MIGRATION_PROMPT_TEMPLATE',
    },
    variables: [
      'newSpec',
      'currentPlan',
      'project',
      'nextTaskNumber',
      'nextJudgmentNumber',
      'specLabel',
      'requiredFeedbackItems',
      'previousError',
    ],
    visibility: 'admin_raw',
    description: 'Updates an existing Ralph plan when a newer accepted spec arrives from Arena.',
    descriptionRu: 'Обновляет существующий Ralph plan, когда из Arena приходит новая accepted spec.',
    notes: ['Owns feedback disposition instructions for current accepted implementation feedback.'],
    templateBody: repositoryTemplate(PLANNER_SPEC_MIGRATION_PROMPT_TEMPLATE, [
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
    ]),
  },
  {
    id: 'executor.autonomousInstructions',
    title: 'Autonomous executor instructions',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'EXECUTOR_AUTONOMOUS_INSTRUCTIONS_TEMPLATE',
    },
    variables: ['completionPromise', 'seed'],
    visibility: 'admin_raw',
    description: 'Base runtime instructions for spec-driven autonomous execution.',
    descriptionRu: 'Базовые runtime-инструкции для автономного выполнения от spec.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(EXECUTOR_AUTONOMOUS_INSTRUCTIONS_TEMPLATE, [
      'seed',
      'completionPromise',
    ]),
  },
  {
    id: 'executor.agentPrompt',
    title: 'Rendered executor agent prompt',
    owner: 'executor',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'EXECUTOR_AGENT_PROMPT_TEMPLATE',
    },
    variables: ['contextSections'],
    visibility: 'admin_raw',
    description: 'The complete prompt rendered for the coding agent in a Ralph loop iteration.',
    descriptionRu: 'Полный prompt, который получает coding agent внутри одной итерации Ralph loop.',
    notes: ['Composed from multiple executor context sections before the agent adapter receives it.'],
    templateBody: repositoryTemplate(EXECUTOR_AGENT_PROMPT_TEMPLATE, [
      'contextSections',
    ]),
  },
  {
    id: 'executor.secretsSection',
    title: 'Project secrets instructions',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'renderExecutorSecretsSection',
    },
    variables: ['workDir', 'ARENA_PROJECT_ID', 'ARENA_GOVERNANCE_URL', '.env.arena-secrets presence'],
    visibility: 'admin_raw',
    description: 'Explains how executor agents request, use and protect platform-provided project secrets.',
    descriptionRu: 'Объясняет, как executor agent запрашивает, использует и защищает platform secrets проекта.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(EXECUTOR_SECRETS_SECTION_TEMPLATE, [
      'arenaSecretsPresence',
      'secretsInstructions',
    ]),
  },
  {
    id: 'executor.taskSection',
    title: 'Current task section',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'renderExecutorTaskSection',
    },
    variables: ['task', 'iteration', 'taskFolder', 'withScopeBoundary', 'visualEvidenceMode'],
    visibility: 'admin_raw',
    description: 'Injects the single active task, acceptance criteria, task workspace, role-pass requirements and optional scope boundary.',
    descriptionRu: 'Добавляет одну активную task, acceptance criteria, task workspace, role-pass requirements и optional scope boundary.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(EXECUTOR_TASK_SECTION_TEMPLATE, [
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
    ]),
  },
  {
    id: 'executor.productSkill',
    title: 'Product task skill',
    owner: 'executor',
    kind: 'task_template',
    templateStatus: 'static_constant',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'PRODUCT_SKILL_TEMPLATE',
    },
    variables: [],
    visibility: 'admin_raw',
    description: 'Task-local role skill for product intent, scenario and edge-case analysis before implementation.',
    descriptionRu: 'Task-local product skill для продуктового смысла, сценария и edge cases перед реализацией.',
    usedByEntryIds: [EXECUTOR_TASK_SECTION_ENTRY_ID],
    templateBody: repositoryConstant(PRODUCT_SKILL_TEMPLATE),
  },
  {
    id: 'executor.uxSkill',
    title: 'UX task skill',
    owner: 'executor',
    kind: 'task_template',
    templateStatus: 'static_constant',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'UX_SKILL_TEMPLATE',
    },
    variables: [],
    visibility: 'admin_raw',
    description: 'Task-local role skill for UI, interaction, attention budget, responsive and gameplay-feel design before implementation.',
    descriptionRu: 'Task-local UX skill для UI, interaction, экономии внимания, responsive и gameplay-feel дизайна перед реализацией.',
    usedByEntryIds: [EXECUTOR_TASK_SECTION_ENTRY_ID],
    templateBody: repositoryConstant(UX_SKILL_TEMPLATE),
  },
  {
    id: 'executor.activeWipReconciliation',
    title: 'Active WIP reconciliation',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'renderExecutorActiveWipReconciliation',
    },
    variables: ['task.status'],
    visibility: 'admin_raw',
    description: 'Tells the executor to complete, adapt or clean up an already-started task before any new work.',
    descriptionRu: 'Объясняет executor, что уже начатую task нужно честно завершить, адаптировать или очистить перед новой работой.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryConstant(EXECUTOR_ACTIVE_WIP_RECONCILIATION_TEMPLATE),
  },
  {
    id: 'executor.communityQAContext',
    title: 'Community QA execution context',
    owner: 'executor',
    kind: 'static_context',
    templateStatus: 'static_constant',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'COMMUNITY_QA_CONTEXT_TEMPLATE',
    },
    variables: [],
    visibility: 'safe_summary',
    description: 'Static instructions injected when an executor is working on a qa-* task.',
    descriptionRu: 'Статические инструкции, которые добавляются executor-у при работе над qa-* task.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryConstant(COMMUNITY_QA_CONTEXT_TEMPLATE),
  },
  {
    id: 'executor.projectGoalSection',
    title: 'Project goal section',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'PROJECT_GOAL_SECTION_TEMPLATE',
    },
    variables: ['projectGoal'],
    visibility: 'safe_summary',
    description: 'Adds the plan-level product goal to executor context.',
    descriptionRu: 'Добавляет product goal из plan в executor context.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(PROJECT_GOAL_SECTION_TEMPLATE, ['projectGoal']),
  },
  {
    id: 'executor.referenceSection',
    title: 'Spec and plan references',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'REFERENCE_SECTION_TEMPLATE',
    },
    variables: ['specPath', 'planSummary'],
    visibility: 'safe_summary',
    description: 'Points the executor to read-only spec and plan files for deeper context.',
    descriptionRu: 'Показывает executor-у read-only ссылки на spec и plan для более глубокого контекста.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(REFERENCE_SECTION_TEMPLATE, ['specPath', 'planSummary']),
  },
  {
    id: 'executor.errorsSection',
    title: 'Previous errors section',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'renderExecutorErrorsSection',
    },
    variables: ['errors'],
    visibility: 'admin_raw',
    description: 'Shows previous errors the executor should account for in the current iteration.',
    descriptionRu: 'Показывает прошлые ошибки, которые executor должен учесть в текущей итерации.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(EXECUTOR_ERRORS_SECTION_TEMPLATE, ['heading', 'errors']),
  },
  {
    id: 'executor.iterationHistory',
    title: 'Recent iteration history',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'renderExecutorIterationHistory',
    },
    variables: ['history'],
    visibility: 'safe_summary',
    description: 'Summarizes recent attempts so the executor does not repeat failed approaches.',
    descriptionRu: 'Кратко показывает последние попытки, чтобы executor не повторял неудачные подходы.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(EXECUTOR_ITERATION_HISTORY_TEMPLATE, ['recentCount', 'iterationLines']),
  },
  {
    id: 'executor.verificationSection',
    title: 'Verification failures section',
    owner: 'executor',
    kind: 'context_section',
    templateStatus: 'section_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'renderExecutorVerificationSection',
    },
    variables: ['verificationResult'],
    visibility: 'admin_raw',
    description: 'Adds focused lint, typecheck, build or test failures from the verification pipeline.',
    descriptionRu: 'Добавляет сфокусированные lint/typecheck/build/test failures из verification pipeline.',
    usedByEntryIds: USED_BY_EXECUTOR_AGENT_PROMPT,
    templateBody: repositoryTemplate(EXECUTOR_VERIFICATION_SECTION_TEMPLATE, ['errorBlocks']),
  },
  {
    id: 'controller.audit',
    title: 'Controller product audit',
    owner: 'controller',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'CONTROLLER_AUDIT_PROMPT_TEMPLATE',
    },
    variables: [
      'spec',
      'plan',
      'history',
      'projectSnapshot',
      'trigger',
      'e2eEnabled',
      'visionReport',
      'feedbackMatrix',
    ],
    visibility: 'admin_raw',
    description: 'Audits built product state against the accepted spec and returns continue/revise decisions.',
    descriptionRu: 'Проверяет построенный продукт относительно accepted spec и возвращает решение continue/revise.',
    templateBody: repositoryTemplate(CONTROLLER_AUDIT_PROMPT_TEMPLATE, [
      'trigger',
      'spec',
      'planJson',
      'historyText',
      'projectSnapshot',
      'visionReportBlock',
      'feedbackMatrixBlock',
      'judgmentTimestamp',
      'e2ePolicyBlock',
    ]),
  },
  {
    id: 'controller.e2eApplicability',
    title: 'E2E applicability decision',
    owner: 'controller',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'E2E_APPLICABILITY_PROMPT_TEMPLATE',
    },
    variables: ['specContent', 'packageJson'],
    visibility: 'admin_raw',
    description: 'Asks once whether Playwright e2e tests are useful for the current project type.',
    descriptionRu: 'Один раз решает, полезны ли Playwright e2e tests для текущего типа проекта.',
    templateBody: repositoryTemplate(E2E_APPLICABILITY_PROMPT_TEMPLATE, ['specContent', 'packageJson']),
  },
  {
    id: 'qaPlanner.selectTasks',
    title: 'Community QA task selection',
    owner: 'qa-planner',
    kind: 'llm_prompt',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'QA_PLANNER_SELECT_TASKS_TEMPLATE',
    },
    variables: ['specContent', 'candidateTasks', 'remainingSlots'],
    visibility: 'admin_raw',
    description: 'Selects feature tasks that need human visual/interactive QA coverage.',
    descriptionRu: 'Выбирает feature tasks, которым нужна human visual/interactive QA проверка.',
    templateBody: repositoryTemplate(QA_PLANNER_SELECT_TASKS_TEMPLATE, ['specContent', 'taskList', 'remainingSlots']),
  },
  {
    id: 'qaPlanner.writeTestRequestTask',
    title: 'Community QA test request task',
    owner: 'qa-planner',
    kind: 'task_template',
    templateStatus: 'dynamic_builder',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'QA_TEST_REQUEST_TASK_TEMPLATE',
    },
    variables: ['parentDescription', 'steps', 'specSummary'],
    visibility: 'safe_summary',
    description: 'Builds the generated qa-* plan task body that later becomes executor task context.',
    descriptionRu: 'Собирает тело генерируемой qa-* plan task; когда executor берёт эту task, текст попадает в его task context.',
    usedByEntryIds: [EXECUTOR_TASK_SECTION_ENTRY_ID],
    templateBody: repositoryTemplate(QA_TEST_REQUEST_TASK_TEMPLATE, ['parentDescription', 'specSummary', 'steps']),
  },
  {
    id: 'visionQA.analysis',
    title: 'Visual QA frame analysis',
    owner: 'vision-qa',
    kind: 'llm_prompt',
    templateStatus: 'static_constant',
    source: {
      file: 'packages/loops/ralph-runtime/src/prompts/repository.ts',
      symbol: 'VISION_QA_ANALYSIS_TEMPLATE',
    },
    variables: ['taskDescription', 'criteria', 'selectedFrames'],
    visibility: 'admin_raw',
    description: 'Asks the vision model to inspect e2e video frames and report visual pass/fail evidence.',
    descriptionRu: 'Просит vision model проверить e2e video frames и вернуть visual pass/fail evidence.',
    templateBody: repositoryConstant(VISION_QA_ANALYSIS_TEMPLATE),
  },
] as const;

export function getRalphPromptRepositoryEntries(): PromptRepositoryEntry[] {
  return PROMPT_REPOSITORY_SOURCES.map(materializePromptRepositoryEntry);
}

export function exportRalphPromptRepository(options: { generatedAt?: string } = {}): PromptRepositoryExport {
  return {
    schemaVersion: PROMPT_REPOSITORY_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    owner: PROMPT_REPOSITORY_OWNER,
    bodyContract: clonePromptRepositoryBodyContract(PROMPT_REPOSITORY_BODY_CONTRACT),
    entries: getRalphPromptRepositoryEntries(),
  };
}

function materializePromptRepositoryEntry(source: PromptRepositoryEntrySource): PromptRepositoryEntry {
  return {
    ...source,
    bodyMode: resolvePromptBodyMode(source),
    source: { ...source.source },
    variables: [...source.variables],
    ...(source.notes ? { notes: [...source.notes] } : {}),
    ...(source.usedByEntryIds ? { usedByEntryIds: [...source.usedByEntryIds] } : {}),
    ...(source.templateBody ? { templateBody: clonePromptRepositoryTemplateBody(source.templateBody) } : {}),
    ...(source.bodyPreview ? { bodyPreview: clonePromptRepositoryBodyPreview(source.bodyPreview) } : {}),
  };
}

function resolvePromptBodyMode(source: PromptRepositoryEntrySource): PromptBodyMode {
  if (source.templateBody) {
    return source.templateBody.placeholders.length > 0 ? 'repository_template' : 'repository_constant';
  }
  if (source.templateStatus === 'external_artifact') return 'runtime_artifact';
  throw new Error(`Prompt Repository entry ${source.id} is missing a repository-owned template body`);
}

function clonePromptRepositoryBodyContract(contract: PromptRepositoryBodyContract): PromptRepositoryBodyContract {
  return {
    ...contract,
  };
}

function clonePromptRepositoryTemplateBody(body: PromptRepositoryTemplateBody): PromptRepositoryTemplateBody {
  return {
    ...body,
    placeholders: [...body.placeholders],
  };
}

function clonePromptRepositoryBodyPreview(body: PromptRepositoryBodyPreview): PromptRepositoryBodyPreview {
  return {
    ...body,
    placeholders: [...body.placeholders],
  };
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPONENT_ROOT = fileURLToPath(new URL("./", import.meta.url));

function readComponent(relativePath: string): string {
  return readFileSync(`${COMPONENT_ROOT}/${relativePath}`, "utf8");
}

describe("PromptMapObservedRunsView source contract", () => {
  it("keeps observed runs table-first before run drilldown details", () => {
    const source = readComponent("PromptMapObservedRunsView.tsx");
    const tableGateIndex = source.indexOf("if (!openRun || !openRunRow)");
    const heroIndex = source.indexOf("className={`runHero");

    expect(tableGateIndex).toBeGreaterThan(-1);
    expect(heroIndex).toBeGreaterThan(-1);
    expect(tableGateIndex).toBeLessThan(heroIndex);
  });

  it("keeps Prompt Calls as the minimal prompt-to-output happy path", () => {
    const pageSource = readComponent("PromptMapPage.tsx");
    const callsSource = readComponent("PromptMapCallsView.tsx");

    expect(pageSource).toContain("<PromptMapCallsView");
    expect(pageSource).toContain("calls: { title: \"Prompt Calls\"");
    expect(pageSource).toContain("view === \"calls\" ? \"minimalCalls\" : \"\"");
    expect(callsSource).toContain("buildPromptCallRows(traceMap, prompts)");
    expect(callsSource).toContain("useState<CallTextPanelId>(\"prompt\")");
    expect(callsSource).toContain("useState<CallInfoModal | null>(null)");
    expect(callsSource).toContain("aria-expanded={isActive}");
    expect(callsSource).toContain("label: \"Prompt\"");
    expect(callsSource).toContain("label: \"Output\"");
    expect(callsSource).toContain("getSystemReadModal");
    expect(callsSource).toContain("This is not a project status");
    expect(callsSource).toContain("call evidence, not a project lifecycle verdict");
    expect(pageSource).toContain(".prompt-map .promptOutputGrid{height:100%;min-height:0;display:flex");
    expect(pageSource).toContain(".prompt-map button.systemRead");
    expect(pageSource).toContain(".prompt-map .callMetaLine button");
    expect(callsSource).not.toContain("buildObservedRunSummary");
    expect(callsSource).not.toContain("runHero");
    expect(callsSource).not.toContain("RunStoryTimeline");
  });

  it("keeps the runs table free of run-story detail panels", () => {
    const source = readComponent("PromptMapObservedRunsView.tsx");
    const tableStart = source.indexOf("function ObservedRunsTable");
    const storyStart = source.indexOf("function RunStoryTimeline");

    expect(tableStart).toBeGreaterThan(-1);
    expect(storyStart).toBeGreaterThan(tableStart);

    const tableSource = source.slice(tableStart, storyStart);

    expect(tableSource).toContain("<table className=\"runsTable\">");
    expect(tableSource).not.toContain("runHero");
    expect(tableSource).not.toContain("RunStoryTimeline");
    expect(tableSource).not.toContain("PromptCallStory");
  });

  it("does not auto-select the last trace event when opening Observed Runs", () => {
    const source = readComponent("PromptMapPage.tsx");

    expect(source).toContain("setSelection({ type: \"trace\", id: \"runs\" })");
    expect(source).not.toContain("lastTraceEvent(selectedTraceRun?.events)");
  });

  it("keeps the Loop tab sourced from the runtime export instead of UI-local nodes", () => {
    const pageSource = readComponent("PromptMapPage.tsx");
    const routeSource = readComponent("../../app/(fullscreen)/admin/prompt-map/page.tsx");

    expect(pageSource).toContain("loopMap.nodes");
    expect(pageSource).not.toContain("const LOOP_NODES");
    expect(pageSource).not.toContain("const DECISION_RULES");
    expect(routeSource).toContain("getRalphLoopMap()");
    expect(routeSource).toContain("<PromptMapPage loopMap={loopMap}");
  });

  it("keeps prompt audit as a minimal repository projection", () => {
    const pageSource = readComponent("PromptMapPage.tsx");
    const auditStart = pageSource.indexOf("function PromptAuditCanvas");
    const promptsStart = pageSource.indexOf("function PromptsCanvas");

    expect(pageSource).toContain("audit: { title: \"Аудит\"");
    expect(pageSource).toContain("view === \"audit\"");
    expect(auditStart).toBeGreaterThan(-1);
    expect(promptsStart).toBeGreaterThan(auditStart);

    const auditSource = pageSource.slice(auditStart, promptsStart);

    expect(auditSource).toContain("<PromptRecipeFlow prompt={prompt}");
    expect(auditSource).toContain("formatPromptOwner(prompt.owner, language)");
    expect(auditSource).toContain("language === \"ru\" ? \"В repo\"");
    expect(auditSource).toContain("Runtime artifact");
    expect(auditSource).toContain("runtimeArtifactCount");
    expect(auditSource).not.toContain("\"В коде\"");
    expect(auditSource).not.toContain("\"In code\"");
    expect(auditSource).toContain("getAuditPromptOrder(prompts)");
    expect(auditSource).not.toContain("usageByPromptId");
    expect(auditSource).not.toContain("formatPromptUsageBadge");
    expect(auditSource).not.toContain("formatSource(");
    expect(auditSource).not.toContain("renderPromptPreview");
    expect(auditSource).not.toContain("RawDetails");
  });

  it("keeps the Prompts view definition-first instead of one raw prompt body", () => {
    const pageSource = readComponent("PromptMapPage.tsx");
    const promptsStart = pageSource.indexOf("function PromptsCanvas");
    const inspectorStart = pageSource.indexOf("function LoopInspector");

    expect(promptsStart).toBeGreaterThan(-1);
    expect(inspectorStart).toBeGreaterThan(promptsStart);

    const promptsSource = pageSource.slice(promptsStart, inspectorStart);

    expect(promptsSource).toContain("PromptDefinitionPanel");
    expect(promptsSource).toContain("formatPromptDescription(prompt, language)");
    expect(promptsSource).toContain("copy.prompt.definition");
    expect(promptsSource).toContain("copy.prompt.bodySource");
    expect(promptsSource).toContain("<PromptRelationPanel");
    expect(promptsSource).toContain("getUsedByEntries(prompt, prompts)");
    expect(promptsSource).toContain("buildPromptHierarchy(prompts)");
    expect(promptsSource).toContain("expandedPromptIds");
    expect(promptsSource).toContain("collapsedPromptIds");
    expect(pageSource).toContain(".promptTree");
    expect(pageSource).toContain(".treeToggle");
    expect(pageSource).toContain(".promptTreeChildren.open");
    expect(pageSource).toContain("definition: \"Определение Prompt\"");
    expect(pageSource).toContain("bodySource: \"Источник body\"");
    expect(pageSource).toContain("родительский prompt");
    expect(pageSource).toContain("кусок:");
    expect(pageSource).toContain("usedByEntryIds");
    expect(pageSource).toContain("task_template");
    expect(promptsSource).not.toContain("copy.common.viewRaw");
    expect(promptsSource).not.toContain("copy.prompt.inputs");
    expect(promptsSource).not.toContain("renderPromptPreview");
  });

  it("keeps prompt body variables clickable and highlighted in the body text", () => {
    const pageSource = readComponent("PromptMapPage.tsx");
    const promptsStart = pageSource.indexOf("function PromptsCanvas");
    const inspectorStart = pageSource.indexOf("function LoopInspector");
    const promptsSource = pageSource.slice(promptsStart, inspectorStart);

    expect(promptsSource).toContain("selectedPlaceholder");
    expect(promptsSource).toContain("onVariableSelect={selectPlaceholder}");
    expect(promptsSource).toContain("<PromptBodyText");
    expect(pageSource).toContain("data-placeholder");
    expect(pageSource).toContain("scrollIntoView");
    expect(pageSource).toContain("splitPromptBodyByPlaceholders");
    expect(pageSource).toContain(".bodyVariable");
    expect(pageSource).toContain(".recipeChip.variable.active");
  });

  it("keeps prompt definition explanations scoped to read-only PromptMap UI", () => {
    const pageSource = readComponent("PromptMapPage.tsx");
    const promptsStart = pageSource.indexOf("function PromptsCanvas");
    const inspectorStart = pageSource.indexOf("function LoopInspector");
    const promptsSource = pageSource.slice(promptsStart, inspectorStart);

    expect(pageSource).toContain("type PromptMapModalState");
    expect(promptsSource).toContain("onOpenExplanation");
    expect(promptsSource).toContain("getDefinitionCardTooltip");
    expect(promptsSource).toContain("getBodyExplanation(prompt, body, language)");
    expect(promptsSource).toContain("getTypeExplanation(prompt, language)");
    expect(promptsSource).toContain("getRunsExplanation(prompt, usage, language)");
    expect(pageSource).toContain("className=\"definitionCard interactive\"");
    expect(pageSource).toContain("BODY: где текст");
    expect(pageSource).toContain("Где увидеть точный prompt");
    expect(pageSource).toContain("Это не статус проекта");
    expect(pageSource).toContain("observed trace evidence");
    expect(pageSource).toContain("not a project lifecycle verdict");
    expect(pageSource).not.toContain("prompt editor");
  });
});

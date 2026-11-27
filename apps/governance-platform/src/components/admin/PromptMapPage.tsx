"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  RalphPromptDefinition,
  RalphPromptMap,
} from "@/lib/ralph-prompts";
import type {
  RalphLoopDecision,
  RalphLoopMap,
  RalphLoopNode,
} from "@/lib/ralph-loop-map";
import type {
  PromptTraceEvent,
  RalphPromptTraceMap,
} from "@/lib/ralph-prompt-traces";
import {
  PromptMapCallsView,
  type PromptCallSelection,
} from "@/components/admin/PromptMapCallsView";
import { PromptMapObservedRunsView } from "@/components/admin/PromptMapObservedRunsView";
import {
  buildPromptUsageById,
  formatPromptUsageBadge,
  formatPromptUsageDetail,
  type PromptAttentionItem,
  type PromptMapLanguage,
  type PromptUsageSummary,
} from "@/lib/ralph-prompt-map-projections";

interface PromptMapPageProps {
  loopMap: RalphLoopMap;
  promptMap: RalphPromptMap;
  traceMap: RalphPromptTraceMap;
}

type PromptMapView = "loop" | "audit" | "prompts" | "calls" | "trace";
type Selection =
  | { type: "loop"; id: string }
  | { type: "prompt"; id: string }
  | { type: "call"; id: string }
  | { type: "trace"; id: string };

type PromptMapModalState =
  | { type: "promptRaw"; promptId: string }
  | { type: "explain"; title: string; meta: string; body: string };

interface ExpandedInternal {
  label: string;
  tip?: string;
  promptId?: string;
}

type PromptMapCopy = {
  views: Record<PromptMapView, { title: string; subtitle: string }>;
  nav: Record<string, string>;
  common: Record<string, string>;
  empty: Record<string, string>;
  prompt: Record<string, string>;
  inspector: Record<string, string>;
  rawPreview: Record<string, string>;
};

const PROMPT_MAP_COPY = {
  ru: {
    views: {
      loop: { title: "Loop", subtitle: "runtime export · текущий flow" },
      audit: { title: "Аудит", subtitle: "из чего собирается Prompt" },
      prompts: { title: "Prompts", subtitle: "каталог определений · body отдельно" },
      calls: { title: "Prompt Calls", subtitle: "список · Prompt -> Output" },
      trace: { title: "Observed Runs", subtitle: "записанные prompt calls" },
    },
    nav: {
      audit: "Аудит",
      language: "Язык",
      reset: "сбросить",
    },
    common: {
      close: "закрыть",
      none: "нет",
      prompt: "prompt",
      rawTraceEvent: "raw trace event",
      viewRaw: "сырой вид",
    },
    empty: {
      loopMapTitle: "Loop map не выгружен.",
      loopMapText: "Ralph runtime export не вернул loop nodes.",
      prompt: "Prompt не выбран.",
    },
    prompt: {
      bodyCard: "BODY",
      bodySource: "Источник body",
      bodySourceText: "Только этот блок является body prompt. Всё выше — metadata и схема сборки. Trace показывает уже rendered prompt после подстановок.",
      bodySourceRuntimeText: "Это runtime artifact: точный текст зависит от файлов/состояния конкретного проекта. Prompt Calls показывает фактический rendered prompt.",
      bodySourceMissing: "Body пока не выгружен для просмотра. Фактический Prompt появляется в Prompt Calls после выполнения.",
      definition: "Определение Prompt",
      recipe: "Из чего собирается",
      runs: "ЗАПУСКИ",
      type: "ТИП",
    },
    inspector: {
      decisionOutputs: "decision outputs",
      in: "IN",
      internals: "internals",
      kind: "KIND",
      next: "NEXT",
      notes: "NOTES",
      out: "OUT",
      parseErrors: "PARSE ERRORS",
      promptSource: "PROMPT SOURCE",
      runEvidence: "RUN EVIDENCE",
      runVisibility: "RUN VISIBILITY",
      selectedStep: "SELECTED STEP",
      source: "SOURCE",
      status: "STATUS",
      systemRead: "SYSTEM READ",
      templateStatus: "TEMPLATE",
      openRunPrompt: "Открой Run, чтобы посмотреть prompt calls.",
      promptNotFound: "not found in prompt inventory",
      unknown: "unknown",
      notRecorded: "not recorded",
    },
    rawPreview: {
      body: "body:",
      bodyMode: "body mode",
      inputs: "inputs:",
      kind: "kind",
      notes: "notes:",
      placeholders: "placeholders",
      renderedTrace: "Rendered prompt text lives in Observed Runs after this Prompt executes.",
      source: "source",
      template: "template",
      visibility: "visibility",
    },
  },
  en: {
    views: {
      loop: { title: "Loop", subtitle: "runtime export · current flow" },
      audit: { title: "Audit", subtitle: "what each Prompt is built from" },
      prompts: { title: "Prompts", subtitle: "definition catalog · body separate" },
      calls: { title: "Prompt Calls", subtitle: "list · Prompt -> Output" },
      trace: { title: "Observed Runs", subtitle: "recorded prompt calls" },
    },
    nav: {
      audit: "Audit",
      language: "Language",
      reset: "reset",
    },
    common: {
      close: "close",
      none: "none",
      prompt: "prompt",
      rawTraceEvent: "raw trace event",
      viewRaw: "view raw",
    },
    empty: {
      loopMapTitle: "No loop map exported.",
      loopMapText: "The Ralph runtime export returned no loop nodes.",
      prompt: "No prompt selected.",
    },
    prompt: {
      bodyCard: "BODY",
      bodySource: "Body source",
      bodySourceText: "Only this block is the prompt body. Everything above is metadata and composition. Trace shows the rendered prompt after substitutions.",
      bodySourceRuntimeText: "This is a runtime artifact. Exact text depends on files/state for a concrete project; Prompt Calls shows the rendered prompt.",
      bodySourceMissing: "Body is not exported for viewing yet. The actual Prompt appears in Prompt Calls after execution.",
      definition: "Prompt definition",
      recipe: "Built from",
      runs: "RUNS",
      type: "TYPE",
    },
    inspector: {
      decisionOutputs: "decision outputs",
      in: "IN",
      internals: "internals",
      kind: "KIND",
      next: "NEXT",
      notes: "NOTES",
      out: "OUT",
      parseErrors: "PARSE ERRORS",
      promptSource: "PROMPT SOURCE",
      runEvidence: "RUN EVIDENCE",
      runVisibility: "RUN VISIBILITY",
      selectedStep: "SELECTED STEP",
      source: "SOURCE",
      status: "STATUS",
      systemRead: "SYSTEM READ",
      templateStatus: "TEMPLATE",
      openRunPrompt: "Open a Run to inspect prompt calls.",
      promptNotFound: "not found in prompt inventory",
      unknown: "unknown",
      notRecorded: "not recorded",
    },
    rawPreview: {
      body: "body:",
      bodyMode: "body mode",
      inputs: "inputs:",
      kind: "kind",
      notes: "notes:",
      placeholders: "placeholders",
      renderedTrace: "Rendered prompt text lives in Observed Runs after this Prompt executes.",
      source: "source",
      template: "template",
      visibility: "visibility",
    },
  },
} satisfies Record<PromptMapLanguage, PromptMapCopy>;

const KIND_LABELS: Record<RalphPromptDefinition["kind"], string> = {
  llm_prompt: "prompt",
  context_section: "section",
  static_context: "static",
  runtime_artifact: "runtime",
  task_template: "task template",
};

export function PromptMapPage({ loopMap, promptMap, traceMap }: PromptMapPageProps) {
  const prompts = promptMap.export.entries;
  const firstLoopNode = loopMap.nodes[0] ?? null;
  const [language, setLanguage] = useState<PromptMapLanguage>("ru");
  const [view, setView] = useState<PromptMapView>("loop");
  const [selection, setSelection] = useState<Selection>({
    type: "loop",
    id: firstLoopNode?.id ?? "",
  });
  const [modal, setModal] = useState<PromptMapModalState | null>(null);
  const [selectedTraceRunId, setSelectedTraceRunId] = useState(
    traceMap.runs[0]?.projectId ?? "",
  );
  const [selectedTraceEventId, setSelectedTraceEventId] = useState(
    lastTraceEvent(traceMap.runs[0]?.events)?.eventId ?? "",
  );

  const promptsByOwner = useMemo(() => {
    const grouped = new Map<RalphPromptDefinition["owner"], RalphPromptDefinition[]>();

    for (const prompt of prompts) {
      const existing = grouped.get(prompt.owner) ?? [];
      existing.push(prompt);
      grouped.set(prompt.owner, existing);
    }

    return grouped;
  }, [prompts]);
  const promptsById = useMemo(
    () => new Map(prompts.map((prompt) => [prompt.id, prompt])),
    [prompts],
  );
  const promptUsageById = useMemo(
    () => buildPromptUsageById(traceMap),
    [traceMap],
  );

  const selectedLoopNode =
    selection.type === "loop"
      ? loopMap.nodes.find((node) => node.id === selection.id) ?? firstLoopNode
      : firstLoopNode;
  const selectedPrompt =
    selection.type === "prompt"
      ? prompts.find((prompt) => prompt.id === selection.id) ?? prompts[0] ?? null
      : prompts[0] ?? null;
  const selectedTraceRun =
    traceMap.runs.find((run) => run.projectId === selectedTraceRunId) ??
    traceMap.runs[0] ??
    null;
  const selectedTraceEvent = selectedTraceEventId
    ? selectedTraceRun?.events.find((event) => event.eventId === selectedTraceEventId) ?? null
    : null;
  const selectedTracePrompt = selectedTraceEvent
    ? promptsById.get(selectedTraceEvent.promptId) ?? null
    : null;
  const modalPrompt = modal?.type === "promptRaw"
    ? prompts.find((prompt) => prompt.id === modal.promptId) ?? null
    : null;
  const copy = PROMPT_MAP_COPY[language];
  const modalTitle = modal?.type === "explain"
    ? modal.title
    : modalPrompt?.id ?? "";
  const modalMeta = modal?.type === "explain"
    ? ` · ${modal.meta}`
    : modalPrompt ? ` · ${formatSource(modalPrompt)} · prompt repo` : "";
  const modalBody = modal?.type === "explain"
    ? modal.body
    : modalPrompt ? renderPromptPreview(modalPrompt, copy, language) : "";
  const isModalOpen = Boolean(modalBody);
  const heading = copy.views[view];

  function openView(nextView: PromptMapView) {
    setView(nextView);

    if (nextView === "audit" || nextView === "prompts") {
      setSelection({
        type: "prompt",
        id: nextView === "audit"
          ? getDefaultAuditPrompt(prompts)?.id ?? ""
          : prompts[0]?.id ?? "",
      });
      return;
    }

    if (nextView === "calls") {
      const call = getLatestPromptCall(traceMap);

      if (call) {
        setSelectedTraceRunId(call.run.projectId);
        setSelectedTraceEventId(call.event.eventId);
        setSelection({ type: "call", id: call.event.eventId });
      } else {
        setSelectedTraceEventId("");
        setSelection({ type: "call", id: "calls" });
      }
      return;
    }

    if (nextView === "trace") {
      const run = selectedTraceRun ?? traceMap.runs[0] ?? null;

      if (run) setSelectedTraceRunId(run.projectId);
      setSelectedTraceEventId("");
      setSelection({ type: "trace", id: "runs" });
      return;
    }

    setSelection({ type: "loop", id: firstLoopNode?.id ?? "" });
  }

  function reset() {
    setView("loop");
    setSelection({ type: "loop", id: firstLoopNode?.id ?? "" });
    setModal(null);
  }

  function openPromptModal(promptId: string) {
    setModal({ type: "promptRaw", promptId });
  }

  function selectTraceRun(projectId: string) {
    const run = traceMap.runs.find((candidate) => candidate.projectId === projectId);
    const event = lastTraceEvent(run?.events);

    setSelectedTraceRunId(projectId);
    setSelectedTraceEventId(event?.eventId ?? "");
    setSelection(event ? { type: "trace", id: event.eventId } : { type: "trace", id: projectId });
  }

  function selectTraceEvent(eventId: string) {
    setSelectedTraceEventId(eventId);
    setSelection({ type: "trace", id: eventId });
  }

  function showTraceRunTable() {
    setSelectedTraceEventId("");
    setSelection({ type: "trace", id: "runs" });
  }

  function selectTraceAttentionItem(item: PromptAttentionItem) {
    const run = traceMap.runs.find((candidate) => candidate.projectId === item.projectId);
    const eventId = item.eventId ?? lastTraceEvent(run?.events)?.eventId ?? "";

    setSelectedTraceRunId(item.projectId);
    setSelectedTraceEventId(eventId);
    setSelection({ type: "trace", id: eventId || item.projectId });
  }

  function selectPromptCall(selection: PromptCallSelection) {
    setSelectedTraceRunId(selection.projectId);
    setSelectedTraceEventId(selection.eventId);
    setSelection({ type: "call", id: selection.eventId });
  }

  return (
    <main className={`prompt-map ${view === "calls" ? "minimalCalls" : ""}`}>
      <style>{PROMPT_MAP_CSS}</style>

      <aside className="nav">
        <div className="brand">Ralph</div>
        <NavButton active={view === "loop"} onClick={() => openView("loop")}>
          Loop
        </NavButton>
        <NavButton
          active={view === "audit"}
          onClick={() => openView("audit")}
        >
          {copy.nav.audit}
        </NavButton>
        <NavButton
          active={view === "prompts"}
          onClick={() => openView("prompts")}
        >
          Prompts
        </NavButton>
        <NavButton active={view === "calls"} onClick={() => openView("calls")}>
          Prompt Calls
        </NavButton>
        <NavButton active={view === "trace"} onClick={() => openView("trace")}>
          Observed Runs
        </NavButton>
      </aside>

      <section className="pm-main">
        <div className="top">
          <div>
            <h1>
              {heading.title}
              <span className="sub">{heading.subtitle}</span>
            </h1>
          </div>
          <div className="topActions">
            <button className="btn" type="button" onClick={reset}>
              {copy.nav.reset}
            </button>
            <div className="languageSwitch" aria-label={copy.nav.language}>
              <button
                className={language === "ru" ? "active" : ""}
                type="button"
                onClick={() => setLanguage("ru")}
              >
                RU
              </button>
              <button
                className={language === "en" ? "active" : ""}
                type="button"
                onClick={() => setLanguage("en")}
              >
                EN
              </button>
            </div>
          </div>
        </div>

        <div className="canvas">
          {view === "loop" && (
            <LoopCanvas
              loopMap={loopMap}
              selected={selectedLoopNode}
              onSelect={(node) => setSelection({ type: "loop", id: node.id })}
              copy={copy}
            />
          )}
          {view === "audit" && (
            <PromptAuditCanvas
              prompts={prompts}
              selected={selectedPrompt}
              onSelect={(prompt) =>
                setSelection({ type: "prompt", id: prompt.id })
              }
              language={language}
            />
          )}
          {view === "prompts" && (
            <PromptsCanvas
              prompts={prompts}
              selected={selectedPrompt}
              usageByPromptId={promptUsageById}
              language={language}
              copy={copy}
              onOpenExplanation={setModal}
              onSelect={(prompt) =>
                setSelection({ type: "prompt", id: prompt.id })
              }
            />
          )}
          {view === "calls" && (
            <PromptMapCallsView
              traceMap={traceMap}
              prompts={prompts}
              selectedEventId={selectedTraceEventId}
              onSelectCall={selectPromptCall}
              language={language}
            />
          )}
          {view === "trace" && (
            <PromptMapObservedRunsView
              traceMap={traceMap}
              prompts={prompts}
              selectedEvent={selectedTraceEvent}
              onSelectRun={selectTraceRun}
              onSelectEvent={selectTraceEvent}
              onShowRunTable={showTraceRunTable}
              onSelectAttentionItem={selectTraceAttentionItem}
              onOpenPromptDefinition={openPromptModal}
              language={language}
            />
          )}
        </div>
      </section>

      <aside className="inspector">
        <div className="head">
          <h2>{getInspectorTitle(selection, selectedLoopNode, selectedPrompt, selectedTraceEvent)}</h2>
        </div>
        <div className="body">
          {selection.type === "loop" && selectedLoopNode && (
            <LoopInspector
              node={selectedLoopNode}
              decisions={loopMap.decisions.filter((decision) => decision.nodeId === selectedLoopNode.id)}
              promptsByOwner={promptsByOwner}
              onOpenPrompt={openPromptModal}
              language={language}
              copy={copy}
            />
          )}
          {selection.type === "prompt" && selectedPrompt && (
            view === "audit" ? (
              <PromptAuditInspector prompt={selectedPrompt} language={language} copy={copy} />
            ) : (
              <PromptInspector
                prompt={selectedPrompt}
                usage={promptUsageById.get(selectedPrompt.id)}
                language={language}
                copy={copy}
                onOpenPrompt={openPromptModal}
              />
            )
          )}
          {selection.type === "trace" && (
            <TraceInspector
              event={selectedTraceEvent}
              run={selectedTraceRun}
              promptDefinition={selectedTracePrompt}
              language={language}
              copy={copy}
            />
          )}
          {selection.type === "call" && (
            <TraceInspector
              event={selectedTraceEvent}
              run={selectedTraceRun}
              promptDefinition={selectedTracePrompt}
              language={language}
              copy={copy}
            />
          )}
        </div>
      </aside>

      <div
        className={`modal ${isModalOpen ? "open" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setModal(null);
          }
        }}
      >
        <div className="modalBox">
          <div className="modalTop">
            <div>
              <strong>{modalTitle}</strong>
              <span className="modalMeta">
                {modalMeta}
              </span>
            </div>
            <button
              className="close"
              type="button"
              onClick={() => setModal(null)}
            >
              {copy.common.close}
            </button>
          </div>
          <div className="modalBody">
            <pre>{modalBody}</pre>
          </div>
        </div>
      </div>
    </main>
  );
}

function NavButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function LoopCanvas({
  loopMap,
  selected,
  onSelect,
  copy,
}: {
  loopMap: RalphLoopMap;
  selected: RalphLoopNode | null;
  onSelect: (node: RalphLoopNode) => void;
  copy: PromptMapCopy;
}) {
  if (loopMap.nodes.length === 0) {
    return (
      <div className="empty">
        <strong>{copy.empty.loopMapTitle}</strong>
        <p>{copy.empty.loopMapText}</p>
      </div>
    );
  }

  return (
    <div className="loop">
      <div className="row">
        {loopMap.nodes.map((node, index) => (
          <FragmentWithArrow key={node.id} showArrow={index < loopMap.nodes.length - 1}>
            <button
              className={`node ${selected?.id === node.id ? "active" : ""}`}
              title={`IN: ${node.inputs.join(", ")} | OUT: ${node.outputs.join(", ")}`}
              type="button"
              onClick={() => onSelect(node)}
            >
              <span>
                {node.title}
                <small>{node.subtitle}</small>
              </span>
            </button>
          </FragmentWithArrow>
        ))}
      </div>
      <div className="loopback">
        <b>{loopMap.schemaVersion}</b>
        <span>{loopMap.summary}</span>
      </div>
    </div>
  );
}

function FragmentWithArrow({
  children,
  showArrow,
}: {
  children: ReactNode;
  showArrow: boolean;
}) {
  return (
    <>
      {children}
      {showArrow && <div className="arrow">-&gt;</div>}
    </>
  );
}

function PromptAuditCanvas({
  prompts,
  selected,
  onSelect,
  language,
}: {
  prompts: RalphPromptDefinition[];
  selected: RalphPromptDefinition | null;
  onSelect: (prompt: RalphPromptDefinition) => void;
  language: PromptMapLanguage;
}) {
  const repoOwnedCount = prompts.filter(hasRepositoryBody).length;
  const runtimeArtifactCount = prompts.filter((prompt) => prompt.bodyMode === "runtime_artifact").length;
  const orderedPrompts = getAuditPromptOrder(prompts);

  return (
    <div className="audit">
      <div className="auditIntro">
        <b>{language === "ru" ? "В repo" : "In repo"}: {repoOwnedCount}</b>
        <span>{language === "ru" ? "Runtime artifact" : "Runtime artifact"}: {runtimeArtifactCount}</span>
      </div>
      {orderedPrompts.map((prompt) => (
        <button
          className={`recipe ${hasRepositoryBody(prompt) ? "repoOwned" : ""} ${selected?.id === prompt.id ? "active" : ""}`}
          key={prompt.id}
          type="button"
          onClick={() => onSelect(prompt)}
        >
          <span className="recipeName">
            <b>{prompt.id}</b>
            <small>
              {formatPromptOwner(prompt.owner, language)} · {formatAuditBodyShort(prompt, language)}
            </small>
          </span>
          <PromptRecipeFlow prompt={prompt} language={language} />
        </button>
      ))}
    </div>
  );
}

function PromptsCanvas({
  prompts,
  selected,
  usageByPromptId,
  language,
  copy,
  onOpenExplanation,
  onSelect,
}: {
  prompts: RalphPromptDefinition[];
  selected: RalphPromptDefinition | null;
  usageByPromptId: Map<string, PromptUsageSummary>;
  language: PromptMapLanguage;
  copy: PromptMapCopy;
  onOpenExplanation: (modal: PromptMapModalState) => void;
  onSelect: (prompt: RalphPromptDefinition) => void;
}) {
  const promptTree = useMemo(() => buildPromptHierarchy(prompts), [prompts]);
  const selectedAncestorIds = useMemo(
    () => getSelectedPromptAncestorIds(selected, prompts),
    [prompts, selected],
  );
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedPromptIds, setCollapsedPromptIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!selected || selectedAncestorIds.size === 0) return;

    setExpandedPromptIds((current) => {
      const next = new Set(current);
      let changed = false;

      for (const ancestorId of selectedAncestorIds) {
        if (!next.has(ancestorId)) {
          next.add(ancestorId);
          changed = true;
        }
      }

      return changed ? next : current;
    });
    setCollapsedPromptIds((current) => {
      const next = new Set(current);
      let changed = false;

      for (const ancestorId of selectedAncestorIds) {
        if (next.delete(ancestorId)) {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [selected, selectedAncestorIds]);

  function togglePromptNode(promptId: string, expanded: boolean) {
    setExpandedPromptIds((current) => {
      const next = new Set(current);

      if (expanded) {
        next.delete(promptId);
      } else {
        next.add(promptId);
      }

      return next;
    });
    setCollapsedPromptIds((current) => {
      const next = new Set(current);

      if (expanded) {
        next.add(promptId);
      } else {
        next.delete(promptId);
      }

      return next;
    });
  }

  return (
    <div className="grid">
      <div className="panel">
        <div className="promptTree">
          {promptTree.map((node) => (
            <PromptTreeNode
              key={node.prompt.id}
              node={node}
              selected={selected}
              expandedPromptIds={expandedPromptIds}
              collapsedPromptIds={collapsedPromptIds}
              forcedExpandedPromptIds={selectedAncestorIds}
              usageByPromptId={usageByPromptId}
              language={language}
              onToggle={togglePromptNode}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        {selected ? (
          <PromptDefinitionPanel
            prompt={selected}
            prompts={prompts}
            usage={usageByPromptId.get(selected.id)}
            language={language}
            copy={copy}
            onOpenExplanation={onOpenExplanation}
            onSelectPrompt={onSelect}
          />
        ) : (
          <div className="emptyInline">{copy.empty.prompt}</div>
        )}
      </div>
    </div>
  );
}

interface PromptHierarchyNode {
  prompt: RalphPromptDefinition;
  children: PromptHierarchyNode[];
  depth: number;
}

function PromptTreeNode({
  node,
  selected,
  expandedPromptIds,
  collapsedPromptIds,
  forcedExpandedPromptIds,
  usageByPromptId,
  language,
  onToggle,
  onSelect,
}: {
  node: PromptHierarchyNode;
  selected: RalphPromptDefinition | null;
  expandedPromptIds: Set<string>;
  collapsedPromptIds: Set<string>;
  forcedExpandedPromptIds: Set<string>;
  usageByPromptId: Map<string, PromptUsageSummary>;
  language: PromptMapLanguage;
  onToggle: (promptId: string, expanded: boolean) => void;
  onSelect: (prompt: RalphPromptDefinition) => void;
}) {
  const { prompt, children, depth } = node;
  const usage = usageByPromptId.get(prompt.id);
  const hasChildren = children.length > 0;
  const expanded = hasChildren && !collapsedPromptIds.has(prompt.id) && (
    expandedPromptIds.has(prompt.id) ||
    forcedExpandedPromptIds.has(prompt.id)
  );

  return (
    <div className="promptTreeNode">
      <div className="promptTreeRow" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button
            aria-label={expanded
              ? language === "en" ? "Collapse nested entries" : "Свернуть вложенные элементы"
              : language === "en" ? "Expand nested entries" : "Раскрыть вложенные элементы"}
            aria-expanded={expanded}
            className={`treeToggle ${expanded ? "open" : ""}`}
            title={expanded
              ? language === "en" ? "Collapse" : "Свернуть"
              : language === "en" ? "Expand" : "Раскрыть"}
            type="button"
            onClick={() => onToggle(prompt.id, expanded)}
          >
            <span className="treeCaret" />
          </button>
        ) : (
          <span aria-hidden="true" className="treeToggle placeholder">
            <span className="treeCaret" />
          </span>
        )}
        <button
          className={`item promptTreeItem ${selected?.id === prompt.id ? "active" : ""}`}
          title={`${formatPromptDescription(prompt, language)} · ${formatPromptUsageDetail(usage, language)}`}
          type="button"
          onClick={() => onSelect(prompt)}
        >
          <span className="tag">{KIND_LABELS[prompt.kind]}</span>
          <span>
            {prompt.id}
            {hasChildren ? (
              <small>
                {formatNestedPromptCount(children.length, language)}
              </small>
            ) : null}
          </span>
          <span className={`status ${usage?.failedCount ? "bad" : ""}`}>
            {formatPromptUsageBadge(usage, language)}
          </span>
        </button>
      </div>
      {hasChildren ? (
        <div className={`promptTreeChildren ${expanded ? "open" : ""}`}>
          <div className="promptTreeChildrenInner">
            {children.map((child) => (
              <PromptTreeNode
                key={child.prompt.id}
                node={child}
                selected={selected}
                expandedPromptIds={expandedPromptIds}
                collapsedPromptIds={collapsedPromptIds}
                forcedExpandedPromptIds={forcedExpandedPromptIds}
                usageByPromptId={usageByPromptId}
                language={language}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildPromptHierarchy(prompts: RalphPromptDefinition[]) {
  const promptsById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const childrenByParentId = new Map<string, RalphPromptDefinition[]>();
  const rootPrompts: RalphPromptDefinition[] = [];

  for (const prompt of prompts) {
    const parentIds = prompt.usedByEntryIds ?? [];
    const parentId = parentIds.length === 1 ? parentIds[0] : null;

    if (parentId && parentId !== prompt.id && promptsById.has(parentId)) {
      const children = childrenByParentId.get(parentId) ?? [];
      children.push(prompt);
      childrenByParentId.set(parentId, children);
    } else {
      rootPrompts.push(prompt);
    }
  }

  function toNode(prompt: RalphPromptDefinition, depth: number, path: Set<string>): PromptHierarchyNode {
    if (path.has(prompt.id)) {
      return { prompt, depth, children: [] };
    }

    const nextPath = new Set(path);
    nextPath.add(prompt.id);

    return {
      prompt,
      depth,
      children: (childrenByParentId.get(prompt.id) ?? []).map((child) =>
        toNode(child, depth + 1, nextPath),
      ),
    };
  }

  return rootPrompts.map((prompt) => toNode(prompt, 0, new Set()));
}

function getSelectedPromptAncestorIds(
  selected: RalphPromptDefinition | null,
  prompts: RalphPromptDefinition[],
) {
  const ancestorIds = new Set<string>();
  const promptsById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  let current = selected;

  while (current) {
    const parentIds = current.usedByEntryIds ?? [];
    const parentId = parentIds.length === 1 ? parentIds[0] : null;

    if (!parentId || parentId === current.id || ancestorIds.has(parentId)) {
      break;
    }

    const parent = promptsById.get(parentId);
    if (!parent) break;

    ancestorIds.add(parentId);
    current = parent;
  }

  return ancestorIds;
}

function formatNestedPromptCount(count: number, language: PromptMapLanguage) {
  if (language === "en") return `${count} nested`;
  return `${count} внутри`;
}

function PromptDefinitionPanel({
  prompt,
  prompts,
  usage,
  language,
  copy,
  onOpenExplanation,
  onSelectPrompt,
}: {
  prompt: RalphPromptDefinition;
  prompts: RalphPromptDefinition[];
  usage: PromptUsageSummary | undefined;
  language: PromptMapLanguage;
  copy: PromptMapCopy;
  onOpenExplanation: (modal: PromptMapModalState) => void;
  onSelectPrompt: (prompt: RalphPromptDefinition) => void;
}) {
  const body = getPromptViewBody(prompt);
  const usedByEntries = getUsedByEntries(prompt, prompts);
  const includedEntries = getIncludedEntries(prompt, prompts);
  const bodyRef = useRef<HTMLPreElement>(null);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPlaceholder(null);
  }, [prompt.id]);

  function selectPlaceholder(placeholder: string) {
    setSelectedPlaceholder(placeholder);
    window.requestAnimationFrame(() => {
      const target = Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>("[data-placeholder]") ?? [],
      ).find((element) => element.dataset.placeholder === placeholder);

      target?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    });
  }

  return (
    <div className="promptDefinition">
      <div className="definitionHero">
        <div>
          <span className="eyebrow">{copy.prompt.definition}</span>
          <h2>{prompt.id}</h2>
          <p>{formatPromptDescription(prompt, language)}</p>
        </div>
      </div>

      <div className="definitionCards">
        <DefinitionCard
          label={copy.prompt.bodyCard}
          value={formatBodyModeForUi(prompt.bodyMode, language)}
          detail={formatBodyLocation(prompt, language)}
          title={getDefinitionCardTooltip("body", language)}
          onClick={() => onOpenExplanation(getBodyExplanation(prompt, body, language))}
        />
        <DefinitionCard
          label={copy.prompt.type}
          value={KIND_LABELS[prompt.kind]}
          detail={`${copy.inspector.templateStatus.toLowerCase()}: ${prompt.templateStatus}`}
          title={getDefinitionCardTooltip("type", language)}
          onClick={() => onOpenExplanation(getTypeExplanation(prompt, language))}
        />
        <DefinitionCard
          label={copy.prompt.runs}
          value={formatPromptUsageBadge(usage, language)}
          detail={formatPromptUsageDetail(usage, language)}
          title={getDefinitionCardTooltip("runs", language)}
          onClick={() => onOpenExplanation(getRunsExplanation(prompt, usage, language))}
        />
      </div>

      <PromptRelationPanel
        prompt={prompt}
        usedByEntries={usedByEntries}
        includedEntries={includedEntries}
        language={language}
        onSelectPrompt={onSelectPrompt}
      />

      <div className="definitionSection">
        <label>{copy.prompt.recipe}</label>
        <PromptRecipeFlow
          prompt={prompt}
          language={language}
          body={body}
          selectedVariable={selectedPlaceholder}
          onVariableSelect={selectPlaceholder}
        />
      </div>

      <div className="definitionSection bodySource">
        <label>{copy.prompt.bodySource}</label>
        {body ? (
          <>
            <p>{formatPromptBodyPreviewIntro(body.source, copy)}</p>
            {body.note ? <p className="bodySourceNote">{body.note}</p> : null}
            <pre ref={bodyRef}>
              <PromptBodyText
                body={body}
                selectedPlaceholder={selectedPlaceholder}
                onPlaceholderSelect={selectPlaceholder}
              />
            </pre>
          </>
        ) : (
          <p>{copy.prompt.bodySourceMissing}</p>
        )}
      </div>
    </div>
  );
}

function DefinitionCard({
  label,
  value,
  detail,
  title,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  title?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </>
  );

  if (onClick) {
    return (
      <button
        className="definitionCard interactive"
        title={title}
        type="button"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="definitionCard" title={title}>
      {content}
    </div>
  );
}

function PromptRelationPanel({
  prompt,
  usedByEntries,
  includedEntries,
  language,
  onSelectPrompt,
}: {
  prompt: RalphPromptDefinition;
  usedByEntries: RalphPromptDefinition[];
  includedEntries: RalphPromptDefinition[];
  language: PromptMapLanguage;
  onSelectPrompt: (prompt: RalphPromptDefinition) => void;
}) {
  const isSectionLike =
    prompt.kind === "context_section" ||
    prompt.kind === "static_context" ||
    prompt.kind === "runtime_artifact" ||
    prompt.kind === "task_template";
  const showUsedBy = isSectionLike && usedByEntries.length > 0;
  const showIncludes = includedEntries.length > 0;

  if (!showUsedBy && !showIncludes) {
    return (
      <div className="definitionSection relationPanel">
        <label>{language === "en" ? "How to read this" : "Как это читать"}</label>
        <p>{getRelationFallbackText(prompt, language)}</p>
      </div>
    );
  }

  return (
    <div className="definitionSection relationPanel">
      <label>{language === "en" ? "How this connects" : "Как это связано"}</label>
      {showUsedBy && (
        <>
          <p>{getUsedByIntro(prompt, language)}</p>
          <div className="relationChips">
            {usedByEntries.map((parent) => (
              <button
                key={parent.id}
                title={language === "en" ? "Open related entry" : "Открыть связанный entry"}
                type="button"
                onClick={() => onSelectPrompt(parent)}
              >
                {formatRelationChipPrefix(parent, language)}{parent.id}
              </button>
            ))}
          </div>
          <p>
            {language === "en"
              ? "The exact final text is visible in Prompt Calls after the executor prompt runs."
              : "Точный итоговый текст виден в Prompt Calls после запуска executor prompt."}
          </p>
        </>
      )}
      {showIncludes && (
        <>
          <p>{getIncludedIntro(prompt, language)}</p>
          <div className="relationChips">
            {includedEntries.map((section) => (
              <button
                key={section.id}
                title={language === "en" ? "Open included chunk" : "Открыть вложенный кусок"}
                type="button"
                onClick={() => onSelectPrompt(section)}
              >
                {language === "en" ? "chunk: " : "кусок: "}{section.id}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function getRelationFallbackText(prompt: RalphPromptDefinition, language: PromptMapLanguage) {
  if (prompt.kind === "llm_prompt") {
    return language === "en"
      ? "This is a standalone model prompt. It can appear as its own row in Prompt Calls."
      : "Это самостоятельный model prompt. Он может появляться отдельной строкой в Prompt Calls.";
  }

  if (prompt.kind === "task_template") {
    return language === "en"
      ? "This is a task template. It creates work text for the plan, not a standalone model call."
      : "Это шаблон task. Он создаёт текст работы для plan, а не отдельный model call.";
  }

  return language === "en"
    ? "This entry explains reusable context, not a standalone model call."
    : "Эта запись объясняет переиспользуемый context, а не отдельный model call.";
}

function getUsedByIntro(prompt: RalphPromptDefinition, language: PromptMapLanguage) {
  if (prompt.kind === "task_template") {
    return language === "en"
      ? "This is not sent to the model by itself. It creates a generated qa-* task; click the next entry to see how that task later reaches the executor:"
      : "Это не отправляется в модель само по себе. Шаблон создаёт qa-* task; кликни следующий entry, чтобы увидеть, как эта task потом попадает к executor:";
  }

  return language === "en"
    ? "This chunk is not sent to the model by itself. Click where it is used:"
    : "Этот кусок не отправляется в модель сам по себе. Кликни, где он используется:";
}

function getIncludedIntro(prompt: RalphPromptDefinition, language: PromptMapLanguage) {
  if (prompt.kind === "llm_prompt") {
    return language === "en"
      ? "This is the parent prompt. Click any chunk to inspect the section that can be inserted into it:"
      : "Это родительский prompt. Кликни любой кусок, чтобы посмотреть секцию, которая может в него вставляться:";
  }

  return language === "en"
    ? "This entry is part of the chain. Click an incoming chunk to inspect what can flow into it:"
    : "Это промежуточный entry в цепочке. Кликни входящий кусок, чтобы посмотреть, что может сюда попадать:";
}

function formatRelationChipPrefix(entry: RalphPromptDefinition, language: PromptMapLanguage) {
  if (entry.kind === "llm_prompt") return language === "en" ? "parent: " : "родитель: ";
  return language === "en" ? "used in: " : "используется в: ";
}

function getUsedByEntries(
  prompt: RalphPromptDefinition,
  prompts: RalphPromptDefinition[],
) {
  const usedBy = prompt.usedByEntryIds ?? [];

  return usedBy
    .map((promptId) => prompts.find((candidate) => candidate.id === promptId) ?? null)
    .filter((candidate): candidate is RalphPromptDefinition => Boolean(candidate));
}

function getIncludedEntries(
  prompt: RalphPromptDefinition,
  prompts: RalphPromptDefinition[],
) {
  return prompts.filter((candidate) => candidate.usedByEntryIds?.includes(prompt.id));
}

function getDefinitionCardTooltip(
  card: "body" | "type" | "runs",
  language: PromptMapLanguage,
) {
  if (language === "en") {
    if (card === "body") return "Where to read this prompt text and how exact it is.";
    if (card === "type") return "What role this item plays in Ralph.";
    return "Whether this prompt appeared in recorded calls.";
  }

  if (card === "body") return "Где читать текст prompt и насколько он точный.";
  if (card === "type") return "Какую роль этот элемент играет в Ralph.";
  return "Был ли этот prompt в записанных вызовах.";
}

function getBodyExplanation(
  prompt: RalphPromptDefinition,
  body: ReturnType<typeof getPromptViewBody>,
  language: PromptMapLanguage,
): PromptMapModalState {
  if (language === "en") {
    return {
      type: "explain",
      title: "BODY: prompt text",
      meta: `${prompt.id} · ${formatBodyModeForUi(prompt.bodyMode, language)}`,
      body: [
        "In short",
        formatBodyExplanationShort(prompt, body, language),
        "",
        "What you can do here",
        ...formatBodyExplanationActions(prompt, body, language),
        "",
        "Where to see the exact prompt",
        "Open Prompt Calls. That view shows the concrete text that was sent to the model in a recorded run.",
      ].join("\n"),
    };
  }

  return {
    type: "explain",
    title: "BODY: где текст",
    meta: `${prompt.id} · ${formatBodyModeForUi(prompt.bodyMode, language)}`,
    body: [
      "Коротко",
      formatBodyExplanationShort(prompt, body, language),
      "",
      "Что можно делать здесь",
      ...formatBodyExplanationActions(prompt, body, language),
      "",
      "Где увидеть точный prompt",
      "Открой Prompt Calls. Там показан конкретный текст, который ушёл в модель в записанном запуске.",
    ].join("\n"),
  };
}

function getTypeExplanation(
  prompt: RalphPromptDefinition,
  language: PromptMapLanguage,
): PromptMapModalState {
  if (language === "en") {
    return {
      type: "explain",
      title: "TYPE: role",
      meta: `${prompt.id} · ${KIND_LABELS[prompt.kind]}`,
      body: [
        "In short",
        `This item is ${formatPromptKindPlain(prompt.kind, language)}.`,
        "",
        "Why it matters",
        "- It tells you whether this row is a full model prompt, a reusable section, task template, fixed context, or runtime-generated text.",
        "- It does not change the prompt by itself. It only explains the role of this catalog entry.",
        "",
        `Template: ${prompt.templateStatus}.`,
      ].join("\n"),
    };
  }

  return {
    type: "explain",
    title: "ТИП: роль",
    meta: `${prompt.id} · ${KIND_LABELS[prompt.kind]}`,
    body: [
      "Коротко",
      `Этот элемент — ${formatPromptKindPlain(prompt.kind, language)}.`,
      "",
      "Зачем это нужно",
      "- Понять, это полноценный prompt для модели, переиспользуемая секция, task template, постоянный контекст или runtime-блок.",
      "- Сам по себе тип ничего не меняет. Он только объясняет роль записи в каталоге.",
      "",
      `Template: ${prompt.templateStatus}.`,
    ].join("\n"),
  };
}

function getRunsExplanation(
  prompt: RalphPromptDefinition,
  usage: PromptUsageSummary | undefined,
  language: PromptMapLanguage,
): PromptMapModalState {
  const usageDetail = formatPromptUsageDetail(usage, language);

  if (language === "en") {
    return {
      type: "explain",
      title: "RUNS: calls",
      meta: `${prompt.id} · observed trace evidence`,
      body: [
        "In short",
        "RUNS says whether this prompt was seen in recorded Prompt Calls.",
        "",
        `Now: ${usageDetail}`,
        "",
        "How to read it",
        "- seen: there are recorded calls for this prompt.",
        "- failed: at least one recorded call failed or could not be parsed.",
        "- not seen: current trace data has no recorded call for this prompt.",
        "",
        "This is not a project lifecycle verdict. It only describes the Prompt Calls history available to PromptMap.",
      ].join("\n"),
    };
  }

  return {
    type: "explain",
    title: "ЗАПУСКИ: вызовы",
    meta: `${prompt.id} · observed trace evidence`,
    body: [
      "Коротко",
      "ЗАПУСКИ показывают, встречался ли этот prompt в записанных Prompt Calls.",
      "",
      `Сейчас: ${usageDetail}`,
      "",
      "Как читать",
      "- seen: есть записанные вызовы этого prompt.",
      "- failed: хотя бы один записанный вызов упал или не распарсился.",
      "- not seen: в текущих trace-данных нет вызова этого prompt.",
      "",
      "Это не статус проекта. Это только история Prompt Calls, доступная PromptMap.",
    ].join("\n"),
  };
}

function formatBodyExplanationShort(
  prompt: RalphPromptDefinition,
  body: ReturnType<typeof getPromptViewBody>,
  language: PromptMapLanguage,
) {
  const visibleText = body
    ? language === "en"
      ? "The text is visible below in Body source."
      : "Текст можно читать ниже в блоке «Источник body»."
    : language === "en"
      ? "The text is not exported for reading yet."
      : "Текст пока не выгружен для чтения.";

  if (language === "en") {
    if (hasRepositoryBody(prompt)) {
      return `${visibleText} This prompt body already lives in Prompt Repository, so this is the canonical template/static text.`;
    }

    if (prompt.bodyMode === "runtime_artifact") {
      return `${visibleText} The final block is created during a concrete run from project files or runtime state.`;
    }

    return `${visibleText} This entry has no readable body under the current Prompt Repository contract.`;
  }

  if (hasRepositoryBody(prompt)) {
    return `${visibleText} Body уже лежит в Prompt Repository, то есть это основной template/static текст.`;
  }

  if (prompt.bodyMode === "runtime_artifact") {
    return `${visibleText} Финальный блок создаётся во время конкретного запуска из файлов или runtime-состояния проекта.`;
  }

  return `${visibleText} У этой записи нет читаемого body в текущем контракте Prompt Repository.`;
}

function formatBodyExplanationActions(
  prompt: RalphPromptDefinition,
  body: ReturnType<typeof getPromptViewBody>,
  language: PromptMapLanguage,
) {
  if (!body) {
    return language === "en"
      ? [
          "- Use this card to understand why the body is missing.",
          "- Use Prompt Calls after a run to inspect the real text.",
        ]
      : [
          "- Эта карточка объясняет, почему body не видно заранее.",
          "- После запуска смотри реальный текст в Prompt Calls.",
        ];
  }

  if (language === "en") {
    if (hasRepositoryBody(prompt)) {
      return [
        "- Read the body below as the main repository-owned text.",
        "- Click variable chips above to jump to matching {{placeholders}} in the text.",
      ];
    }

    if (prompt.bodyMode === "runtime_artifact") {
      return [
        "- Treat the body below as a preview or explanation, not the full final text.",
        "- Open Prompt Calls to see the run-specific rendered block.",
      ];
    }

    return [
      "- Use Prompt Calls to inspect concrete rendered text after a run.",
      "- Treat a missing body as a repository contract gap, not a second source of truth.",
    ];
  }

  if (hasRepositoryBody(prompt)) {
    return [
      "- Читай body ниже как основной текст из Prompt Repository.",
      "- Кликай по переменным выше, чтобы перейти к соответствующим {{placeholder}} в тексте.",
    ];
  }

  if (prompt.bodyMode === "runtime_artifact") {
    return [
      "- Считай body ниже preview/объяснением, а не полным финальным текстом.",
      "- Открой Prompt Calls, чтобы увидеть rendered-блок для конкретного запуска.",
    ];
  }

  return [
    "- Открой Prompt Calls, чтобы увидеть конкретный rendered-текст после запуска.",
    "- Считай отсутствие body дырой в контракте repository, а не вторым источником правды.",
  ];
}

function formatPromptKindPlain(
  kind: RalphPromptDefinition["kind"],
  language: PromptMapLanguage,
) {
  if (language === "en") {
    if (kind === "llm_prompt") return "a full prompt sent to a model";
    if (kind === "context_section") return "a reusable section inserted into a larger prompt";
    if (kind === "static_context") return "fixed context text";
    if (kind === "task_template") return "a template that creates a plan task body, not a model call";
    return "a block assembled from runtime data";
  }

  if (kind === "llm_prompt") return "полноценный prompt, который отправляется в модель";
  if (kind === "context_section") return "секция, которую вставляют в более крупный prompt";
  if (kind === "static_context") return "постоянный контекстный текст";
  if (kind === "task_template") return "шаблон, который создаёт тело plan task, а не вызов модели";
  return "блок, который собирается из runtime-данных";
}

function PromptBodyText({
  body,
  selectedPlaceholder,
  onPlaceholderSelect,
}: {
  body: NonNullable<ReturnType<typeof getPromptViewBody>>;
  selectedPlaceholder: string | null;
  onPlaceholderSelect: (placeholder: string) => void;
}) {
  return (
    <>
      {splitPromptBodyByPlaceholders(body.text, body.placeholders).map((part, index) => {
        if (part.kind === "text") {
          return <span key={`${index}:text`}>{part.text}</span>;
        }

        return (
          <button
            className={`bodyVariable ${selectedPlaceholder === part.placeholder ? "active" : ""}`}
            data-placeholder={part.placeholder}
            key={`${index}:${part.placeholder}`}
            title={formatBodyVariableTooltip(part.placeholder)}
            type="button"
            onClick={() => onPlaceholderSelect(part.placeholder)}
          >
            {part.text}
          </button>
        );
      })}
    </>
  );
}

function formatBodyVariableTooltip(placeholder: string) {
  return `placeholder: ${placeholder}`;
}

function formatBodyLocation(prompt: RalphPromptDefinition, language: PromptMapLanguage) {
  if (language === "en") {
    if (hasRepositoryBody(prompt)) return "stored in Prompt Repository";
    if (prompt.bodyMode === "runtime_artifact") return "created from runtime files";
    return "not exported";
  }

  if (hasRepositoryBody(prompt)) return "лежит в Prompt Repository";
  if (prompt.bodyMode === "runtime_artifact") return "создаётся из runtime-файлов";
  return "не выгружено";
}

function LoopInspector({
  node,
  decisions,
  promptsByOwner,
  onOpenPrompt,
  language,
  copy,
}: {
  node: RalphLoopNode;
  decisions: RalphLoopDecision[];
  promptsByOwner: Map<RalphPromptDefinition["owner"], RalphPromptDefinition[]>;
  onOpenPrompt: (promptId: string) => void;
  language: PromptMapLanguage;
  copy: PromptMapCopy;
}) {
  return (
    <>
      <Para label={copy.inspector.kind} text={node.kind} />
      <Para label={copy.inspector.source} text={formatLoopSource(node.source)} />
      <Block label={copy.inspector.in} items={node.inputs} />
      <Block label={copy.inspector.out} items={node.outputs} />
      <Block label={copy.inspector.next} items={node.next} />
      {node.notes?.length ? <Block label={copy.inspector.notes} items={node.notes} /> : null}
      {decisions.length > 0 && (
        <details>
          <summary>{copy.inspector.decisionOutputs}</summary>
          <div className="content">
            {decisions.map((decision) => (
              <div className="decisionRule" key={decision.id}>
                <b>{decision.id}</b>
                <span>{decision.when}</span>
                <em>-&gt; {decision.out}</em>
              </div>
            ))}
          </div>
        </details>
      )}
      <details>
        <summary>{copy.inspector.internals}</summary>
        <div className="content">
          {expandInternals(node, promptsByOwner, language).map((item) => {
            const promptId = item.promptId;

            return (
              <div className="internal" key={item.label}>
                <span title={item.tip ?? ""}>{item.label}</span>
                {promptId && (
                  <button
                    className="link"
                    type="button"
                    onClick={() => onOpenPrompt(promptId)}
                  >
                    {copy.common.prompt}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </details>
      <RawDetails value={node} copy={copy} />
    </>
  );
}

function PromptInspector({
  prompt,
  usage,
  language,
  copy,
  onOpenPrompt,
}: {
  prompt: RalphPromptDefinition;
  usage: PromptUsageSummary | undefined;
  language: PromptMapLanguage;
  copy: PromptMapCopy;
  onOpenPrompt: (promptId: string) => void;
}) {
  return (
    <>
      <Para label={copy.inspector.kind} text={KIND_LABELS[prompt.kind]} />
      <Para label={copy.inspector.templateStatus} text={prompt.templateStatus} />
      <Para label={copy.inspector.runVisibility} text={formatPromptUsageDetail(usage, language)} />
      <Para label={copy.inspector.source} text={formatSource(prompt)} />
      <Para label={copy.inspector.out} text={formatPromptDescription(prompt, language)} />
      <button
        className="btn"
        type="button"
        onClick={() => onOpenPrompt(prompt.id)}
      >
        {copy.common.prompt}
      </button>
      <RawDetails value={prompt} copy={copy} />
    </>
  );
}

function PromptAuditInspector({
  prompt,
  language,
  copy,
}: {
  prompt: RalphPromptDefinition;
  language: PromptMapLanguage;
  copy: PromptMapCopy;
}) {
  return (
    <>
      <Para label="PROMPT" text={prompt.id} />
      <Para label={language === "ru" ? "СМЫСЛ" : "PURPOSE"} text={formatPromptDescription(prompt, language)} />
      <Para label={copy.prompt.bodyCard} text={formatBodyModeForUi(prompt.bodyMode, language)} />
      <div className="block">
        <label>{copy.prompt.recipe}</label>
        <PromptRecipeFlow prompt={prompt} language={language} />
      </div>
    </>
  );
}

function TraceInspector({
  event,
  run,
  promptDefinition,
  language,
  copy,
}: {
  event: PromptTraceEvent | null;
  run: RalphPromptTraceMap["runs"][number] | null;
  promptDefinition: RalphPromptDefinition | null;
  language: PromptMapLanguage;
  copy: PromptMapCopy;
}) {
  if (!event) {
    return (
      <>
        <Para label={copy.inspector.status} text={copy.inspector.openRunPrompt} />
      </>
    );
  }

  return (
    <>
      <Para label={copy.inspector.selectedStep} text={event.label} />
      <Para
        label={copy.inspector.systemRead}
        text={formatParseResult(event, language)}
      />
      <Para
        label={copy.inspector.promptSource}
        text={promptDefinition ? formatSource(promptDefinition) : copy.inspector.promptNotFound}
      />
      <Block
        label={copy.inspector.runEvidence}
        items={[
          `project: ${run?.projectName ?? copy.inspector.unknown}`,
          `owner: ${event.owner}`,
          `model: ${event.model ?? copy.inspector.notRecorded}`,
          `status: ${event.success ? "ok" : "failed"}`,
          `prompt: ${event.prompt.charCount} chars`,
          `answer: ${event.output.charCount} chars`,
        ]}
      />
      {run?.errors.length ? <Block label={copy.inspector.parseErrors} items={run.errors} /> : null}
    </>
  );
}

function Block({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="block">
      <label>{label}</label>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Para({ label, text }: { label: string; text: string }) {
  return (
    <div className="block">
      <label>{label}</label>
      <p>{text}</p>
    </div>
  );
}

function RawDetails({ value, copy }: { value: unknown; copy: PromptMapCopy }) {
  return (
    <details>
      <summary>{copy.common.viewRaw}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function expandInternals(
  node: RalphLoopNode,
  promptsByOwner: Map<RalphPromptDefinition["owner"], RalphPromptDefinition[]>,
  language: PromptMapLanguage,
): ExpandedInternal[] {
  return node.internals.flatMap((internal) => {
    if (!internal.promptOwner) {
      return [{ label: internal.label, tip: internal.description }];
    }

    const prompts = promptsByOwner.get(internal.promptOwner) ?? [];
    if (prompts.length === 0) {
      return [{ label: internal.label, tip: internal.description }];
    }

    return prompts.map((prompt) => ({
      label: prompt.id,
      tip: formatPromptDescription(prompt, language),
      promptId: prompt.id,
    }));
  });
}

function getInspectorTitle(
  selection: Selection,
  loopNode: RalphLoopNode | null,
  prompt: RalphPromptDefinition | null,
  traceEvent: PromptTraceEvent | null,
) {
  if (selection.type === "loop") return loopNode?.title ?? "Loop";
  if (selection.type === "prompt") return prompt?.id ?? "prompt";
  if (selection.type === "call") return traceEvent?.label ?? "Prompt call";
  if (selection.type === "trace") return traceEvent?.label ?? "Observed run";
  return "Prompt Map";
}

function getLatestPromptCall(traceMap: RalphPromptTraceMap) {
  return traceMap.runs
    .flatMap((run) => run.events.map((event) => ({ run, event })))
    .sort((left, right) => right.event.timestamp.localeCompare(left.event.timestamp))[0] ?? null;
}

function lastTraceEvent(events: PromptTraceEvent[] | undefined): PromptTraceEvent | null {
  if (!events || events.length === 0) return null;
  return events[events.length - 1];
}

function formatTraceTime(value: string | null) {
  if (!value) return "no events";

  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatSource(prompt: RalphPromptDefinition) {
  return `${prompt.source.file} · ${prompt.source.symbol}${
    prompt.source.lineHint ? `:${prompt.source.lineHint}` : ""
  }`;
}

function formatLoopSource(source: RalphLoopNode["source"]) {
  return `${source.file} · ${source.symbol}${
    source.lineHint ? `:${source.lineHint}` : ""
  }`;
}

function formatPromptDescription(
  prompt: RalphPromptDefinition,
  language: PromptMapLanguage,
) {
  return language === "ru" ? prompt.descriptionRu : prompt.description;
}

function formatParseResult(event: PromptTraceEvent, language: PromptMapLanguage) {
  if (event.parse.summary) return `${formatParseStatus(event.parse.status, language)}: ${event.parse.summary}`;
  return formatParseStatus(event.parse.status, language);
}

function formatParseStatus(status: PromptTraceEvent["parse"]["status"], language: PromptMapLanguage) {
  if (language === "ru") {
    if (status === "ok") return "Parsed decision записан";
    if (status === "error") return "Decision не прочитан";
    return "Parsed decision не записан";
  }

  if (status === "ok") return "Parsed decision recorded";
  if (status === "error") return "Could not read decision";
  return "No parsed decision recorded";
}

function renderPromptPreview(
  prompt: RalphPromptDefinition,
  copy: PromptMapCopy,
  language: PromptMapLanguage,
) {
  const body = getPromptViewBody(prompt);

  return [
    `# ${prompt.id}`,
    "",
    prompt.title,
    "",
    formatPromptDescription(prompt, language),
    "",
    `${copy.rawPreview.source}: ${formatSource(prompt)}`,
    `${copy.rawPreview.kind}: ${prompt.kind}`,
    `${copy.rawPreview.template}: ${prompt.templateStatus}`,
    `${copy.rawPreview.bodyMode}: ${formatBodyMode(prompt.bodyMode)}`,
    `${copy.rawPreview.visibility}: ${prompt.visibility}`,
    "",
    copy.rawPreview.inputs,
    ...(prompt.variables.length > 0
      ? prompt.variables.map((variable) => `- ${variable}`)
      : [`- ${copy.common.none}`]),
    "",
    copy.rawPreview.notes,
    ...(prompt.notes && prompt.notes.length > 0
      ? prompt.notes.map((note) => `- ${note}`)
      : [`- ${copy.common.none}`]),
    "",
    copy.rawPreview.body,
    ...(body
      ? [
          `- ${formatBodyMode(prompt.bodyMode)}`,
          `- source: ${formatPromptBodyPreviewSource(body.source, language)}`,
          `- ${copy.rawPreview.placeholders}: ${body.placeholders.length > 0 ? body.placeholders.join(", ") : copy.common.none}`,
          ...(body.note ? [`- note: ${body.note}`] : []),
          "",
          "```markdown",
          body.text,
          "```",
          "",
          `- ${copy.rawPreview.renderedTrace}`,
        ]
      : [
          `- ${formatBodyMode(prompt.bodyMode)}`,
          `- body is not exported by the current Prompt Repository contract`,
          `- ${copy.rawPreview.renderedTrace}`,
        ]),
  ].join("\n");
}

function getPromptViewBody(prompt: RalphPromptDefinition) {
  return prompt.templateBody ?? prompt.bodyPreview ?? null;
}

function splitPromptBodyByPlaceholders(text: string, placeholders: string[]) {
  const uniquePlaceholders = [...new Set(placeholders)].filter(Boolean);
  if (uniquePlaceholders.length === 0) {
    return [{ kind: "text" as const, text }];
  }

  const matcher = new RegExp(
    `\\{\\{(${uniquePlaceholders.map(escapeRegExp).join("|")})\\}\\}`,
    "g",
  );
  const parts: Array<
    | { kind: "text"; text: string }
    | { kind: "placeholder"; text: string; placeholder: string }
  > = [];
  let cursor = 0;

  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ kind: "text", text: text.slice(cursor, index) });
    }
    parts.push({
      kind: "placeholder",
      text: match[0],
      placeholder: match[1],
    });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ kind: "text", text: text.slice(cursor) });
  }

  return parts;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPromptBodyPreviewIntro(
  source: NonNullable<ReturnType<typeof getPromptViewBody>>["source"],
  copy: PromptMapCopy,
) {
  if (source === "prompt_repository") return copy.prompt.bodySourceText;
  return copy.prompt.bodySourceRuntimeText;
}

function formatPromptBodyPreviewSource(
  source: NonNullable<ReturnType<typeof getPromptViewBody>>["source"],
  language: PromptMapLanguage,
) {
  if (language === "en") {
    if (source === "prompt_repository") return "Prompt Repository";
    return "runtime artifact description";
  }

  if (source === "prompt_repository") return "Prompt Repository";
  return "описание runtime artifact";
}

function formatBodyMode(bodyMode: RalphPromptDefinition["bodyMode"]) {
  if (bodyMode === "repository_template") return "repository template";
  if (bodyMode === "repository_constant") return "repository constant";
  return "runtime artifact";
}

function formatBodyModeForUi(
  bodyMode: RalphPromptDefinition["bodyMode"],
  language: PromptMapLanguage,
) {
  if (language === "en") return formatBodyMode(bodyMode);
  if (bodyMode === "repository_template") return "repo template";
  if (bodyMode === "repository_constant") return "repo text";
  return "runtime artifact";
}

function PromptRecipeFlow({
  prompt,
  language,
  body,
  selectedVariable,
  onVariableSelect,
}: {
  prompt: RalphPromptDefinition;
  language: PromptMapLanguage;
  body?: NonNullable<ReturnType<typeof getPromptViewBody>> | null;
  selectedVariable?: string | null;
  onVariableSelect?: (variable: string) => void;
}) {
  const parts = getPromptRecipeParts(prompt, language, body);

  return (
    <span className="recipeFlow" aria-label={`${language === "en" ? "Recipe" : "Сборка"} ${prompt.id}`}>
      {parts.map((part, index) => {
        const variable = "variable" in part && typeof part.variable === "string"
          ? part.variable
          : undefined;

        return (
          <span className="recipeStep" key={`${part.label}-${index}`}>
            {index > 0 && <span className="recipePlus">+</span>}
            {variable && onVariableSelect ? (
              <button
                className={`recipeChip ${part.kind} variable ${selectedVariable === variable ? "active" : ""}`}
                title={formatRecipeChipTooltip(part.label, part.source, language)}
                type="button"
                onClick={() => onVariableSelect(variable)}
              >
                {part.label}
              </button>
            ) : (
              <span className={`recipeChip ${part.kind}`} title={formatRecipeChipTooltip(part.label, part.source, language)}>
                {part.label}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function formatRecipeChipTooltip(
  label: string,
  source: string,
  language: PromptMapLanguage,
) {
  if (language === "en") return `${label}: ${source}`;
  return `${label}: ${source}`;
}

function getPromptRecipeParts(
  prompt: RalphPromptDefinition,
  language: PromptMapLanguage,
  body?: NonNullable<ReturnType<typeof getPromptViewBody>> | null,
) {
  const variables = body?.placeholders.length ? body.placeholders : prompt.variables;

  return [
    getPromptBodyPart(prompt, language),
    ...variables.map((variable) => ({
      ...getPromptVariablePart(variable, language),
      variable,
    })),
  ];
}

function getDefaultAuditPrompt(prompts: RalphPromptDefinition[]) {
  return prompts.find(hasRepositoryBody) ?? prompts[0] ?? null;
}

function getAuditPromptOrder(prompts: RalphPromptDefinition[]) {
  return [
    ...prompts.filter(hasRepositoryBody),
    ...prompts.filter((prompt) => !hasRepositoryBody(prompt)),
  ];
}

function hasRepositoryBody(prompt: RalphPromptDefinition) {
  return prompt.bodyMode === "repository_template" || prompt.bodyMode === "repository_constant";
}

function formatAuditBodyShort(prompt: RalphPromptDefinition, language: PromptMapLanguage) {
  if (language === "en") {
    if (prompt.bodyMode === "repository_template") return "repo template";
    if (prompt.bodyMode === "repository_constant") return "repo text";
    if (prompt.bodyMode === "runtime_artifact") return "runtime";
    return "not exported";
  }

  if (prompt.bodyMode === "repository_template") return "repo template";
  if (prompt.bodyMode === "repository_constant") return "repo text";
  if (prompt.bodyMode === "runtime_artifact") return "runtime";
  return "не выгружено";
}

function getPromptBodyPart(prompt: RalphPromptDefinition, language: PromptMapLanguage) {
  if (language === "en") {
    if (prompt.bodyMode === "runtime_artifact") {
      return { label: "runtime file", kind: "runtime", source: prompt.source.symbol };
    }

    if (prompt.bodyMode === "repository_template") {
      return { label: "repo template", kind: "static", source: prompt.source.symbol };
    }

    if (prompt.bodyMode === "repository_constant") {
      return { label: "repo text", kind: "static", source: prompt.source.symbol };
    }

    return { label: "not exported", kind: "static", source: prompt.source.symbol };
  }

  if (prompt.bodyMode === "runtime_artifact") {
    return { label: "runtime файл", kind: "runtime", source: prompt.source.symbol };
  }

  if (prompt.bodyMode === "repository_template") {
    return { label: "шаблон в repo", kind: "static", source: prompt.source.symbol };
  }

  if (prompt.bodyMode === "repository_constant") {
    return { label: "текст в repo", kind: "static", source: prompt.source.symbol };
  }

  return {
    label: "не выгружено",
    kind: "static",
    source: prompt.source.symbol,
  };
}

function getPromptVariablePart(variable: string, language: PromptMapLanguage) {
  const known = PROMPT_VARIABLE_LABELS[variable];
  if (known) {
    return {
      label: language === "ru" ? known.label : known.labelEn ?? known.label,
      kind: known.kind,
      source: known.source,
    };
  }

  if (/plan|task|judgment|feedback|candidate|criteria/i.test(variable)) {
    return { label: variable, kind: "json", source: variable };
  }

  return { label: variable, kind: "data", source: variable };
}

function formatPromptOwner(
  owner: RalphPromptDefinition["owner"],
  language: PromptMapLanguage,
) {
  if (language === "en") return owner;
  if (owner === "planner") return "планировщик";
  if (owner === "executor") return "исполнитель";
  if (owner === "controller") return "контроллер";
  if (owner === "qa-planner") return "QA планировщик";
  return "визуальный QA";
}

const PROMPT_VARIABLE_LABELS: Record<string, { label: string; labelEn?: string; kind: string; source: string }> = {
  spec: { label: "spec.md", kind: "data", source: "spec" },
  newSpec: { label: "spec.md", kind: "data", source: "newSpec" },
  specContent: { label: "spec.md", kind: "data", source: "specContent" },
  specSnippet: { label: "фрагмент spec.md", labelEn: "spec.md snippet", kind: "data", source: "specSnippet" },
  specLabel: { label: "метка спеки", labelEn: "spec label", kind: "runtime", source: "specLabel" },
  specPath: { label: "путь спеки", labelEn: "spec path", kind: "runtime", source: "specPath" },
  project: { label: "project.config", kind: "json", source: "project" },
  projectContext: { label: "файлы проекта", labelEn: "project files", kind: "data", source: "projectContext" },
  projectSnapshot: { label: "снимок файлов", labelEn: "file snapshot", kind: "data", source: "projectSnapshot" },
  projectGoal: { label: "plan.projectGoal", kind: "json", source: "projectGoal" },
  currentPlan: { label: "plan.json", kind: "json", source: "currentPlan" },
  plan: { label: "plan.json", kind: "json", source: "plan" },
  planSummary: { label: "plan.summary", kind: "json", source: "planSummary" },
  task: { label: "task", kind: "json", source: "task" },
  currentTask: { label: "текущая task", labelEn: "current task", kind: "json", source: "currentTask" },
  tasks: { label: "tasks[]", kind: "json", source: "tasks" },
  candidateTasks: { label: "tasks-кандидаты[]", labelEn: "candidate tasks[]", kind: "json", source: "candidateTasks" },
  judgments: { label: "judgments[]", kind: "json", source: "judgments" },
  feedbackMatrix: { label: "feedbackMatrix[]", kind: "json", source: "feedbackMatrix" },
  requiredFeedbackItems: { label: "acceptedArtifact.requiredItems[]", kind: "json", source: "requiredFeedbackItems" },
  contextSections: { label: "контекст[]", labelEn: "context[]", kind: "json", source: "contextSections" },
  recentIterations: { label: "history[]", kind: "json", source: "recentIterations" },
  history: { label: "history[]", kind: "json", source: "history" },
  previousError: { label: "ошибка retry", labelEn: "retry error", kind: "runtime", source: "previousError" },
  reason: { label: "причина", labelEn: "reason", kind: "runtime", source: "reason" },
  seed: { label: "seed", kind: "runtime", source: "seed" },
  nextTaskNumber: { label: "номер task", labelEn: "task number", kind: "runtime", source: "nextTaskNumber" },
  nextJudgmentNumber: { label: "номер judgment", labelEn: "judgment number", kind: "runtime", source: "nextJudgmentNumber" },
  iteration: { label: "iteration", kind: "runtime", source: "iteration" },
  withScopeBoundary: { label: "scope flag", kind: "runtime", source: "withScopeBoundary" },
  completionPromise: { label: "promise", kind: "runtime", source: "completionPromise" },
  verificationFailures: { label: "verification", kind: "data", source: "verificationFailures" },
  verificationResult: { label: "verification", kind: "data", source: "verificationResult" },
  visionReport: { label: "визуальный отчёт", labelEn: "vision report", kind: "data", source: "visionReport" },
  e2eEnabled: { label: "e2e flag", kind: "runtime", source: "e2eEnabled" },
  workDir: { label: "workDir", kind: "runtime", source: "workDir" },
  files: { label: "files[]", kind: "data", source: "files" },
  ".env.arena-secrets presence": { label: "secrets flag", kind: "runtime", source: ".env.arena-secrets presence" },
  packageJson: { label: "package.json", kind: "data", source: "packageJson" },
  parentDescription: { label: "parent task", kind: "json", source: "parentDescription" },
  steps: { label: "steps[]", kind: "json", source: "steps" },
  specSummary: { label: "summary спеки", labelEn: "spec summary", kind: "data", source: "specSummary" },
  remainingSlots: { label: "slots", kind: "runtime", source: "remainingSlots" },
  taskDescription: { label: "описание task", labelEn: "task description", kind: "data", source: "taskDescription" },
  criteria: { label: "criteria[]", kind: "json", source: "criteria" },
  selectedFrames: { label: "frames[]", kind: "data", source: "selectedFrames" },
};

const PROMPT_MAP_CSS = `
.prompt-map{--bg:#fafafa;--panel:#fff;--text:#111;--muted:#777;--line:#ddd;--line2:#aaa;--soft:#f3f3f3;--mono:var(--font-mono),ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;--sans:var(--font-sans),Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;height:100vh;display:grid;grid-template-columns:166px 1fr 350px;background:var(--bg);color:var(--text);font:14px var(--sans)}.prompt-map.minimalCalls{grid-template-columns:166px 1fr}.prompt-map.minimalCalls .inspector{display:none}
.prompt-map *{box-sizing:border-box}.prompt-map button{font:inherit}
.prompt-map .nav{background:var(--panel);border-right:1px solid var(--line)}.prompt-map .brand{height:54px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid var(--line);font-weight:700}
.prompt-map .nav button{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;padding:12px 14px;color:var(--muted);cursor:pointer}.prompt-map .nav button.active{background:var(--soft);color:var(--text);font-weight:700}
.prompt-map .pm-main{display:grid;grid-template-rows:54px 1fr;overflow:hidden}.prompt-map .top{background:var(--panel);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 18px}
.prompt-map h1{font:700 15px var(--sans);margin:0}.prompt-map .sub{color:var(--muted);font:12px var(--mono);margin-left:10px}.prompt-map .topActions{display:flex;align-items:center;gap:8px}.prompt-map .btn{border:1px solid var(--line2);background:#fff;border-radius:6px;padding:6px 9px;cursor:pointer;font:12px var(--mono)}.prompt-map .btn:hover{background:var(--soft)}.prompt-map .languageSwitch{display:inline-flex;border:1px solid var(--line2);border-radius:7px;overflow:hidden;background:#fff}.prompt-map .languageSwitch button{border:0;border-right:1px solid var(--line);background:transparent;padding:6px 8px;color:var(--muted);cursor:pointer;font:12px var(--mono)}.prompt-map .languageSwitch button:last-child{border-right:0}.prompt-map .languageSwitch button.active{background:#111;color:#fff}
.prompt-map .canvas{min-height:0;padding:30px;overflow:auto;display:grid;place-items:center}.prompt-map.minimalCalls .canvas{padding:16px 18px;place-items:start stretch;overflow:hidden}
.prompt-map .srOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.prompt-map .inspector{background:var(--panel);border-left:1px solid var(--line);overflow:auto}.prompt-map .inspector .head{height:54px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 14px}.prompt-map .inspector h2{font:700 13px var(--mono);margin:0}.prompt-map .body{padding:14px}
.prompt-map .loop{min-width:1320px}.prompt-map .row{display:flex;align-items:center;justify-content:center;gap:9px}.prompt-map .node{width:108px;height:58px;border:1px solid var(--line2);border-radius:8px;background:#fff;display:grid;place-items:center;cursor:pointer;font:12px var(--mono);text-align:center}.prompt-map .node:hover{background:var(--soft)}.prompt-map .node.active{background:#111;color:#fff;border-color:#111}.prompt-map .node small{display:block;color:inherit;opacity:.55;font-size:10px;margin-top:3px}.prompt-map .arrow{font:14px var(--mono);color:var(--muted)}.prompt-map .loopback{margin:22px auto 0;width:760px;border:1px dashed var(--line2);border-radius:8px;padding:10px 12px;text-align:center;font:11px/1.45 var(--mono);color:var(--muted)}.prompt-map .loopback b{display:block;color:var(--text);font-weight:700;margin-bottom:4px}.prompt-map .loopback span{display:block}
.prompt-map .block{border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:13px}.prompt-map .block:last-child{border-bottom:0}.prompt-map .block label{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.05em;margin-bottom:7px}.prompt-map .block ul{margin:0;padding-left:17px;font:12px/1.55 var(--mono)}.prompt-map .block p{margin:0;font:12px/1.55 var(--mono)}
.prompt-map details{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:8px}.prompt-map summary{cursor:pointer;background:var(--soft);padding:9px 10px;color:var(--muted);font:12px var(--mono)}.prompt-map details[open] summary{border-bottom:1px solid var(--line)}.prompt-map details .content{padding:8px 10px;font:12px/1.55 var(--mono)}.prompt-map pre{margin:0;padding:12px;white-space:pre-wrap;font:12px/1.55 var(--mono)}.prompt-map .previewHead{min-height:36px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:0 12px;color:var(--muted);font:11px var(--mono);letter-spacing:.03em}.prompt-map .previewHead span{min-width:0;white-space:nowrap}.prompt-map .previewHead span:first-child{overflow:hidden;text-overflow:ellipsis;color:var(--text);font-weight:600}
.prompt-map .internal{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:7px 0}.prompt-map .internal:last-child{border-bottom:0}.prompt-map .internal span{cursor:help}.prompt-map .decisionRule{display:grid;grid-template-columns:70px 1fr 70px;gap:8px;border-bottom:1px solid var(--line);padding:7px 0}.prompt-map .decisionRule:last-child{border-bottom:0}.prompt-map .decisionRule b{font-weight:700}.prompt-map .decisionRule span,.prompt-map .decisionRule em{color:var(--muted);font-style:normal}.prompt-map .link{border:1px solid var(--line2);background:#fff;border-radius:5px;padding:3px 6px;font:11px var(--mono);cursor:pointer}.prompt-map .link:hover{background:#111;color:#fff}
.prompt-map .audit{width:min(1080px,100%);display:grid;gap:10px}.prompt-map .auditIntro{height:38px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;align-items:center;gap:14px;padding:0 14px;font:11px var(--mono);color:var(--muted)}.prompt-map .auditIntro b{color:#111}.prompt-map .recipe{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:center;width:100%;min-height:64px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px 14px;text-align:left;cursor:pointer}.prompt-map .recipe.repoOwned{border-color:#d8c298;background:#fffdf7}.prompt-map .recipe:hover{background:var(--soft)}.prompt-map .recipe.active{border-color:#111;box-shadow:inset 0 0 0 1px #111}.prompt-map .recipeName{min-width:0}.prompt-map .recipeName b{display:block;font:700 12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .recipeName small{display:block;margin-top:5px;color:var(--muted);font:10px var(--mono)}.prompt-map .recipeFlow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}.prompt-map .recipeStep{display:inline-flex;align-items:center;gap:7px}.prompt-map .recipePlus{color:var(--muted);font:12px var(--mono)}.prompt-map .recipeChip{display:inline-flex;align-items:center;min-height:26px;border:1px solid var(--line);border-radius:999px;padding:5px 9px;font:11px var(--mono);white-space:nowrap}.prompt-map button.recipeChip{cursor:pointer}.prompt-map button.recipeChip:hover,.prompt-map .recipeChip.variable.active{background:#111;color:#fff;border-color:#111}.prompt-map .recipeChip.static{background:#fff8ec;border-color:#e6d5b8}.prompt-map .recipeChip.data{background:#eef6ff;border-color:#cdddeb}.prompt-map .recipeChip.json{background:#effaf3;border-color:#cfe7d5}.prompt-map .recipeChip.runtime{background:#f4f4f4;border-color:#d9d9d9}.prompt-map .recipeChip.variable.active{box-shadow:0 0 0 2px rgba(17,17,17,.1)}.prompt-map .recipe.active .recipeName small{color:#555}
.prompt-map .grid{display:grid;grid-template-columns:minmax(330px,450px) minmax(430px,1fr);gap:18px;align-items:start}.prompt-map .panel{border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}.prompt-map .item{display:grid;grid-template-columns:92px 1fr 78px;gap:10px;width:100%;padding:10px 12px;border:0;border-bottom:1px solid var(--line);cursor:pointer;font:12px var(--mono);align-items:center;background:#fff;text-align:left}.prompt-map .item:last-child{border-bottom:0}.prompt-map .item:hover{background:var(--soft)}.prompt-map .item.active{background:#111;color:#fff}.prompt-map .tag{color:var(--muted);font-size:10px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .item.active .tag,.prompt-map .item.active .status{color:rgba(255,255,255,.62)}.prompt-map .status{font-size:10px;color:var(--muted);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .status.bad{color:#111;font-weight:700}.prompt-map .item.active .status.bad{color:rgba(255,255,255,.62)}
.prompt-map .promptTree{display:grid}.prompt-map .promptTreeRow{display:grid;grid-template-columns:25px minmax(0,1fr);align-items:stretch;border-bottom:1px solid var(--line)}.prompt-map .treeToggle{border:0;background:transparent;color:var(--muted);cursor:pointer;display:grid;place-items:center;padding:0}.prompt-map .treeToggle:hover{background:var(--soft);color:#111}.prompt-map .treeToggle.placeholder,.prompt-map .treeToggle.placeholder:hover{background:transparent;color:transparent;cursor:default;pointer-events:none}.prompt-map .treeCaret{width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:5px solid currentColor;transition:transform .18s ease,opacity .18s ease}.prompt-map .treeToggle.open .treeCaret{transform:rotate(90deg)}.prompt-map .treeToggle.placeholder .treeCaret{opacity:0}.prompt-map .promptTreeItem{border-bottom:0;min-height:38px;padding:8px 10px 8px 4px}.prompt-map .promptTreeItem>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .promptTreeItem small{display:block;margin-top:2px;color:var(--muted);font:10px var(--mono)}.prompt-map .promptTreeItem.active small{color:rgba(255,255,255,.62)}.prompt-map .promptTreeChildren{display:grid;grid-template-rows:0fr;opacity:.35;overflow:hidden;transition:grid-template-rows .2s ease,opacity .16s ease}.prompt-map .promptTreeChildren.open{grid-template-rows:1fr;opacity:1}.prompt-map .promptTreeChildrenInner{min-height:0;overflow:hidden}
.prompt-map .promptDefinition{padding:14px;display:grid;gap:12px}.prompt-map .definitionHero{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px}.prompt-map .definitionHero h2{margin:0;font:700 18px/1.15 var(--mono);letter-spacing:-.03em}.prompt-map .definitionHero p{margin:8px 0 0;color:var(--muted);font:12px/1.5 var(--mono);max-width:680px}.prompt-map .definitionCards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.prompt-map .definitionCard{border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 11px;min-width:0;text-align:left}.prompt-map button.definitionCard{font:inherit;color:inherit}.prompt-map .definitionCard.interactive{cursor:pointer}.prompt-map .definitionCard.interactive:hover{border-color:#111;background:var(--soft)}.prompt-map .definitionCard span,.prompt-map .definitionSection label{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase}.prompt-map .definitionCard b{display:block;margin-top:6px;font:700 12px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prompt-map .definitionCard small{display:block;margin-top:6px;color:var(--muted);font:10px/1.35 var(--mono);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.prompt-map .definitionSection{border:1px solid var(--line);border-radius:9px;background:#fff;padding:11px;display:grid;gap:9px}.prompt-map .definitionSection p{margin:0;color:var(--muted);font:12px/1.5 var(--mono)}.prompt-map .relationPanel{background:#f8fbff;border-color:#cdddeb}.prompt-map .relationChips{display:flex;flex-wrap:wrap;gap:7px}.prompt-map .relationChips button{border:1px solid #cdddeb;border-radius:999px;background:#fff;padding:5px 8px;font:11px var(--mono);cursor:pointer}.prompt-map .relationChips button:hover{background:#111;color:#fff;border-color:#111}.prompt-map .bodySource{background:#fffdf7;border-color:#d8c298}.prompt-map .bodySourceNote{color:#8a6a23!important}.prompt-map .bodySource pre{max-height:260px;overflow:auto;border:1px solid #e6d5b8;border-radius:8px;background:#fff;padding:10px;white-space:pre-wrap;font:11px/1.45 var(--mono)}.prompt-map .bodyVariable{display:inline;border:0;border-radius:5px;background:#eaf3ff;color:#075aa5;padding:1px 3px;margin:0 1px;font:inherit;cursor:pointer}.prompt-map .bodyVariable:hover,.prompt-map .bodyVariable.active{background:#111;color:#fff}.prompt-map .bodyVariable.active{box-shadow:0 0 0 2px rgba(17,17,17,.16)}
.prompt-map .promptCalls{width:100%;height:100%;min-height:0;max-width:none;display:grid;grid-template-columns:minmax(360px,520px) minmax(0,1fr);gap:12px;align-items:stretch}.prompt-map .callListPanel{height:100%;min-height:0;display:grid;grid-template-rows:36px minmax(0,1fr)}.prompt-map .callRows{overflow:auto}.prompt-map .callRow{width:100%;border:0;border-bottom:1px solid var(--line);background:#fff;display:grid;grid-template-columns:112px minmax(0,1fr) 58px;grid-template-areas:"time id status" "time project status";gap:3px 8px;padding:9px 10px;text-align:left;cursor:pointer;font:11px var(--mono)}.prompt-map .callRow:hover{background:var(--soft)}.prompt-map .callRow.active{background:#111;color:#fff}.prompt-map .callRow.warn:not(.active){box-shadow:inset 3px 0 0 #111}.prompt-map .callRow.info:not(.active){background:#f7f7f7}.prompt-map .callRow span{grid-area:time;align-self:center;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prompt-map .callRow b{grid-area:id;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 12px var(--mono)}.prompt-map .callRow small{grid-area:project;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .callRow em{grid-area:status;align-self:center;justify-self:end;border:1px solid var(--line);border-radius:999px;padding:3px 7px;color:var(--muted);font-style:normal;white-space:nowrap}.prompt-map .callRow.active span,.prompt-map .callRow.active small,.prompt-map .callRow.active em{color:rgba(255,255,255,.62)}.prompt-map .callDetailPanel{height:100%;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;gap:10px;min-width:0}.prompt-map .callHero{border:1px solid var(--line);border-radius:10px;background:#fff;padding:14px}.prompt-map .callHero h2{margin:0;font:700 22px/1.1 var(--sans);letter-spacing:-.03em}.prompt-map .callHero small{display:block;margin-top:7px;color:var(--muted);font:11px/1.4 var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .promptOutputGrid{height:100%;min-height:0;display:flex;flex-direction:column;gap:8px}.prompt-map .callTextPanel{border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden;min-width:0;min-height:36px;margin:0;display:grid;grid-template-rows:36px;flex:0 0 auto}.prompt-map .callTextPanel.active{min-height:0;grid-template-rows:36px minmax(0,1fr);flex:1 1 auto}.prompt-map .callTextTrigger{width:100%;border:0;background:#fff;padding:0 34px 0 12px;position:relative;text-align:left;cursor:pointer}.prompt-map .callTextTrigger::after{content:"+";position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--muted);font:12px var(--mono)}.prompt-map .callTextPanel.active .callTextTrigger{border-bottom:1px solid var(--line)}.prompt-map .callTextPanel.active .callTextTrigger::after{content:"-"}.prompt-map .callTextPanel pre{min-height:0;max-height:none;overflow:auto;white-space:pre-wrap;font:11px/1.5 var(--mono);padding:12px 14px}.prompt-map .systemRead{border:1px solid var(--line);border-radius:10px;background:#fff;padding:10px 12px;text-align:left}.prompt-map button.systemRead{cursor:pointer}.prompt-map button.systemRead:hover{background:var(--soft);border-color:#111}.prompt-map .systemRead.warn{border-color:#111}.prompt-map .systemRead.info{background:#f7f7f7}.prompt-map .systemRead span{color:var(--muted);font:10px var(--mono);letter-spacing:.05em;text-transform:uppercase}.prompt-map .systemRead b{display:block;margin-top:5px;font:700 13px var(--mono)}.prompt-map .systemRead small{display:block;margin-top:5px;color:var(--muted);font:11px/1.4 var(--mono)}.prompt-map .callMetaLine{display:flex;flex-wrap:wrap;gap:10px;border:1px solid var(--line);border-radius:9px;background:#fff;padding:8px 10px}.prompt-map .callMetaLine button{border:0;background:transparent;color:var(--muted);font:10px var(--mono);letter-spacing:.02em;overflow-wrap:anywhere;text-align:left;cursor:pointer;padding:0}.prompt-map .callMetaLine button:hover{color:#111;text-decoration:underline}
.prompt-map .observedRuns{display:grid;gap:16px;width:100%;max-width:1180px}
.prompt-map .runsTablePanel{width:100%}.prompt-map .runsTableWrap{overflow:auto}.prompt-map .runsTable{width:100%;min-width:900px;border-collapse:collapse;font:12px var(--mono)}.prompt-map .runsTable th{height:36px;padding:0 12px;border-bottom:1px solid var(--line);color:var(--muted);font:10px var(--mono);letter-spacing:.06em;text-align:left;text-transform:uppercase}.prompt-map .runsTable td{padding:12px;border-bottom:1px solid var(--line);vertical-align:middle}.prompt-map .runsTable tbody tr:last-child td{border-bottom:0}.prompt-map .runsTable tbody tr:hover{background:var(--soft)}.prompt-map .runsTable strong{display:block;font:700 12px var(--mono);white-space:nowrap}.prompt-map .runsTable small{display:block;margin-top:4px;color:var(--muted);font:10px var(--mono);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .runStatus{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:4px 7px;background:#fff;color:var(--muted);white-space:nowrap}.prompt-map .runStatus.warn{border-color:#111;color:#111;font-weight:700}.prompt-map .runStatus.ok{border-color:#cfcfcf;color:#111}.prompt-map .runStatus.info{background:var(--soft)}
.prompt-map .detailBar{border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}.prompt-map .detailBar div{display:grid;gap:3px;text-align:right}.prompt-map .detailBar span{color:var(--muted);font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase}.prompt-map .detailBar b{font:700 12px var(--mono)}
.prompt-map .runHero{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,360px);gap:16px;border:1px solid var(--line);border-radius:12px;background:#fff;padding:18px}
.prompt-map .runHero.warn{border-color:#111}.prompt-map .runHero.info{background:#f7f7f7}
.prompt-map .eyebrow{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px}
.prompt-map .runHero h2{margin:0 0 8px;font:700 24px/1.1 var(--sans);letter-spacing:-.03em}.prompt-map .runHero p{margin:0 0 8px;font:700 14px var(--mono)}.prompt-map .runHero small{display:block;color:var(--muted);font:11px/1.45 var(--mono)}
.prompt-map .nextIssue{border:1px solid #111;border-radius:10px;background:#fff;padding:12px;text-align:left;cursor:pointer}.prompt-map .nextIssue.clear{border-color:var(--line);cursor:default;background:var(--soft)}.prompt-map .nextIssue:hover:not(.clear){background:var(--soft)}.prompt-map .nextIssue span{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase}.prompt-map .nextIssue b{display:block;margin-top:7px;font:700 13px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .nextIssue small{display:block;margin-top:7px;color:var(--muted);font:10px/1.4 var(--mono)}
.prompt-map .runControlBar{display:grid;grid-template-columns:minmax(250px,330px) 1fr;gap:12px;align-items:stretch}
.prompt-map .runPicker{border:1px solid var(--line);border-radius:9px;background:#fff;padding:9px 10px;display:grid;gap:6px}.prompt-map .runPicker span{color:var(--muted);font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase}.prompt-map .runPicker select{width:100%;border:0;background:transparent;color:var(--text);font:12px var(--mono);outline:none}
.prompt-map .runReadout{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.prompt-map .readoutCard{border:1px solid var(--line);border-radius:9px;background:#fff;padding:10px 11px;min-width:0}.prompt-map .readoutCard.warn{border-color:#111}.prompt-map .readoutCard.info{background:var(--soft)}.prompt-map .readoutCard span{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.05em;text-transform:uppercase}.prompt-map .readoutCard b{display:block;margin-top:6px;font:700 12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .readoutCard small{display:block;margin-top:6px;color:var(--muted);font:10px/1.35 var(--mono);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.prompt-map .metricDetails{background:#fff}.prompt-map .metricDetails .runMetrics{padding:8px}.prompt-map .runMetrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.prompt-map .metric{border:1px solid var(--line);border-radius:9px;background:#fff;padding:9px 10px;min-width:0}.prompt-map .metric.warn{border-color:#111}.prompt-map .metric.info{background:var(--soft)}.prompt-map .metric span{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prompt-map .metric b{display:block;margin-top:6px;font:700 12px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prompt-map .observedLayout{display:grid;grid-template-columns:minmax(420px,1fr) minmax(360px,460px);gap:16px;align-items:start}.prompt-map .timelinePanel{min-height:360px}.prompt-map .callPanel{min-height:360px}.prompt-map .timeline{padding:10px;display:grid;gap:8px}.prompt-map .timelineStep{width:100%;border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px 11px;text-align:left;cursor:pointer}.prompt-map .timelineStep:hover{border-color:#111}.prompt-map .timelineStep.warn{border-color:#111}.prompt-map .timelineStep.info{background:var(--soft)}.prompt-map .timelineStep.active{background:#111;color:#fff;border-color:#111}.prompt-map .timelineStep .stepIndex{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.05em;text-transform:uppercase;margin-bottom:7px}.prompt-map .timelineStep strong{display:block;font:700 12px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .timelineStep small{display:block;margin-top:5px;color:var(--muted);font:10px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.prompt-map .timelineStep em{display:block;margin-top:8px;color:var(--muted);font:11px/1.35 var(--mono);font-style:normal}.prompt-map .timelineStep.active .stepIndex,.prompt-map .timelineStep.active small,.prompt-map .timelineStep.active em{color:rgba(255,255,255,.62)}
.prompt-map .issueDetails{background:#fff}.prompt-map .issueList{padding:8px;display:grid;gap:8px}.prompt-map .issueList button{border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px;text-align:left;cursor:pointer}.prompt-map .issueList button:hover{border-color:#111}.prompt-map .issueList span{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.05em;text-transform:uppercase}.prompt-map .issueList b{display:block;margin-top:6px;font:700 12px var(--mono)}.prompt-map .issueList small{display:block;margin-top:6px;color:var(--muted);font:10px/1.35 var(--mono)}
.prompt-map .empty{width:min(520px,100%);border:1px dashed var(--line2);border-radius:8px;background:#fff;padding:18px;font:12px/1.55 var(--mono);color:var(--muted)}.prompt-map .empty strong{display:block;color:var(--text);font:700 13px var(--sans);margin-bottom:8px}.prompt-map .empty p{margin:0}.prompt-map .emptyInline{padding:14px;color:var(--muted);font:12px var(--mono)}
.prompt-map .story{padding:12px;display:grid;gap:10px}.prompt-map .storyStep{border:1px solid var(--line);border-radius:8px;padding:11px 12px;background:#fff}.prompt-map .storyStep.important{border-color:#111}.prompt-map .storyStep label{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.05em;text-transform:uppercase;margin-bottom:7px}.prompt-map .storyStep strong{display:block;font:700 13px var(--mono);margin-bottom:6px}.prompt-map .storyStep small{display:block;color:var(--muted);font:11px/1.45 var(--mono)}.prompt-map .kv{display:grid;grid-template-columns:140px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font:11px/1.4 var(--mono)}.prompt-map .kv:last-child{border-bottom:0}.prompt-map .kv span{color:var(--muted)}.prompt-map .kv b{font-weight:500;overflow-wrap:anywhere}
.prompt-map .modal{position:fixed;inset:0;background:rgba(0,0,0,.18);display:none;align-items:center;justify-content:center;padding:24px;z-index:10}.prompt-map .modal.open{display:flex}.prompt-map .modalBox{width:min(980px,100%);max-height:88vh;background:#fff;border:1px solid var(--line2);border-radius:10px;display:grid;grid-template-rows:54px 1fr;box-shadow:0 20px 70px rgba(0,0,0,.18)}.prompt-map .modalTop{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:0 14px}.prompt-map .modalTop strong{font:700 13px var(--mono)}.prompt-map .modalMeta{color:var(--muted);font:11px var(--mono);margin-left:8px}.prompt-map .modalBody{overflow:auto}.prompt-map .close{border:1px solid var(--line2);background:#fff;border-radius:6px;padding:6px 9px;cursor:pointer;font:12px var(--mono)}
@media(max-width:1100px){.prompt-map{grid-template-columns:140px 1fr}.prompt-map .inspector{grid-column:1/-1;border-left:0;border-top:1px solid var(--line);min-height:280px}.prompt-map .grid,.prompt-map .promptCalls,.prompt-map .promptOutputGrid,.prompt-map .runHero,.prompt-map .runControlBar,.prompt-map .runReadout,.prompt-map .runMetrics,.prompt-map .observedLayout{grid-template-columns:1fr}.prompt-map .audit{min-width:920px}.prompt-map .loop{min-width:1320px}.prompt-map .callListPanel{max-height:none}}
`;

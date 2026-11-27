"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  Bot,
  Boxes,
  Braces,
  Columns3,
  Database,
  Film,
  GitBranch,
  GitCompareArrows,
  Globe2,
  Layers3,
  MousePointer2,
  Network,
  RadioTower,
  Pause,
  Play,
  Route,
  Server,
  SkipBack,
  SkipForward,
  Table2,
  Waypoints,
} from "lucide-react";
import {
  architectureStories,
  defaultArchitectureStory,
  type ArchitectureEdgeInfo,
  type ArchitectureFlowStep,
  type ArchitectureNodeInfo,
  type ArchitectureNodeKind,
  type ArchitectureOwnershipGroup,
  type ArchitecturePlane,
  type ArchitectureStory,
} from "@/lib/architecture-story";

type ArchitectureFlowNode = Node<ArchitectureNodeInfo, "architecture">;
type ArchitectureFlowEdge = Edge<ArchitectureEdgeInfo>;

type Selection =
  | {
      type: "node";
      id: string;
    }
  | {
      type: "edge";
      id: string;
    }
  | null;

const edgeColors: Record<ArchitectureEdgeInfo["tone"], string> = {
  input: "#2563eb",
  truth: "#0f766e",
  runtime: "#7c3aed",
  external: "#be123c",
  preview: "#b45309",
};

const kindIcons: Record<ArchitectureNodeKind, typeof Server> = {
  actor: MousePointer2,
  platform: Layers3,
  data: Database,
  runtime: Bot,
  external: Globe2,
  preview: RadioTower,
};

const kindLabels: Record<ArchitectureNodeKind, string> = {
  actor: "Actor",
  platform: "Platform",
  data: "Data",
  runtime: "Runtime",
  external: "External",
  preview: "Preview",
};

const storyIcons: Record<ArchitectureStory["mode"], typeof Server> = {
  network: Waypoints,
  planes: Columns3,
  "runtime-flow": Route,
  ownership: Table2,
  "spec-motion": Film,
};

function ArchitectureNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const Icon = kindIcons[data.kind];

  return (
    <article
      className={`architecture-node ${selected ? "is-selected" : ""}`}
      data-loop-id={`architecture.node.${data.id}`}
      data-loop-kind="architecture-node"
      data-loop-title={data.title}
      style={{ "--node-accent": data.accent } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="node-topline">
        <span className="node-icon" aria-hidden="true">
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span className="node-kind">{kindLabels[data.kind]}</span>
      </div>
      <h3>{data.title}</h3>
      <p>{data.subtitle}</p>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </article>
  );
}

function makeNodes(story: ArchitectureStory): ArchitectureFlowNode[] {
  return story.nodes.map((node) => ({
    id: node.id,
    type: "architecture",
    position: node.position,
    data: node,
  }));
}

function makeEdges(story: ArchitectureStory): ArchitectureFlowEdge[] {
  return story.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: edge,
    label: edge.label,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeColors[edge.tone],
      width: 18,
      height: 18,
    },
    style: {
      stroke: edgeColors[edge.tone],
      strokeWidth: 2,
    },
    labelStyle: {
      fill: "#1f2937",
      fontSize: 12,
      fontWeight: 650,
    },
    labelBgStyle: {
      fill: "#ffffff",
      fillOpacity: 0.92,
    },
    labelBgPadding: [8, 5],
    labelBgBorderRadius: 6,
  }));
}

export function ArchitectureLab() {
  const [activeStoryId, setActiveStoryId] = useState(defaultArchitectureStory.id);
  const activeStory =
    architectureStories.find((story) => story.id === activeStoryId) ??
    defaultArchitectureStory;
  const [selection, setSelection] = useState<Selection>(null);
  const nodeTypes = useMemo(
    () => ({
      architecture: ArchitectureNode,
    }),
    [],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<ArchitectureFlowNode>(
    makeNodes(activeStory),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<ArchitectureFlowEdge>(
    makeEdges(activeStory),
  );

  useEffect(() => {
    setNodes(makeNodes(activeStory));
    setEdges(makeEdges(activeStory));
    setSelection(null);
  }, [activeStory, setEdges, setNodes]);

  const selectedNode =
    selection?.type === "node"
      ? activeStory.nodes.find((node) => node.id === selection.id)
      : undefined;
  const selectedEdge =
    selection?.type === "edge"
      ? activeStory.edges.find((edge) => edge.id === selection.id)
      : undefined;

  return (
    <ReactFlowProvider>
      <main className="lab-shell" data-loop-id="architecture-lab.shell">
        <header className="lab-header" data-loop-id="architecture-lab.header">
          <div className="brand-mark" aria-hidden="true">
            <Network size={19} strokeWidth={2.2} />
          </div>
          <div>
            <h1>Ralph Arena Architecture Lab</h1>
            <p>{activeStory.canonicalBoundary}</p>
          </div>
          <div className="header-actions">
            <a
              href="https://github.com/Rrock-k/loopkit"
              target="_blank"
              rel="noreferrer"
              className="icon-link"
              data-loop-id="architecture-lab.header.loopkit-link"
              data-loop-kind="link"
              data-loop-title="LoopKit repository link"
              aria-label="LoopKit"
            >
              <Braces size={17} strokeWidth={2.2} />
              <span>LoopKit</span>
            </a>
          </div>
        </header>

        <div
          className={`lab-body ${
            activeStory.mode === "spec-motion" ? "is-presentation" : ""
          }`}
        >
          <aside className="story-rail" data-loop-id="architecture-lab.story-rail">
            <div className="rail-section-label">Stories</div>
            <div className="story-list">
              {architectureStories.map((story) => {
                const Icon = storyIcons[story.mode];
                return (
                  <button
                    key={story.id}
                    type="button"
                    className={`story-button ${
                      story.id === activeStory.id ? "is-active" : ""
                    }`}
                    data-loop-id={`architecture-lab.story.${story.id}`}
                    data-loop-kind="story-button"
                    data-loop-title={story.title}
                    onClick={() => setActiveStoryId(story.id)}
                  >
                    <Icon size={16} strokeWidth={2.2} />
                    <span>{story.shortTitle}</span>
                  </button>
                );
              })}
            </div>

            <div
              className="source-note"
              data-loop-id="architecture-lab.source-note"
              data-loop-kind="source-note"
              data-loop-title="Story source note"
            >
              <GitBranch size={15} strokeWidth={2.2} />
              <span>{activeStory.source}</span>
            </div>
          </aside>

          <section
            className={`canvas-shell canvas-mode-${activeStory.mode}`}
            data-loop-id={`architecture-lab.canvas.${activeStory.id}`}
            data-loop-kind="architecture-canvas"
            data-loop-title={`${activeStory.title} canvas`}
          >
            {activeStory.mode === "network" ? (
              <NetworkStory
                story={activeStory}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                setSelection={setSelection}
              />
            ) : null}
            {activeStory.mode === "planes" ? (
              <PlanesStory story={activeStory} setSelection={setSelection} />
            ) : null}
            {activeStory.mode === "runtime-flow" ? (
              <RuntimeFlowStory story={activeStory} setSelection={setSelection} />
            ) : null}
            {activeStory.mode === "spec-motion" ? (
              <SpecMotionStory story={activeStory} />
            ) : null}
            {activeStory.mode === "ownership" ? (
              <OwnershipStory story={activeStory} setSelection={setSelection} />
            ) : null}
          </section>

          {activeStory.mode !== "spec-motion" ? (
            <aside
              className="inspector"
              data-loop-id="architecture-lab.inspector"
              data-loop-kind="inspector"
              data-loop-title="Architecture inspector"
            >
              {selectedNode ? (
                <InspectorNode node={selectedNode} />
              ) : selectedEdge ? (
                <InspectorEdge edge={selectedEdge} />
              ) : (
                <StoryInspector story={activeStory} />
              )}
            </aside>
          ) : null}
        </div>
      </main>
    </ReactFlowProvider>
  );
}

function NetworkStory({
  story,
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onEdgesChange,
  setSelection,
}: {
  story: ArchitectureStory;
  nodes: ArchitectureFlowNode[];
  edges: ArchitectureFlowEdge[];
  nodeTypes: { architecture: typeof ArchitectureNode };
  onNodesChange: ReturnType<typeof useNodesState<ArchitectureFlowNode>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<ArchitectureFlowEdge>>[2];
  setSelection: (selection: Selection) => void;
}) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => setSelection({ type: "node", id: node.id })}
      onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.id })}
      onPaneClick={() => setSelection(null)}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.32}
      maxZoom={1.35}
      snapToGrid
      snapGrid={[12, 12]}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.2}
        color="#cbd5e1"
      />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeBorderRadius={6}
        nodeColor={(node) =>
          (node.data as ArchitectureNodeInfo | undefined)?.accent ?? "#64748b"
        }
      />
      <Panel position="top-left" className="canvas-panel">
        <Boxes size={15} strokeWidth={2.2} />
        <span>{story.title}</span>
      </Panel>
    </ReactFlow>
  );
}

function PlanesStory({
  story,
  setSelection,
}: {
  story: ArchitectureStory;
  setSelection: (selection: Selection) => void;
}) {
  const nodeById = makeNodeLookup(story);

  return (
    <div className="readable-view planes-view">
      <StoryCanvasHeader story={story} icon={Columns3} />
      <div className="plane-grid">
        {story.planes?.map((plane) => (
          <PlaneColumn
            key={plane.id}
            plane={plane}
            nodeById={nodeById}
            setSelection={setSelection}
          />
        ))}
      </div>
    </div>
  );
}

function RuntimeFlowStory({
  story,
  setSelection,
}: {
  story: ArchitectureStory;
  setSelection: (selection: Selection) => void;
}) {
  const nodeById = makeNodeLookup(story);

  return (
    <div className="readable-view runtime-flow-view">
      <StoryCanvasHeader story={story} icon={Route} />
      <div className="runtime-chain">
        {story.flowSteps?.map((step, index) => (
          <RuntimeStep
            key={step.id}
            step={step}
            nodeById={nodeById}
            setSelection={setSelection}
            isLast={index === (story.flowSteps?.length ?? 0) - 1}
          />
        ))}
      </div>
    </div>
  );
}

function OwnershipStory({
  story,
  setSelection,
}: {
  story: ArchitectureStory;
  setSelection: (selection: Selection) => void;
}) {
  const nodeById = makeNodeLookup(story);

  return (
    <div className="readable-view ownership-view">
      <StoryCanvasHeader story={story} icon={Table2} />
      <div className="ownership-grid">
        {story.ownershipGroups?.map((group) => (
          <OwnershipGroup
            key={group.id}
            group={group}
            nodeById={nodeById}
            setSelection={setSelection}
          />
        ))}
      </div>
    </div>
  );
}

function SpecMotionStory({ story }: { story: ArchitectureStory }) {
  const motion = story.motion;
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    setStepIndex(0);
    setIsPlaying(true);
  }, [story.id]);

  useEffect(() => {
    if (!isPlaying || !motion) {
      return;
    }

    const interval = window.setInterval(() => {
      setStepIndex((current) => (current + 1) % motion.steps.length);
    }, 2900);

    return () => window.clearInterval(interval);
  }, [isPlaying, motion]);

  if (!motion) {
    return null;
  }

  const activeStep = motion.steps[stepIndex];
  const progressPercent = ((stepIndex + 1) / motion.steps.length) * 100;
  const activePhaseIndex = Math.max(
    0,
    motion.outline.findIndex((section) => section.id === activeStep.phaseId),
  );
  const phaseProgressPercent =
    motion.outline.length > 1
      ? (activePhaseIndex / (motion.outline.length - 1)) * 100
      : 0;

  const goToStep = (index: number) => {
    setStepIndex(index);
    setIsPlaying(false);
  };

  const moveBy = (direction: 1 | -1) => {
    setStepIndex((current) => {
      const next = current + direction;
      if (next < 0) {
        return motion.steps.length - 1;
      }
      if (next >= motion.steps.length) {
        return 0;
      }
      return next;
    });
    setIsPlaying(false);
  };

  return (
    <div className="readable-view motion-view">
      <div className="motion-layout">
        <section
          className="motion-slide"
          data-loop-id="architecture.motion.slide.spec-update"
          data-loop-title="Spec update presentation slide"
        >
          <div className="motion-slide-top">
            <span>{activeStep.eyebrow}</span>
            <span>{activeStep.phase}</span>
          </div>

          <div
            key={activeStep.id}
            className="motion-slide-copy"
            data-loop-id={`architecture.motion.copy.${activeStep.id}`}
            data-loop-title={activeStep.title}
          >
            <div
              className="motion-infographic"
              data-loop-id="architecture.motion.infographic"
              data-loop-title="Spec update phase infographic"
              style={
                {
                  "--phase-progress": `${phaseProgressPercent}%`,
                } as React.CSSProperties
              }
            >
              <div className="motion-phase-rail" aria-hidden="true">
                <span />
              </div>
              {motion.outline.map((section, index) => (
                <div
                  key={section.id}
                  className={`motion-phase-dot ${
                    index === activePhaseIndex ? "is-active" : ""
                  } ${index < activePhaseIndex ? "is-complete" : ""}`}
                >
                  <span>{index + 1}</span>
                  <strong>{section.title}</strong>
                </div>
              ))}
            </div>
            <h2>{activeStep.title}</h2>
            <p>{activeStep.narration}</p>
          </div>

          <div className="motion-slide-bottom">
            <div className="motion-progress" aria-hidden="true">
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="motion-controls">
              <button
                type="button"
                className="motion-icon-button"
                aria-label="Previous step"
                data-loop-id="architecture.motion.control.previous"
                onClick={() => moveBy(-1)}
              >
                <SkipBack size={16} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="motion-play-button"
                aria-label={isPlaying ? "Pause" : "Play"}
                data-loop-id="architecture.motion.control.play"
                onClick={() => setIsPlaying((current) => !current)}
              >
                {isPlaying ? (
                  <Pause size={16} strokeWidth={2.2} />
                ) : (
                  <Play size={16} strokeWidth={2.2} />
                )}
                <span>{isPlaying ? "Pause" : "Play"}</span>
              </button>
              <button
                type="button"
                className="motion-icon-button"
                aria-label="Next step"
                data-loop-id="architecture.motion.control.next"
                onClick={() => moveBy(1)}
              >
                <SkipForward size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </section>

        <aside
          className="motion-outline"
          data-loop-id="architecture.motion.outline"
          data-loop-title="Spec update outline"
        >
          <div className="motion-outline-title">
            <Film size={15} strokeWidth={2.2} />
            <span>Оглавление</span>
          </div>
          <div className="motion-outline-phases">
            {motion.outline.map((section) => (
              <span key={section.id}>{section.title}</span>
            ))}
          </div>
          <div className="motion-step-list">
            {motion.steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                className={`motion-step-button ${
                  index === stepIndex ? "is-active" : ""
                }`}
                data-loop-id={`architecture.motion.step.${step.id}`}
                data-loop-title={step.title}
                onClick={() => goToStep(index)}
              >
                <span>{step.eyebrow}</span>
                <strong>{step.title}</strong>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function StoryCanvasHeader({
  story,
  icon: Icon,
}: {
  story: ArchitectureStory;
  icon: typeof Server;
}) {
  return (
    <div
      className="readable-header"
      data-loop-id={`architecture-lab.readable-header.${story.id}`}
      data-loop-title={`${story.title} header`}
    >
      <div className="readable-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div>
        <h2>{story.title}</h2>
        <p>{story.summary}</p>
      </div>
    </div>
  );
}

function PlaneColumn({
  plane,
  nodeById,
  setSelection,
}: {
  plane: ArchitecturePlane;
  nodeById: Map<string, ArchitectureNodeInfo>;
  setSelection: (selection: Selection) => void;
}) {
  return (
    <section
      className="plane-column"
      data-loop-id={`architecture.plane.${plane.id}`}
      data-loop-title={plane.title}
    >
      <div className="plane-header">
        <h3>{plane.title}</h3>
        <p>{plane.subtitle}</p>
      </div>
      <div className="plane-card-list">
        {plane.nodeIds.map((nodeId) => {
          const node = nodeById.get(nodeId);
          return node ? (
            <ReadableNodeCard
              key={node.id}
              node={node}
              loopPrefix={`architecture.plane.${plane.id}`}
              onClick={() => setSelection({ type: "node", id: node.id })}
            />
          ) : null;
        })}
      </div>
    </section>
  );
}

function RuntimeStep({
  step,
  nodeById,
  setSelection,
  isLast,
}: {
  step: ArchitectureFlowStep;
  nodeById: Map<string, ArchitectureNodeInfo>;
  setSelection: (selection: Selection) => void;
  isLast: boolean;
}) {
  const node = nodeById.get(step.nodeId);

  return (
    <section
      className="runtime-step"
      data-loop-id={`architecture.runtime-step.${step.id}`}
      data-loop-title={step.title}
    >
      <div className="step-main">
        <div className="step-index" aria-hidden="true">
          <GitCompareArrows size={16} strokeWidth={2.2} />
        </div>
        <div>
          <h3>{step.title}</h3>
          <p>{step.subtitle}</p>
        </div>
      </div>
      {node ? (
        <ReadableNodeCard
          node={node}
          loopPrefix={`architecture.runtime-step.${step.id}`}
          onClick={() => setSelection({ type: "node", id: node.id })}
        />
      ) : null}
      {step.sidecars?.length ? (
        <div className="sidecar-grid">
          {step.sidecars.map((sidecar) => {
            const sidecarNode = nodeById.get(sidecar.nodeId);
            return sidecarNode ? (
              <button
                key={sidecar.id}
                type="button"
                className="sidecar-card"
                data-loop-id={`architecture.runtime-sidecar.${sidecar.id}`}
                data-loop-title={sidecar.title}
                onClick={() => setSelection({ type: "node", id: sidecarNode.id })}
              >
                <span>{sidecar.title}</span>
                <small>{sidecar.subtitle}</small>
              </button>
            ) : null;
          })}
        </div>
      ) : null}
      {!isLast ? <div className="step-connector" aria-hidden="true" /> : null}
    </section>
  );
}

function OwnershipGroup({
  group,
  nodeById,
  setSelection,
}: {
  group: ArchitectureOwnershipGroup;
  nodeById: Map<string, ArchitectureNodeInfo>;
  setSelection: (selection: Selection) => void;
}) {
  return (
    <section
      className="ownership-group"
      data-loop-id={`architecture.ownership-group.${group.id}`}
      data-loop-title={group.title}
    >
      <div className="ownership-heading">
        <h3>{group.title}</h3>
        <p>{group.subtitle}</p>
      </div>
      <div className="ownership-card-list">
        {group.nodeIds.map((nodeId) => {
          const node = nodeById.get(nodeId);
          return node ? (
            <ReadableNodeCard
              key={node.id}
              node={node}
              loopPrefix={`architecture.ownership.${group.id}`}
              onClick={() => setSelection({ type: "node", id: node.id })}
              dense
            />
          ) : null;
        })}
      </div>
    </section>
  );
}

function ReadableNodeCard({
  node,
  loopPrefix,
  onClick,
  dense = false,
}: {
  node: ArchitectureNodeInfo;
  loopPrefix: string;
  onClick: () => void;
  dense?: boolean;
}) {
  const Icon = kindIcons[node.kind];

  return (
    <button
      type="button"
      className={`readable-node-card ${dense ? "is-dense" : ""}`}
      data-loop-id={`${loopPrefix}.node.${node.id}`}
      data-loop-kind="architecture-node-card"
      data-loop-title={node.title}
      onClick={onClick}
      style={{ "--node-accent": node.accent } as React.CSSProperties}
    >
      <span className="node-topline">
        <span className="node-icon" aria-hidden="true">
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span>{kindLabels[node.kind]}</span>
      </span>
      <strong>{node.title}</strong>
      <small>{dense ? node.owner : node.subtitle}</small>
    </button>
  );
}

function StoryInspector({ story }: { story: ArchitectureStory }) {
  return (
    <div
      data-loop-id={`architecture-lab.inspector.story.${story.id}`}
      data-loop-title={`${story.title} inspector`}
    >
      <div className="inspector-kicker">Story</div>
      <h2>{story.title}</h2>
      <p className="inspector-subtitle">{story.summary}</p>
      <dl className="fact-list">
        <div>
          <dt>Version</dt>
          <dd>{story.version}</dd>
        </div>
        <div>
          <dt>Boundary</dt>
          <dd>{story.canonicalBoundary}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{story.source}</dd>
        </div>
      </dl>
    </div>
  );
}

function InspectorNode({ node }: { node: ArchitectureNodeInfo }) {
  const Icon = kindIcons[node.kind];

  return (
    <div
      data-loop-id={`architecture-lab.inspector.node.${node.id}`}
      data-loop-title={`${node.title} inspector`}
    >
      <div className="inspector-kicker">
        <Icon size={15} strokeWidth={2.2} />
        <span>{kindLabels[node.kind]}</span>
      </div>
      <h2>{node.title}</h2>
      <p className="inspector-subtitle">{node.subtitle}</p>
      <dl className="fact-list">
        <div>
          <dt>Владеет</dt>
          <dd>{node.owner}</dd>
        </div>
        <div>
          <dt>Не владеет</dt>
          <dd>{node.notOwner}</dd>
        </div>
        <div>
          <dt>Контракт</dt>
          <dd>{node.contract}</dd>
        </div>
        {node.contains ? (
          <div>
            <dt>Внутри</dt>
            <dd>
              <ul className="compact-list">
                {node.contains.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Source</dt>
          <dd>{node.source}</dd>
        </div>
      </dl>
    </div>
  );
}

function InspectorEdge({ edge }: { edge: ArchitectureEdgeInfo }) {
  return (
    <div
      data-loop-id={`architecture-lab.inspector.edge.${edge.id}`}
      data-loop-title={`${edge.label} edge inspector`}
    >
      <div className="inspector-kicker">
        <GitBranch size={15} strokeWidth={2.2} />
        <span>Flow</span>
      </div>
      <h2>{edge.label}</h2>
      <dl className="fact-list">
        <div>
          <dt>From</dt>
          <dd>{edge.source}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{edge.target}</dd>
        </div>
        <div>
          <dt>Tone</dt>
          <dd>{edge.tone}</dd>
        </div>
      </dl>
    </div>
  );
}

function makeNodeLookup(story: ArchitectureStory) {
  return new Map(story.nodes.map((node) => [node.id, node]));
}

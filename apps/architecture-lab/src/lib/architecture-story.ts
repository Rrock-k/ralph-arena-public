export type ArchitectureNodeKind =
  | "actor"
  | "platform"
  | "data"
  | "runtime"
  | "external"
  | "preview";

export type ArchitectureNodeInfo = {
  id: string;
  title: string;
  subtitle: string;
  owner: string;
  notOwner: string;
  contract: string;
  contains?: string[];
  kind: ArchitectureNodeKind;
  source: string;
  accent: string;
  position: {
    x: number;
    y: number;
  };
};

export type ArchitectureEdgeInfo = {
  id: string;
  source: string;
  target: string;
  label: string;
  tone: "input" | "truth" | "runtime" | "external" | "preview";
};

export type ArchitecturePlane = {
  id: string;
  title: string;
  subtitle: string;
  nodeIds: string[];
};

export type ArchitectureFlowStep = {
  id: string;
  title: string;
  subtitle: string;
  nodeId: string;
  sidecars?: Array<{
    id: string;
    title: string;
    subtitle: string;
    nodeId: string;
  }>;
};

export type ArchitectureOwnershipGroup = {
  id: string;
  title: string;
  subtitle: string;
  nodeIds: string[];
};

export type ArchitectureMotionStep = {
  id: string;
  eyebrow: string;
  phaseId: string;
  phase: string;
  title: string;
  narration: string;
};

export type ArchitectureMotionStory = {
  outline: Array<{
    id: string;
    title: string;
  }>;
  steps: ArchitectureMotionStep[];
};

export type ArchitectureStoryMode =
  | "network"
  | "planes"
  | "runtime-flow"
  | "ownership"
  | "spec-motion";

export type ArchitectureStory = {
  id: string;
  title: string;
  shortTitle: string;
  version: string;
  source: string;
  canonicalBoundary: string;
  mode: ArchitectureStoryMode;
  summary: string;
  nodes: ArchitectureNodeInfo[];
  edges: ArchitectureEdgeInfo[];
  planes?: ArchitecturePlane[];
  flowSteps?: ArchitectureFlowStep[];
  ownershipGroups?: ArchitectureOwnershipGroup[];
  motion?: ArchitectureMotionStory;
};

const source = "docs/project-structure-map.md";

export const architectureNodes: ArchitectureNodeInfo[] = [
  {
    id: "user",
    title: "Пользователь / оператор",
    subtitle: "Manager, admin, reviewer",
    owner: "Human intent and review",
    notOwner: "Runtime, lifecycle, product storage",
    contract: "Uses UI/admin surfaces; does not mutate runtime directly.",
    kind: "actor",
    source,
    accent: "#2563eb",
    position: { x: 0, y: 80 },
  },
  {
    id: "tg-spec",
    title: "tg-spec / Telegram",
    subtitle: "Accepted spec and feedback producer",
    owner: "Structured imported spec and feedback handoff",
    notOwner: "Arena lifecycle or runtime scheduling",
    contract: "Sends accepted artifacts into governance import boundary.",
    kind: "external",
    source,
    accent: "#0f766e",
    position: { x: 0, y: 300 },
  },
  {
    id: "governance",
    title: "Governance Platform",
    subtitle: "apps/governance-platform",
    owner: "UI, auth, admin actions, internal APIs, persistence boundary",
    notOwner: "Direct Docker runtime execution",
    contract: "Writes project/component intent and exposes internal runtime APIs.",
    contains: [
      "UI and admin actions",
      "Internal runtime APIs",
      "Project/spec/component persistence boundary",
    ],
    kind: "platform",
    source,
    accent: "#7c3aed",
    position: { x: 250, y: 190 },
  },
  {
    id: "postgres",
    title: "Postgres",
    subtitle: "Project, ProjectComponent, SpecVersion, RunLog",
    owner: "Persisted project/spec/component truth",
    notOwner: "Live Docker or provider execution",
    contract: "Stores current platform records and runtime observations.",
    kind: "data",
    source,
    accent: "#0f766e",
    position: { x: 500, y: 20 },
  },
  {
    id: "authd",
    title: "authd",
    subtitle: "services/authd",
    owner: "Claude OAuth and Codex subscription auth authority",
    notOwner: "Project secrets or API-key policy",
    contract: "Provides runtime auth snapshots without moving refresh tokens into apps.",
    kind: "platform",
    source,
    accent: "#be123c",
    position: { x: 500, y: 190 },
  },
  {
    id: "api-proxy",
    title: "API Proxy",
    subtitle: "services/api-proxy",
    owner: "Provider proxying, usage accounting, budget enforcement",
    notOwner: "Auth source of truth",
    contract: "Applies provider traffic policy before calls reach LLM providers.",
    kind: "platform",
    source,
    accent: "#c2410c",
    position: { x: 500, y: 360 },
  },
  {
    id: "worker",
    title: "Worker Agent",
    subtitle: "services/worker-agent",
    owner: "Runtime-intent claims and Docker preview containers",
    notOwner: "Product/spec interpretation",
    contract: "Claims runtime intent and starts, stops, or reconciles preview containers.",
    kind: "runtime",
    source,
    accent: "#2563eb",
    position: { x: 750, y: 190 },
  },
  {
    id: "github",
    title: "GitHub repos",
    subtitle: "Project source remotes",
    owner: "External source remote",
    notOwner: "Arena lifecycle state",
    contract:
      "Worker/runtime may clone or push source, but source truth remains explicit repo URL and branch.",
    kind: "external",
    source,
    accent: "#475569",
    position: { x: 750, y: 20 },
  },
  {
    id: "preview-container",
    title: "Preview Container",
    subtitle: "runner, workspace, Ralph loop, CLI, app",
    owner: "Runtime workspace, loop command launch, app preview process",
    notOwner: "Governance lifecycle truth or product/spec ownership",
    contract:
      "Worker starts the container; runner prepares workspace and reports status back to governance.",
    contains: [
      "services/arena-runner as PID 1",
      "/workspace with project code and .arena channel",
      "packages/loops/ralph-runtime",
      "Agent CLI",
      "Project app preview",
    ],
    kind: "preview",
    source,
    accent: "#0891b2",
    position: { x: 1000, y: 190 },
  },
  {
    id: "caddy",
    title: "Caddy / Preview Router",
    subtitle: "Preview ingress",
    owner: "External preview routing",
    notOwner: "Project app behavior or loop work",
    contract: "Routes preview traffic from app container to user-facing URL.",
    kind: "preview",
    source,
    accent: "#0f766e",
    position: { x: 1000, y: 20 },
  },
  {
    id: "providers",
    title: "LLM Providers",
    subtitle: "External model APIs",
    owner: "Model responses and provider limits",
    notOwner: "Arena retry, budget, or lifecycle truth",
    contract: "Reached through proxy policy or provider CLI calls.",
    kind: "external",
    source,
    accent: "#be123c",
    position: { x: 750, y: 520 },
  },
];

export const architectureEdges: ArchitectureEdgeInfo[] = [
  {
    id: "user-governance",
    source: "user",
    target: "governance",
    label: "UI / admin actions",
    tone: "input",
  },
  {
    id: "tg-governance",
    source: "tg-spec",
    target: "governance",
    label: "import spec / feedback",
    tone: "input",
  },
  {
    id: "governance-postgres",
    source: "governance",
    target: "postgres",
    label: "persist project truth",
    tone: "truth",
  },
  {
    id: "governance-authd",
    source: "governance",
    target: "authd",
    label: "auth snapshot",
    tone: "truth",
  },
  {
    id: "governance-proxy",
    source: "governance",
    target: "api-proxy",
    label: "provider policy",
    tone: "truth",
  },
  {
    id: "proxy-providers",
    source: "api-proxy",
    target: "providers",
    label: "metered provider calls",
    tone: "external",
  },
  {
    id: "governance-worker",
    source: "governance",
    target: "worker",
    label: "runtime intents",
    tone: "runtime",
  },
  {
    id: "worker-github",
    source: "worker",
    target: "github",
    label: "source operations",
    tone: "external",
  },
  {
    id: "worker-runner",
    source: "worker",
    target: "preview-container",
    label: "docker preview runtime",
    tone: "runtime",
  },
  {
    id: "preview-governance",
    source: "preview-container",
    target: "governance",
    label: "logs / progress / terminal",
    tone: "truth",
  },
  {
    id: "preview-providers",
    source: "preview-container",
    target: "providers",
    label: "agent CLI provider calls",
    tone: "external",
  },
  {
    id: "preview-caddy",
    source: "preview-container",
    target: "caddy",
    label: "preview HTTP",
    tone: "preview",
  },
  {
    id: "caddy-user",
    source: "caddy",
    target: "user",
    label: "user-facing preview",
    tone: "preview",
  },
];

const canonicalBoundary =
  "Projection from docs/project-structure-map.md; code and canonical contracts remain truth owners.";

const specMotionSource =
  "docs/project-structure-map.md + docs/contracts/project-runtime-preview-business-contract.md";

const baseStory = {
  version: "v4",
  source,
  canonicalBoundary,
  nodes: architectureNodes,
  edges: architectureEdges,
};

export const architectureStories: ArchitectureStory[] = [
  {
    ...baseStory,
    id: "network-map",
    title: "Общая архитектура проекта",
    shortTitle: "Network map",
    mode: "network",
    summary: "Полная карта связей. Полезна как индекс, но не лучший первый экран.",
  },
  {
    ...baseStory,
    id: "planes",
    title: "Архитектурные плоскости",
    shortTitle: "Плоскости",
    mode: "planes",
    summary:
      "Самый читаемый общий вид: кто приходит извне, где control plane, где runtime, где preview.",
    planes: [
      {
        id: "inputs",
        title: "Input surfaces",
        subtitle: "Human and spec inputs",
        nodeIds: ["user", "tg-spec"],
      },
      {
        id: "control-plane",
        title: "Control plane",
        subtitle: "Intent, persistence, auth, policy",
        nodeIds: ["governance", "postgres", "authd", "api-proxy"],
      },
      {
        id: "runtime-plane",
        title: "Runtime plane",
        subtitle: "Claim and container execution",
        nodeIds: ["worker", "preview-container"],
      },
      {
        id: "external-plane",
        title: "External systems",
        subtitle: "Repos and providers",
        nodeIds: ["github", "providers"],
      },
      {
        id: "preview-plane",
        title: "Preview plane",
        subtitle: "User-facing app route",
        nodeIds: ["caddy"],
      },
    ],
  },
  {
    ...baseStory,
    id: "runtime-flow",
    title: "Runtime claim flow",
    shortTitle: "Runtime flow",
    mode: "runtime-flow",
    summary:
      "Линейный путь запуска: intent в governance, claim в worker, container, status назад.",
    flowSteps: [
      {
        id: "request",
        title: "Request",
        subtitle: "User action or accepted spec reaches governance",
        nodeId: "user",
        sidecars: [
          {
            id: "request-tg",
            title: "Accepted spec",
            subtitle: "tg-spec import is input, not lifecycle truth",
            nodeId: "tg-spec",
          },
        ],
      },
      {
        id: "intent",
        title: "Intent boundary",
        subtitle: "Governance writes project/component intent",
        nodeId: "governance",
        sidecars: [
          {
            id: "intent-db",
            title: "Persisted truth",
            subtitle: "Project, ProjectComponent, SpecVersion, RunLog",
            nodeId: "postgres",
          },
          {
            id: "intent-auth",
            title: "Auth snapshot",
            subtitle: "authd remains auth authority",
            nodeId: "authd",
          },
        ],
      },
      {
        id: "claim",
        title: "Claim",
        subtitle: "Worker claims runtime intent and prepares Docker runtime",
        nodeId: "worker",
        sidecars: [
          {
            id: "claim-source",
            title: "Source ops",
            subtitle: "repoUrl + repoBranch remain explicit source truth",
            nodeId: "github",
          },
        ],
      },
      {
        id: "container",
        title: "Preview container",
        subtitle: "Runner prepares workspace and launches loop/app command",
        nodeId: "preview-container",
        sidecars: [
          {
            id: "container-proxy",
            title: "Provider policy",
            subtitle: "API Proxy meters provider traffic",
            nodeId: "api-proxy",
          },
          {
            id: "container-provider",
            title: "Model execution",
            subtitle: "Provider output is not Arena lifecycle truth",
            nodeId: "providers",
          },
        ],
      },
      {
        id: "preview",
        title: "Preview route",
        subtitle: "Caddy exposes the project app back to the user",
        nodeId: "caddy",
      },
    ],
  },
  {
    ...baseStory,
    id: "spec-motion",
    title: "Новая версия спеки",
    shortTitle: "Spec motion",
    source: specMotionSource,
    mode: "spec-motion",
    summary:
      "Мини-презентация: что происходит, когда в проект приходит новая accepted spec.",
    motion: {
      outline: [
        { id: "input", title: "Вход" },
        { id: "truth", title: "Правда" },
        { id: "runtime", title: "Работа" },
        { id: "result", title: "Результат" },
      ],
      steps: [
        {
          id: "arrives",
          eyebrow: "01",
          phaseId: "input",
          phase: "Вход",
          title: "Пришла новая спека.",
          narration: "Arena получила новый accepted input.",
        },
        {
          id: "imported",
          eyebrow: "02",
          phaseId: "input",
          phase: "Вход",
          title: "Governance принимает её.",
          narration: "Это обычный import, не новый lifecycle state.",
        },
        {
          id: "artifact",
          eyebrow: "03",
          phaseId: "truth",
          phase: "Правда",
          title: "Появляется единая правда.",
          narration: "AcceptedSpecArtifact хранит смысл новой версии.",
        },
        {
          id: "work-impact",
          eyebrow: "04",
          phaseId: "truth",
          phase: "Правда",
          title: "Система понимает: нужна ли работа?",
          narration: "Только requires_loop_work будит Ralph.",
        },
        {
          id: "handoff",
          eyebrow: "05",
          phaseId: "runtime",
          phase: "Работа",
          title: "Спека передаётся в runtime.",
          narration: "Runner отдаёт её Ralph через spec-input.",
        },
        {
          id: "reconcile",
          eyebrow: "06",
          phaseId: "runtime",
          phase: "Работа",
          title: "Ralph сверяет текущий план.",
          narration: "Он не должен начинать вторую задачу поверх незакрытой.",
        },
        {
          id: "execute",
          eyebrow: "07",
          phaseId: "runtime",
          phase: "Работа",
          title: "Executor меняет проект.",
          narration: "Код и preview обновляются по accepted diff.",
        },
        {
          id: "report",
          eyebrow: "08",
          phaseId: "result",
          phase: "Результат",
          title: "Status возвращается назад.",
          narration: "Governance получает progress и terminal result.",
        },
        {
          id: "snapshot",
          eyebrow: "09",
          phaseId: "result",
          phase: "Результат",
          title: "UI показывает понятную проекцию.",
          narration: "Он читает truth, а не собирает её заново.",
        },
        {
          id: "human",
          eyebrow: "10",
          phaseId: "result",
          phase: "Результат",
          title: "Человек видит результат.",
          narration: "Новый feedback снова приходит как accepted input.",
        },
      ],
    },
  },
  {
    ...baseStory,
    id: "ownership",
    title: "Ownership map",
    shortTitle: "Ownership",
    mode: "ownership",
    summary:
      "Сравнительный вид: какие boundary владеют truth, а какие только исполняют или маршрутизируют.",
    ownershipGroups: [
      {
        id: "truth",
        title: "Truth owners",
        subtitle: "Persisted or explicit platform truth",
        nodeIds: ["governance", "postgres", "authd", "api-proxy"],
      },
      {
        id: "runtime",
        title: "Runtime executors",
        subtitle: "Execute and report; do not own product/lifecycle truth",
        nodeIds: ["worker", "preview-container"],
      },
      {
        id: "external",
        title: "External dependencies",
        subtitle: "Inputs/remotes/providers outside Arena ownership",
        nodeIds: ["tg-spec", "github", "providers"],
      },
      {
        id: "surface",
        title: "Human-facing surfaces",
        subtitle: "Where operators and users see or request work",
        nodeIds: ["user", "caddy"],
      },
    ],
  },
];

export const defaultArchitectureStory = architectureStories[1];

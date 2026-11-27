"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  useLogStream,
  type LogLine,
  parseJsonlText,
} from "@/hooks/useLogStream";
import { LogView } from "../LogView";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bell,
  CreditCard,
  DollarSign,
  Flag,
  FlaskConical,
  Folder,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  buildLabelCache,
  formatAgentLabel,
  setLabelCache,
} from "@/lib/agent-labels-shared";
import { BackendBadgeCompact } from "../BackendBadge";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { powerOffAllRunning } from "@/app/actions/container-ops";
import { cleanupHetznerOrphans } from "@/app/actions/runtime-maintenance";
import { CollapsibleSection } from "./CollapsibleSection";
import { ProjectSidebar } from "./ProjectSidebar";
import { OverviewPanel } from "./OverviewPanel";
import { ContainerPanel } from "./ContainerPanel";
import { VpsPanel } from "./VpsPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { CyclePanel } from "./CyclePanel";
import { BudgetPanel } from "./BudgetPanel";
import { SpecsPanel } from "./SpecsPanel";
import { ProjectAssetsSection } from "../ProjectAssetsSection";
import { ProposalsTab } from "../ProposalsTab";
import { SeasonsTab } from "../SeasonsTab";
import { LoopsTab } from "../LoopsTab";
import { ToolsTab } from "../ToolsTab";
import { FeatureFlagsTab } from "../FeatureFlagsTab";
import { VpsFleetTab } from "./VpsFleetTab";
import type { VpsFleetEntry } from "@/lib/action-types";
import { ProjectsGrid } from "../ProjectsGrid";
import { ExploreOrderManager } from "../ExploreOrderManager";
import { VisibilitySelector } from "../VisibilitySelector";
import { TestsTab } from "@/components/project/TestsTab";
import { PreviewIframe } from "@/components/preview/PreviewIframe";
import { JobsTab } from "../JobsTab";
import { NotificationsTab } from "../NotificationsTab";
import { CreditAccountsTab } from "../CreditAccountsTab";
import { LabTab } from "./LabTab";
import { ProjectsTable } from "../ProjectsTable";
import { CreateProjectButton } from "@/components/projects/CreateProjectButton";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Runtime actions now via shared useActionHandlers in ProjectContextMenu
import { AddCreditsButton } from "../AddCreditsButton";
import { ProjectDeleteDialog } from "../ProjectDeleteDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  getProjectActions,
  groupedActions,
  type ProjectActionContext,
} from "../ProjectActions";
import { RenameDialog, useActionHandlers } from "../ProjectContextMenu";
import { RunLogViewer } from "../RunLogViewer";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { RequiredSecretEntry } from "@/lib/required-secrets";
import { getProjectName } from "@/lib/project-identity";
import { getAdminProjectLabel } from "@/lib/admin-project-label";
import { getAdminLoopIdentity } from "@/lib/admin-loop-identity";
import type { ProviderQuotaResponse } from "@/lib/provider-quotas";
import { QuotaPanel } from "./QuotaPanel";
import { AccessTab } from "../access/AccessTab";
import { ProjectAccessPanel } from "../access/ProjectAccessPanel";
import type {
  AccessAdminData,
  ProjectAccessPanelState,
  AccessCapability,
} from "@/lib/access-control/types";
import type { LocalConfigReadinessSnapshot } from "@/lib/local-config-readiness";
import type { TelegramAccountAuditSnapshot } from "@/lib/telegram-account-audit-types";
import { getBatchPowerOffCopy } from "@/lib/power-off-warning";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";
import type { FeatureFlagsSnapshot } from "@/lib/feature-flags";
import { formatAdminShortTimestamp } from "@/lib/admin-time-format";
import {
  OPS_STATUS_PRIORITY,
  getAppComponent,
  getOpsDisplayStatus,
  isOpsActiveStatus,
  statusDotColor,
  type OpsComponentState,
} from "@/lib/operator-display";
import { mergeOpsProjectSnapshots, shouldPollSelectedOpsProject } from "./live-project-merge";
import { computeOpsMetrics } from "./ops-metrics";
import type { AdminJobsData } from "@/lib/admin-jobs-types";

export type OpsVisualEvidenceMode = "off" | "required" | "new_tasks_only";

export interface OpsProject {
  id: string;
  status: string;
  slug?: string | null;
  useRepoHead?: boolean;
  loopVersion?: string | null;
  loopName?: string | null;
  loopSupportTier?: string | null;
  loopRuntime?: string | null;
  loopSupportStatus?: "supported" | "upgrade-required" | "unsupported" | null;
  loopSupportLabel?: string | null;
  loopSupportHint?: string | null;
  visualEvidenceMode: OpsVisualEvidenceMode | null;
  visualEvidenceModeError?: string | null;
  appStartAllowed?: boolean;
  agentStartAllowed?: boolean;
  relaunchAllowed?: boolean;
  archivedAt?: string | null;
  agent: string;
  agentImpl: string;
  toolId?: string | null;
  agentLoopVersionId?: string | null;
  model?: string | null;
  providerBillingMode?: string | null;
  runnerBackend?: string | null;
  createdAt: string;
  updatedAt: string;
  estimatedCostUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  commitSha?: string | null;
  lastOutcome?: string | null;
  visibility?: string;
  showAiDisclaimer?: boolean;
  exploreRank?: number | null;
  isPinned?: boolean;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  progressJson?: string | null;
  components?: OpsComponentState[] | null;
  requiredSecrets: RequiredSecretEntry[];
  secrets: {
    id: string;
    key: string;
    description?: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  }[];
  name?: string | null;
  proposal?: {
    id?: string;
    title?: string | null;
    description?: string | null;
  } | null;
  budget?: {
    isEnabled: boolean;
    totalCreditsUsd: number;
    usedCreditsUsd: number;
  } | null;
  vpsHost?: {
    id: string;
    status: string;
    ip?: string | null;
    region?: string | null;
    serverType?: string | null;
  } | null;
  runLogs: {
    id: string;
    event: string;
    detail?: string | null;
    createdAt: string;
  }[];
  contextQuestionEvents?: {
    id: string;
    direction: string;
    type: string;
    payload: unknown;
    createdAt: string | Date;
  }[];
  specs: {
    id: string;
    title?: string | null;
    content: string;
    orderIndex: number;
  }[];
  assets: {
    id: string;
    path: string;
    originalName: string;
    contentType: string | null;
    sizeBytes: number;
    sha256: string;
    uploadedById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  accessCapabilities?: AccessCapability[];
}

export interface OpsMetrics {
  totalProjects: number;
  activeRuns: number;
  deployedCount: number;
  failedCount: number;
  totalCostUsd: number;
}

export interface TokenStatusEntry {
  hasToken: boolean;
  updatedAt: number;
}

interface OpsDashboardProps {
  projects: OpsProject[];
  accessAdminData: AccessAdminData;
  projectAccessPanels: Record<string, ProjectAccessPanelState>;
  shellAccess: {
    allowedGlobalTabs: CenterTab[];
    canCreateProjects: boolean;
    canManagePlatformProjects: boolean;
    canRunGlobalRuntimeActions: boolean;
    canManagePlatformFinance: boolean;
  };
  featureFlags: FeatureFlagsSnapshot;
  tools: any[];
  agentLoops: any[];
  projectAgentLoops: ProjectFacingAgentLoop[];
  proposals?: { id: string; title: string }[];
  metrics: OpsMetrics;
  workspaceRoot?: string;
  tokenStatus?: Record<string, TokenStatusEntry>;
  localConfigReadiness?: LocalConfigReadinessSnapshot;
  telegramAccountAudit?: TelegramAccountAuditSnapshot | null;
}

// RA-157: Lazy-loaded tab data — fetched on first tab open
interface LazyTabData {
  proposals?: { proposals: any[]; archivedProposals: any[] };
  seasons?: { seasons: any[] };
  registry?: { tools: any[]; agentLoops: any[] };
  vps?: { entries: any[] };
  jobs?: AdminJobsData;
  finance?: any;
  notifications?: {
    logs: any[];
    subscriberStats: { status: string; count: number }[];
    analytics: { status: string; eventType: string; count: number }[];
    subscribers: any[];
    userPreferences: any[];
  };
}

// Project-specific tabs require a selected project; global tabs don't
type CenterTab =
  | "logs"
  | "overview"
  | "tests"
  | "projects"
  | "proposals"
  | "access"
  | "finance"
  | "quota"
  | "seasons"
  | "registry"
  | "config"
  | "lab"
  | "vps"
  | "jobs"
  | "notifications";

const PROJECT_TABS: CenterTab[] = ["logs", "overview", "tests"];
const PRIMARY_GLOBAL_TABS: CenterTab[] = ["projects", "proposals", "access"];
const OVERFLOW_GLOBAL_TABS: CenterTab[] = [
  "finance",
  "quota",
  "seasons",
  "registry",
  "config",
  "lab",
  "jobs",
  "vps",
  "notifications",
];
const GLOBAL_TABS: CenterTab[] = [
  ...PRIMARY_GLOBAL_TABS,
  ...OVERFLOW_GLOBAL_TABS,
];
const ALL_TABS = new Set<CenterTab>([...PROJECT_TABS, ...GLOBAL_TABS]);

const CENTER_TAB_LABELS: Record<CenterTab, string> = {
  logs: "Logs",
  overview: "Overview",
  tests: "Tests",
  projects: "Projects",
  proposals: "Proposals",
  access: "Access",
  finance: "Credits",
  quota: "Quota",
  seasons: "Seasons",
  registry: "Registry",
  config: "Config",
  lab: "Lab",
  vps: "VPS",
  jobs: "Jobs",
  notifications: "Notifications",
};

interface AdminNavItem {
  tab: CenterTab;
  label: string;
  icon: LucideIcon;
}

interface AdminNavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: AdminNavItem[];
}

const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    icon: Activity,
    items: [
      { tab: "jobs", label: "Jobs", icon: ListTodo },
      { tab: "lab", label: "Lab", icon: FlaskConical },
      { tab: "vps", label: "VPS", icon: Server },
      { tab: "quota", label: "Quota", icon: Activity },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    icon: Users,
    items: [
      { tab: "proposals", label: "Proposals", icon: Users },
      { tab: "seasons", label: "Seasons", icon: Flag },
      { tab: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    icon: Settings,
    items: [
      { tab: "registry", label: "Registry", icon: Wrench },
      { tab: "config", label: "Config", icon: Settings },
      { tab: "access", label: "Access", icon: Users },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: DollarSign,
    items: [{ tab: "finance", label: "Credits", icon: CreditCard }],
  },
];

function getRunnerBadge(agentImpl?: string | null): {
  code: string;
  label: string;
} {
  if (agentImpl === "direct") return { code: "SL", label: "Simple Loop" };
  if (agentImpl === "dummy") return { code: "T", label: "Test" };
  return { code: "RE", label: "Ralph Extended" };
}

function isGlobalTab(tab: CenterTab): boolean {
  return GLOBAL_TABS.includes(tab);
}

function hasProjectCapability(
  project: OpsProject | null | undefined,
  capability: AccessCapability,
): boolean {
  return project?.accessCapabilities?.includes(capability) ?? false;
}

function hasAnyProjectCapability(
  project: OpsProject | null | undefined,
  capabilities: AccessCapability[],
): boolean {
  return capabilities.some((capability) =>
    hasProjectCapability(project, capability),
  );
}

function toProjectActionSnapshot(project: OpsProject) {
  const app = getAppComponent(project);
  return {
    archivedAt: project.archivedAt,
    app: app
      ? {
          powerIntent: app.powerIntent ?? "OFF",
          agentIntent: app.agentIntent ?? undefined,
          runtimeState: app.runtimeState ?? "ABSENT",
          agentState: app.agentState ?? null,
          blockers: app.blockers ?? [],
          lastOutcome: app.lastOutcome ?? null,
        }
      : null,
    loopRuntime: project.loopRuntime ?? null,
    loopSupportStatus: project.loopSupportStatus ?? null,
    agentStartAllowed: project.agentStartAllowed ?? false,
    relaunchAllowed: project.relaunchAllowed ?? false,
    accessCapabilities: project.accessCapabilities,
    runnerBackend: project.runnerBackend,
    agent: project.agent,
    providerBillingMode: project.providerBillingMode,
    vpsHost: project.vpsHost,
    isPinned: project.isPinned,
  };
}

type SidebarSort = "status" | "created" | "updated" | "name";
type AdminSidebarMode = "admin" | "projects";

const SORT_LABELS: Record<SidebarSort, string> = {
  status: "Status",
  created: "Created",
  updated: "Updated",
  name: "Name",
};

function sortProjects(projects: OpsProject[], sort: SidebarSort): OpsProject[] {
  const arr = [...projects];
  const secondary = (a: OpsProject, b: OpsProject): number => {
    switch (sort) {
      case "status": {
        const pa = OPS_STATUS_PRIORITY[getOpsDisplayStatus(a)] ?? 99;
        const pb = OPS_STATUS_PRIORITY[getOpsDisplayStatus(b)] ?? 99;
        if (pa !== pb) return pa - pb;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      }
      case "created":
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case "updated":
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      case "name":
        return getProjectName(a).localeCompare(getProjectName(b));
    }
  };
  // Pinned first, then secondary sort within each group
  return arr.sort((a, b) => {
    const pinDiff = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
    return pinDiff !== 0 ? pinDiff : secondary(a, b);
  });
}

function SidebarProjectItem({
  project,
  isSelected,
  hasActive,
  runner,
  waitingForSecrets,
  onSelect,
  canManagePlatformProjects = false,
  canManagePlatformRuntime = false,
  userProviderCredentialsEnabled = false,
  managedProviderCreditsEnabled = false,
}: {
  project: OpsProject;
  isSelected: boolean;
  hasActive: boolean;
  runner: { code: string; label: string };
  waitingForSecrets: boolean;
  onSelect: () => void;
  canManagePlatformProjects?: boolean;
  canManagePlatformRuntime?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
}) {
  const routerCtx = useRouter();
  const displayStatus = getOpsDisplayStatus(project);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const actionCtx: ProjectActionContext = {
    projectId: project.id,
    projectName: getProjectName(project),
    canManagePlatformProjects,
    canManagePlatformRuntime,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    project: toProjectActionSnapshot(project),
  };
  const actions = getProjectActions(actionCtx);
  const items = groupedActions(actions);
  const handlers = useActionHandlers(actionCtx, {
    setDeleteOpen,
    setCreditsOpen,
    setLogsOpen,
    setRenameOpen,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={onSelect}
            className={`w-full border-b border-gray-100 px-3 py-2.5 text-left transition-colors ${
              isSelected
                ? "border-l-4 border-l-emerald-500 bg-emerald-50 font-medium text-gray-900 dark:bg-slate-800 dark:text-slate-100"
                : "text-gray-600 hover:bg-gray-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {project.isPinned && (
                <svg
                  className="h-3 w-3 shrink-0 text-amber-500"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707l-.55-.55-3.535 3.536a3 3 0 0 1-.354.282L8.122 11.66a.5.5 0 0 1-.707 0l-3.071-3.07a.5.5 0 0 1 0-.708l1.868-1.863a3 3 0 0 1 .282-.354l3.536-3.535-.55-.55a.5.5 0 0 1 .147-.354zM6.95 8.636l-.707.707 2.121 2.121.707-.707L6.95 8.636zm6.414-6.414L11.243 4.34l2.121 2.121 2.122-2.121-2.122-2.118zM3.5 13h9v1h-9v-1z" />
                </svg>
              )}
              {hasActive && (
                <span className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
              )}
              <span className="truncate text-sm">
                {getAdminProjectLabel(project)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                title={runner.label}
                className="mono inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              >
                {runner.code}
              </span>
              <BackendBadgeCompact backend={project.runnerBackend} />
              <span className="min-w-0 truncate text-[11px] text-gray-500 dark:text-slate-400">
                {formatAgentLabel(
                  project.agent,
                  project.agentImpl,
                  project.model,
                )}
              </span>
            </div>
            <div className="mono mt-1 text-[11px] text-gray-400 dark:text-slate-500">
              <span
                className={`inline-flex h-1.5 w-1.5 rounded-full ${statusDotColor(displayStatus)} mr-1`}
              />
              {displayStatus}
            </div>
            {waitingForSecrets && (
              <div className="mt-1">
                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  Waiting for secrets
                </span>
              </div>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {items.map((item, i) =>
            item === "separator" ? (
              <ContextMenuSeparator key={`sep-${i}`} />
            ) : (
              <ContextMenuItem
                key={item.id}
                disabled={item.disabled}
                onSelect={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  handlers[item.id]?.();
                }}
                className={item.className}
              >
                {item.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
      <RunLogViewer
        projectId={project.id}
        isOpen={logsOpen}
        onClose={() => setLogsOpen(false)}
      />
      <AddCreditsButton
        projectId={project.id}
        externalOpen={creditsOpen}
        onExternalOpenChange={setCreditsOpen}
      />
      <ProjectDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={project.id}
        proposalTitle={getProjectName(project)}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        projectId={project.id}
        currentName={getProjectName(project)}
      />
    </>
  );
}

export function OpsDashboard({
  projects,
  accessAdminData,
  projectAccessPanels,
  shellAccess,
  featureFlags,
  tools,
  agentLoops,
  projectAgentLoops,
  proposals,
  metrics,
  workspaceRoot,
  tokenStatus,
  localConfigReadiness,
  telegramAccountAudit,
}: OpsDashboardProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sleepAllPending, startSleepAllTransition] = useTransition();
  const [quotaSnapshot, setQuotaSnapshot] =
    useState<ProviderQuotaResponse | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  // RA-157: Lazy tab data — fetch on first open
  const [lazyData, setLazyData] = useState<LazyTabData>({});
  const lazyDataRef = useRef(lazyData);
  lazyDataRef.current = lazyData;
  const loadingTabs = useRef(new Set<string>());

  const loadTabData = useCallback(
    async (tab: string, options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      if (!force && lazyDataRef.current[tab as keyof LazyTabData]) return;
      if (loadingTabs.current.has(tab)) return;
      loadingTabs.current.add(tab);
      try {
        const res = await fetch(`/api/admin/ops-data?tab=${tab}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setLazyData((prev) => ({ ...prev, [tab]: data }));
        } else {
          console.error(`[ops] Failed to load tab "${tab}": ${res.status}`);
        }
      } catch (err) {
        console.error(`[ops] Error loading tab "${tab}":`, err);
      } finally {
        loadingTabs.current.delete(tab);
      }
    },
    [],
  );
  const [sleepAllResult, setSleepAllResult] = useState<string | null>(null);
  const [cleanupPending, startCleanupTransition] = useTransition();
  const [confirmAction, setConfirmAction] = useState<
    "sleepAll" | "cleanup" | null
  >(null);
  const [liveProjects, setLiveProjects] = useState<OpsProject[]>(projects);
  useEffect(() => {
    setLiveProjects((current) =>
      mergeOpsProjectSnapshots(current, projects, {
        mode: "full",
      }),
    );
  }, [projects]);
  const sleepAllTargets = liveProjects.filter((project) => {
    const app = getAppComponent(project);
    return app?.powerIntent === "ON" && app.runtimeState === "RUNNING";
  });
  const sleepAllActiveLoopCount = sleepAllTargets.filter((project) =>
    hasLiveAgentLoop(project),
  ).length;
  const sleepAllCopy = getBatchPowerOffCopy(
    sleepAllActiveLoopCount,
    sleepAllTargets.length,
  );

  // Sidebar sort — always start with "created" to avoid hydration mismatch, then restore from localStorage
  const [sidebarSort, setSidebarSort] = useState<SidebarSort>("created");
  useEffect(() => {
    const saved = localStorage.getItem(
      "ops-sidebar-sort",
    ) as SidebarSort | null;
    if (saved && saved !== sidebarSort) setSidebarSort(saved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const handleSortChange = useCallback((sort: SidebarSort) => {
    setSidebarSort(sort);
    localStorage.setItem("ops-sidebar-sort", sort);
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    const pendingIds = new Set<string>();
    let refreshAll = false;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let flushTimer: number | null = null;
    let inFlightController: AbortController | null = null;
    let retries = 0;

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        void flush();
      }, 350);
    };

    const flush = async () => {
      const requestAll = refreshAll;
      const requestedIds = Array.from(pendingIds);
      refreshAll = false;
      pendingIds.clear();

      if (!requestAll && requestedIds.length === 0) return;

      inFlightController?.abort();
      inFlightController = new AbortController();

      const url = requestAll
        ? "/api/admin/projects/snapshot"
        : `/api/admin/projects/snapshot?ids=${encodeURIComponent(requestedIds.join(","))}`;

      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: inFlightController.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { projects?: OpsProject[] };
        const snapshots = Array.isArray(data.projects) ? data.projects : [];
        setLiveProjects((current) =>
          mergeOpsProjectSnapshots(current, snapshots, {
            mode: requestAll ? "full" : "partial",
            requestedIds,
          }),
        );
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    };

    const connect = () => {
      es = new EventSource("/api/admin/projects/stream");

      es.onopen = () => {
        retries = 0;
      };

      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data) as {
            projectId?: string;
            scope?: "project" | "all";
          };
          if (payload.scope === "all" || !payload.projectId) {
            refreshAll = true;
            scheduleFlush();
            return;
          }
          pendingIds.add(payload.projectId);
          scheduleFlush();
        } catch {
          refreshAll = true;
          scheduleFlush();
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        retries += 1;
        const delay = Math.min(1000 * 2 ** retries, 30_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      inFlightController?.abort();
    };
  }, []);

  const sortedProjects = useMemo(
    () => sortProjects(liveProjects, sidebarSort),
    [liveProjects, sidebarSort],
  );
  const liveMetrics = useMemo(
    () => computeOpsMetrics(liveProjects),
    [liveProjects],
  );

  // Right sidebar resize — always init with default to avoid SSR/client mismatch, restore in effect
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 600;
  const SIDEBAR_DEFAULT = 256;
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  useEffect(() => {
    const saved = localStorage.getItem("ops-sidebar-width");
    if (saved) {
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved)));
      if (w !== SIDEBAR_DEFAULT) setSidebarWidth(w);
    }
  }, []);
  const resizing = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.max(
        SIDEBAR_MIN,
        Math.min(SIDEBAR_MAX, window.innerWidth - e.clientX),
      );
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("ops-sidebar-width", String(sidebarWidth));
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [sidebarWidth]);

  const startResize = useCallback(() => {
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // RA-157: Use local state for tab/project to avoid RSC refetch on every tab switch.
  // Always start with "logs" for SSR safety, then restore from URL on client mount.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => searchParams.get("project"),
  );
  const [centerTab, setCenterTabState] = useState<CenterTab>("logs");
  const [adminSidebarMode, setAdminSidebarMode] = useState<AdminSidebarMode>(
    () =>
      searchParams.get("project") || searchParams.get("tab") === "projects"
        ? "projects"
        : "admin",
  );
  const [adminSidebarCollapsed, setAdminSidebarCollapsed] = useState(false);
  const allowedGlobalTabs = useMemo<CenterTab[]>(
    () =>
      shellAccess.allowedGlobalTabs.length > 0
        ? shellAccess.allowedGlobalTabs
        : ["projects"],
    [shellAccess.allowedGlobalTabs],
  );
  const allowedTabs = useMemo(
    () => new Set<CenterTab>([...PROJECT_TABS, ...allowedGlobalTabs]),
    [allowedGlobalTabs],
  );
  const allowedAdminNavGroups = useMemo(
    () =>
      ADMIN_NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          allowedGlobalTabs.includes(item.tab),
        ),
      })).filter((group) => group.items.length > 0),
    [allowedGlobalTabs],
  );
  const firstGlobalTab: CenterTab = allowedGlobalTabs[0] ?? "projects";
  const labelCache = useMemo(
    () => buildLabelCache(tools ?? [], agentLoops ?? []),
    [agentLoops, tools],
  );
  setLabelCache(labelCache);
  useEffect(() => {
    // Restore tab from URL after mount (avoids SSR rendering lazy tabs with empty data)
    const tabParam = searchParams.get("tab") as CenterTab | null;
    if (tabParam && allowedTabs.has(tabParam) && tabParam !== "logs") {
      setCenterTabState(tabParam);
    }
  }, [allowedTabs, searchParams]);

  const selectedProject =
    liveProjects.find((p) => p.id === selectedProjectId) ?? null;
  const shouldPollSelectedProject = shouldPollSelectedOpsProject(selectedProject);
  const isOnGlobalTab = isGlobalTab(centerTab);
  const showRightSidebar = !isOnGlobalTab && !!selectedProject;

  useEffect(() => {
    if (
      selectedProjectId &&
      !liveProjects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(null);
    }
  }, [liveProjects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProject && PROJECT_TABS.includes(centerTab)) {
      setCenterTabState(firstGlobalTab);
    }
  }, [centerTab, firstGlobalTab, selectedProject]);

  useEffect(() => {
    if (!allowedTabs.has(centerTab)) {
      setCenterTabState(selectedProject ? "overview" : firstGlobalTab);
    }
  }, [allowedTabs, centerTab, firstGlobalTab, selectedProject]);

  useEffect(() => {
    if (!selectedProjectId || !shouldPollSelectedProject) return;

    let cancelled = false;
    let controller: AbortController | null = null;
    let inFlight = false;

    const refreshSelectedProject = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();

      try {
        const res = await fetch(
          `/api/admin/projects/snapshot?ids=${encodeURIComponent(selectedProjectId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!res.ok || cancelled) return;

        const data = (await res.json()) as { projects?: OpsProject[] };
        const snapshots = Array.isArray(data.projects) ? data.projects : [];
        setLiveProjects((current) =>
          mergeOpsProjectSnapshots(current, snapshots, {
            mode: "partial",
            requestedIds: [selectedProjectId],
          }),
        );
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      } finally {
        inFlight = false;
        controller = null;
      }
    };

    void refreshSelectedProject();
    const interval = window.setInterval(refreshSelectedProject, 2_500);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [selectedProjectId, shouldPollSelectedProject]);

  // RA-198: Mobile sheet state
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);

  // Sync URL without triggering RSC refetch
  const syncUrl = useCallback(
    (projectId: string | null, tab: string) => {
      const params = new URLSearchParams();
      if (projectId) params.set("project", projectId);
      params.set("tab", tab);
      window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
    },
    [pathname],
  );

  const setCenterTab = useCallback(
    (tab: CenterTab) => {
      setCenterTabState(tab);
      syncUrl(selectedProjectId, tab);
    },
    [selectedProjectId, syncUrl],
  );

  const {
    lines,
    legacyText,
    isLegacy,
    connected,
    pinToBottom,
    setPinToBottom,
    containerRef,
    handleScroll,
  } = useLogStream({
    projectId: selectedProjectId,
    enabled: centerTab === "logs",
  });

  // RA-108: Log archives
  type ArchiveMeta = {
    id: string;
    terminalState: string;
    createdAt: string;
  };
  const [archives, setArchives] = useState<ArchiveMeta[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(
    null,
  );
  const [archiveLines, setArchiveLines] = useState<LogLine[]>([]);
  const [archiveLegacy, setArchiveLegacy] = useState("");
  const [archiveIsLegacy, setArchiveIsLegacy] = useState(false);
  const [logSearch, setLogSearch] = useState("");

  // Fetch archive list when project changes or status changes (e.g. after relaunch)
  const selectedProjectStatus = liveProjects.find(
    (p) => p.id === selectedProjectId,
  )?.status;
  useEffect(() => {
    setArchives([]);
    setSelectedArchiveId(null);
    setLogSearch("");
    if (!selectedProjectId) return;
    fetch(`/api/projects/${selectedProjectId}/log-archives`)
      .then((r) => r.json())
      .then((data) => setArchives(data.archives ?? []))
      .catch(() => {});
  }, [selectedProjectId, selectedProjectStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch archive log when selected
  useEffect(() => {
    if (!selectedArchiveId || !selectedProjectId) {
      setArchiveLines([]);
      setArchiveLegacy("");
      setArchiveIsLegacy(false);
      return;
    }
    fetch(
      `/api/projects/${selectedProjectId}/log-archives/${selectedArchiveId}`,
    )
      .then((r) => r.json())
      .then((data) => {
        const text = data.archive?.log ?? "";
        const parsed = parseJsonlText(text);
        if (parsed) {
          setArchiveIsLegacy(false);
          setArchiveLines(parsed);
          setArchiveLegacy("");
        } else {
          setArchiveIsLegacy(true);
          setArchiveLegacy(text);
          setArchiveLines([]);
        }
      })
      .catch(() => {});
  }, [selectedArchiveId, selectedProjectId]);

  const selectProject = useCallback(
    (projectId: string) => {
      setAdminSidebarMode("projects");
      setSelectedProjectId(projectId);
      setCenterTabState("overview");
      syncUrl(projectId, "overview");
      setLeftSheetOpen(false);
    },
    [syncUrl],
  );

  const selectGlobalTab = useCallback(
    (tab: CenterTab) => {
      setAdminSidebarMode("admin");
      setSelectedProjectId(null);
      setCenterTabState(tab);
      syncUrl(null, tab);
      setLeftSheetOpen(false);
    },
    [syncUrl],
  );

  const openProjectsOverview = useCallback(() => {
    setAdminSidebarMode("projects");
    setSelectedProjectId(null);
    setCenterTabState("projects");
    syncUrl(null, "projects");
  }, [syncUrl]);

  const showFullAdminSidebar = useCallback(() => {
    setAdminSidebarMode("admin");
  }, []);

  const copyValue = useCallback(
    async (key: string, value: string | null | undefined) => {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopiedKey(key);
        window.setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current));
        }, 1500);
      } catch {
        setCopiedKey(null);
      }
    },
    [],
  );

  // RA-157: Trigger lazy load when tab changes
  useEffect(() => {
    const lazyTabs = ["proposals", "seasons", "vps", "jobs", "finance", "notifications"];
    if (lazyTabs.includes(centerTab)) {
      loadTabData(centerTab);
    }
  }, [centerTab, loadTabData]);

  useEffect(() => {
    if (centerTab !== "quota") return;

    const controller = new AbortController();
    let mounted = true;
    const loadQuotaSnapshot = async () => {
      setQuotaLoading(true);
      setQuotaError(null);
      try {
        const res = await fetch("/api/admin/quota-windows", {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Quota API returned ${res.status}`);
        }
        const data = (await res.json()) as ProviderQuotaResponse;
        if (!mounted) return;
        setQuotaSnapshot(data);
      } catch (err) {
        if (!mounted || controller.signal.aborted) return;
        setQuotaError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) setQuotaLoading(false);
      }
    };

    void loadQuotaSnapshot();
    const timer = window.setInterval(loadQuotaSnapshot, 300_000);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [centerTab]);

  function renderLazyLoading() {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-slate-500">
        Loading...
      </div>
    );
  }

  function renderProjectList() {
    return (
      <>
        {/* Sort control */}
        <div className="flex items-center gap-1 px-2 pb-2">
          {(Object.keys(SORT_LABELS) as SidebarSort[]).map((key) => (
            <button
              key={key}
              onClick={() => handleSortChange(key)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                sidebarSort === key
                  ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950"
                  : "text-gray-400 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-200"
              }`}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-200 dark:border-slate-800">
          {sortedProjects.map((project) => {
            const isSelected = project.id === selectedProjectId;
            const displayStatus = getOpsDisplayStatus(project);
            const hasActive = isOpsActiveStatus(displayStatus);
            const runner = getRunnerBadge(project.agentImpl);
            const waitingForSecrets = Boolean(
              getAppComponent(project)?.blockers?.includes("SECRETS"),
            );
            return (
              <SidebarProjectItem
                key={project.id}
                project={project}
                isSelected={isSelected}
                hasActive={hasActive}
                runner={runner}
                waitingForSecrets={waitingForSecrets}
                canManagePlatformProjects={
                  shellAccess.canManagePlatformProjects
                }
                canManagePlatformRuntime={
                  shellAccess.canRunGlobalRuntimeActions
                }
                userProviderCredentialsEnabled={featureFlags.byokProviderKeys}
                managedProviderCreditsEnabled={featureFlags.managedProviderCredits}
                onSelect={() => selectProject(project.id)}
              />
            );
          })}
          {sortedProjects.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-400 dark:text-slate-500">
              No projects
            </div>
          )}
        </div>
      </>
    );
  }

  function renderAdminSidebar(options?: { forceExpanded?: boolean }) {
    const collapsed = adminSidebarCollapsed && !options?.forceExpanded;
    const projectsMode = adminSidebarMode === "projects";
    const projectSectionActive =
      projectsMode || centerTab === "projects" || !isOnGlobalTab;

    if (collapsed) {
      return (
        <div className="flex h-full flex-col items-center gap-2 border-r border-gray-200 bg-gray-50 px-2 py-2 dark:border-slate-800 dark:bg-slate-900/80">
          <button
            type="button"
            onClick={() => setAdminSidebarCollapsed(false)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            title="Expand admin sidebar"
            aria-label="Expand admin sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={openProjectsOverview}
            className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
              projectSectionActive
                ? "bg-emerald-500 text-white dark:text-slate-950"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            }`}
            title="Projects"
            aria-label="Projects"
          >
            <Folder className="h-4 w-4" />
          </button>
          {allowedAdminNavGroups.map((group) => {
            const firstItem = group.items[0];
            const Icon = group.icon;
            const isActive = group.items.some((item) => item.tab === centerTab);
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => selectGlobalTab(firstItem.tab)}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                  isActive
                    ? "bg-emerald-500 text-white dark:text-slate-950"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                }`}
                title={group.label}
                aria-label={group.label}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-gray-50/90 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
              Admin
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              Ralph Arena
            </div>
          </div>
          {!options?.forceExpanded && (
            <button
              type="button"
              onClick={() => setAdminSidebarCollapsed(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title="Collapse admin sidebar"
              aria-label="Collapse admin sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
              Collapse
            </button>
          )}
        </div>

        {projectsMode ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-200 px-2 py-2 dark:border-slate-800">
              <button
                type="button"
                onClick={showFullAdminSidebar}
                className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-gray-500 transition-colors hover:bg-white hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label="Back to full admin sidebar"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">All admin</span>
              </button>
              <div className="flex items-center gap-2 rounded-md bg-gray-900 px-2 py-2 text-sm font-medium text-white dark:bg-emerald-500 dark:text-slate-950">
                <Folder className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Projects</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
                  {liveMetrics.totalProjects}
                </span>
              </div>
            </div>
            {renderProjectList()}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <button
              type="button"
              onClick={openProjectsOverview}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors ${
                centerTab === "projects" && !selectedProject
                  ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950"
                  : projectSectionActive
                    ? "bg-white text-gray-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                    : "text-gray-600 hover:bg-white hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              }`}
            >
              <Folder className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Projects</span>
              <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                {liveMetrics.totalProjects}
              </span>
            </button>

            <div className="mt-4 space-y-3">
              {allowedAdminNavGroups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.id}>
                    <div className="mb-1 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      <GroupIcon className="h-3 w-3" />
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = centerTab === item.tab;
                        return (
                          <button
                            key={item.tab}
                            type="button"
                            onClick={() => selectGlobalTab(item.tab)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium transition-colors ${
                              active
                                ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950"
                                : "text-gray-600 hover:bg-white hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderRightSidebar() {
    if (!selectedProject) return null;
    const selectedProjectStatus = getOpsDisplayStatus(selectedProject);
    const canManageRuntime = hasProjectCapability(
      selectedProject,
      "project.runtime.manage",
    );
    const canManageSettings = hasProjectCapability(
      selectedProject,
      "project.settings.manage",
    );
    const canManageSecrets = hasProjectCapability(
      selectedProject,
      "project.secrets.manage",
    );
    const canManageRequiredSecrets = hasProjectCapability(
      selectedProject,
      "project.required_secrets.manage",
    );
    const canRevealSecrets = hasProjectCapability(
      selectedProject,
      "project.secrets.reveal",
    );
    const canViewBudget = hasAnyProjectCapability(selectedProject, [
      "project.budget.view",
      "project.budget.manage",
    ]);
    const canManageBudget = hasProjectCapability(
      selectedProject,
      "project.budget.manage",
    );
    const canManageAccess = hasProjectCapability(
      selectedProject,
      "project.access.manage",
    );
    const canEditSpecs = hasProjectCapability(
      selectedProject,
      "project.specs.write",
    );
    const canManageAssets = hasProjectCapability(
      selectedProject,
      "project.assets.manage",
    );
    const canViewProject = hasProjectCapability(
      selectedProject,
      "project.view",
    );

    return (
      <>
        {/* Header + actions */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
              {getAdminProjectLabel(selectedProject)}
            </div>
            <div className="mono text-[10px] text-gray-500 dark:text-slate-400">
              {getAdminLoopIdentity(selectedProject)}
            </div>
            {selectedProject.loopSupportLabel && (
              <div className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
                support: {selectedProject.loopSupportLabel}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ProjectActionsMenu
              project={selectedProject}
              canManagePlatformProjects={shellAccess.canManagePlatformProjects}
              canManagePlatformRuntime={shellAccess.canRunGlobalRuntimeActions}
              userProviderCredentialsEnabled={featureFlags.byokProviderKeys}
              managedProviderCreditsEnabled={featureFlags.managedProviderCredits}
            />
            <button
              onClick={() => setRightSheetOpen(false)}
              className="rounded p-1 text-gray-400 hover:text-gray-600 md:hidden dark:text-slate-500 dark:hover:text-slate-300"
              aria-label="Close"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ProjectSidebar
            project={selectedProject}
            selectedProjectStatus={selectedProjectStatus}
            workspaceRoot={workspaceRoot}
            canManageRuntime={canManageRuntime}
            canManageSettings={canManageSettings}
            canManageSecrets={canManageSecrets}
            canManageRequiredSecrets={canManageRequiredSecrets}
            canRevealSecrets={canRevealSecrets}
            canViewBudget={canViewBudget}
            canManageBudget={canManageBudget}
            canManageAccess={canManageAccess}
            canEditSpecs={canEditSpecs}
            canManageAssets={canManageAssets}
            canViewProject={canViewProject}
            canManagePlatformProjects={shellAccess.canManagePlatformProjects}
            canManagePlatformRuntime={shellAccess.canRunGlobalRuntimeActions}
            canManagePlatformFinance={shellAccess.canManagePlatformFinance}
            userProviderCredentialsEnabled={featureFlags.byokProviderKeys}
            managedProviderCreditsEnabled={featureFlags.managedProviderCredits}
            projectAccessPanelState={projectAccessPanels[selectedProject.id]}
            accessSubjects={accessAdminData.subjects}
            renderPreview={() => (
              <SidebarPreview
                url={getAppComponent(selectedProject)?.previewUrl!}
                projectId={selectedProject.id}
                projectName={getProjectName(selectedProject)}
                visibility={
                  (selectedProject.visibility as
                    | "featured"
                    | "public"
                    | "private"
                    | undefined) ?? "public"
                }
                bust={new Date(selectedProject.updatedAt).getTime()}
              />
            )}
            tools={tools}
            agentLoops={projectAgentLoops}
          />
        </div>
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-white dark:bg-slate-950">
      {/* Top bar (desktop only — mobile uses the nav bar below) */}
      <div className="hidden h-12 min-h-12 shrink-0 flex-nowrap items-center gap-3 overflow-hidden border-b border-gray-200 bg-white px-4 md:flex dark:border-slate-800 dark:bg-slate-950">
        <h1 className="min-w-0 max-w-80 shrink-0 truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
          {selectedProject && !isOnGlobalTab
            ? getAdminProjectLabel(selectedProject)
            : CENTER_TAB_LABELS[centerTab] ?? (shellAccess.canManagePlatformProjects ? "Ops" : "Project Ops")}
        </h1>

        <div className="hidden min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap text-[11px] md:flex">
          {/* Metrics strip */}
          <div className="flex shrink-0 items-center gap-3">
            <span className="shrink-0 text-gray-400 dark:text-slate-500">
              <span className="font-medium text-gray-700 dark:text-slate-200">
                {liveMetrics.totalProjects}
              </span>{" "}
              projects
            </span>
            <span className="shrink-0 text-gray-300 dark:text-slate-700">|</span>
            <span className="shrink-0 text-gray-400 dark:text-slate-500">
              <span className="font-medium text-amber-600">
                {liveMetrics.activeRuns}
              </span>{" "}
              active
            </span>
            <span className="shrink-0 text-gray-300 dark:text-slate-700">|</span>
            <span className="shrink-0 text-gray-400 dark:text-slate-500">
              <span className="font-medium text-emerald-600">
                {liveMetrics.deployedCount}
              </span>{" "}
              deployed
            </span>
            <span className="shrink-0 text-gray-300 dark:text-slate-700">|</span>
            <span className="shrink-0 text-gray-400 dark:text-slate-500">
              <span className="font-medium text-rose-600">
                {liveMetrics.failedCount}
              </span>{" "}
              failed
            </span>
            <span className="shrink-0 text-gray-300 dark:text-slate-700">|</span>
            <span className="shrink-0 text-gray-400 dark:text-slate-500">
              <span className="font-medium text-violet-600">
                {liveMetrics.totalCostUsd > 0
                  ? `$${liveMetrics.totalCostUsd.toFixed(2)}`
                  : "—"}
              </span>{" "}
              cost
            </span>
          </div>

          {/* RA-168/RA-162: Token & API status indicators */}
          {shellAccess.canRunGlobalRuntimeActions && tokenStatus && (
            <TooltipProvider delayDuration={200}>
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <span className="shrink-0 text-gray-300 dark:text-slate-700">|</span>
                {(
                  [
                    "claude-api",
                    "claude-sub",
                    "openai-api",
                    "openai-sub",
                    "opencode-api",
                  ] as const
                ).map((provider) => {
                  const entry = tokenStatus[provider];
                  if (!entry) return null;
                  const dot = entry.hasToken ? "bg-emerald-400" : "bg-rose-400";
                  const label = entry.hasToken ? "ok" : "missing";
                  const [vendor, mode] = provider.split("-") as [string, string];
                  const shortLabel = `${vendor} ${mode}`;
                  return (
                    <Tooltip key={provider}>
                      <TooltipTrigger asChild>
                        <span className="flex shrink-0 cursor-default items-center gap-1 text-gray-400 dark:text-slate-500">
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`}
                          />
                          {shortLabel}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" suppressHydrationWarning>
                        {shortLabel}: {label}
                        {entry.hasToken && entry.updatedAt > 0 && (
                          <span className="text-slate-400">
                            {" "}
                            · {new Date(entry.updatedAt).toLocaleTimeString()}
                          </span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          )}
        </div>

        <div className="ml-auto hidden shrink-0 flex-nowrap items-center gap-2 md:flex">
          {shellAccess.canRunGlobalRuntimeActions && (
            <>
              <button
                onClick={() => setConfirmAction("cleanup")}
                disabled={cleanupPending}
                className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-500 hover:text-gray-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-400 dark:hover:text-slate-200"
              >
                {cleanupPending ? "Cleaning..." : "Cleanup Orphans"}
              </button>
              <button
                onClick={() => setConfirmAction("sleepAll")}
                disabled={sleepAllPending}
                className="rounded border border-blue-300 px-2 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:border-blue-500/40 dark:text-blue-400 dark:hover:bg-blue-500/10"
              >
                {sleepAllPending
                  ? "Stopping..."
                  : (sleepAllResult ?? "Power Off All")}
              </button>
            </>
          )}
          <ThemeToggle />
          {selectedProject && !isOnGlobalTab && (
            <div className="flex items-center gap-2">
              <span
                className="mono text-[11px] text-gray-400 dark:text-slate-500"
                title={selectedProject.id}
              >
                {selectedProject.id.slice(-8)}
              </span>
              <button
                onClick={() => copyValue("project-id", selectedProject.id)}
                className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
              >
                {copiedKey === "project-id" ? "Copied" : "ID"}
              </button>
              {getAppComponent(selectedProject)?.containerName && (
                <button
                  onClick={() =>
                    copyValue(
                      "container-name",
                      getAppComponent(selectedProject)?.containerName ?? "",
                    )
                  }
                  className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
                  title={
                    getAppComponent(selectedProject)?.containerName ?? undefined
                  }
                >
                  {copiedKey === "container-name" ? "Copied" : "Container"}
                </button>
              )}
              <span
                className={`inline-flex h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-gray-300"}`}
                title={connected ? "SSE connected" : "Disconnected"}
              />
            </div>
          )}
        </div>
      </div>

      {/* RA-198: Mobile nav bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 md:hidden dark:border-slate-800">
        <button
          onClick={() => setLeftSheetOpen(true)}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Open admin sidebar"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>
        <span className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-slate-100">
          {selectedProject && !isOnGlobalTab
            ? getProjectName(selectedProject)
            : CENTER_TAB_LABELS[centerTab] ?? "Admin"}
        </span>
        <ThemeToggle />
        {showRightSidebar && (
          <button
            onClick={() => setRightSheetOpen(true)}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Project details"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left sidebar — admin navigation + project list (desktop) */}
        <aside
          className={`hidden shrink-0 flex-col md:flex ${
            adminSidebarCollapsed ? "w-14" : "w-72"
          }`}
        >
          {renderAdminSidebar()}
        </aside>

        {/* Left sidebar — admin navigation + project list (mobile sheet) */}
        <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
          <SheetContent side="left" className="h-[100dvh] max-h-[100dvh] w-80 p-0">
            {renderAdminSidebar({ forceExpanded: true })}
          </SheetContent>
        </Sheet>

        {/* Center panel */}
        <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
          {selectedProject && !isOnGlobalTab && (
            <div className="flex shrink-0 items-center overflow-x-auto border-b border-gray-200 bg-white scrollbar-hide dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={openProjectsOverview}
                className="mx-2 hidden shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800 md:flex dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <Folder className="h-3.5 w-3.5" />
                All projects
              </button>
              <TabButton
                active={centerTab === "overview"}
                onClick={() => setCenterTab("overview")}
              >
                Overview
              </TabButton>
              <TabButton
                active={centerTab === "tests"}
                onClick={() => setCenterTab("tests")}
              >
                Tests
              </TabButton>
              <TabButton
                active={centerTab === "logs"}
                onClick={() => setCenterTab("logs")}
              >
                Logs
              </TabButton>

              <div className="ml-auto flex items-center gap-2 px-3">
                <span
                  className={`inline-flex h-1.5 w-1.5 rounded-full ${statusDotColor(getOpsDisplayStatus(selectedProject))}`}
                />
                <span className="mono text-[11px] text-gray-500 dark:text-slate-400">
                  {getOpsDisplayStatus(selectedProject)}
                </span>
                <span className="mono text-[10px] text-gray-400 dark:text-slate-500">
                  {formatAdminShortTimestamp(selectedProject.createdAt)}
                </span>
              </div>
            </div>
          )}

          {/* Tab content */}
          {renderCenterContent()}
        </div>

        {/* Right sidebar — tools panel (desktop, project tabs only) */}
        {showRightSidebar && selectedProject && (
          <aside
            className="relative hidden shrink-0 flex-col border-l border-gray-200 bg-gray-50/50 md:flex dark:border-slate-800 dark:bg-slate-900/50"
            style={{ width: sidebarWidth }}
          >
            {/* Resize handle */}
            <div
              onMouseDown={startResize}
              className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-emerald-500/20 active:bg-emerald-500/30"
            />
            {renderRightSidebar()}
          </aside>
        )}

        {/* Right sidebar — mobile sheet */}
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetContent side="right" className="h-[100dvh] max-h-[100dvh] w-80 p-0" hideClose>
            {selectedProject && renderRightSidebar()}
          </SheetContent>
        </Sheet>
      </div>

      {/* Confirmation dialog for dangerous actions */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent className="max-w-sm dark:border-slate-700 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="dark:text-slate-100">
              {confirmAction === "sleepAll"
                ? sleepAllCopy.title
                : "Cleanup Hetzner Orphans"}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              {confirmAction === "sleepAll"
                ? sleepAllCopy.description
                : "This will delete any Hetzner VPS servers that are not associated with active projects."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (confirmAction === "sleepAll") {
                  startSleepAllTransition(async () => {
                    const result = await powerOffAllRunning();
                    setSleepAllResult(
                      `Stopped ${result.stopped}${result.errors ? `, ${result.errors} errors` : ""}`,
                    );
                    setTimeout(() => setSleepAllResult(null), 3000);
                  });
                } else {
                  startCleanupTransition(async () => {
                    const result = await cleanupHetznerOrphans();
                    if (result.success)
                      toast.success(
                        result.details || "Orphan cleanup completed",
                      );
                    else toast.error(result.error || "Orphan cleanup failed");
                  });
                }
                setConfirmAction(null);
              }}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm text-white hover:bg-rose-700"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // NOTE: renderCenterContent below uses function declaration hoisting (works but unconventional).
  // It accesses component state/props via closure. Keeping here to avoid massive diff.
  function renderCenterContent() {
    // Global tabs — projects always available (SSR), others lazy-loaded
    if (centerTab === "projects") {
      return (
        <ProjectsPanel
          adminProjects={liveProjects as any}
          tools={tools}
          agentLoops={projectAgentLoops}
          proposals={proposals}
          onProjectSelect={selectProject}
          canCreateProjects={shellAccess.canCreateProjects}
          canManagePlatformProjects={shellAccess.canManagePlatformProjects}
          canManagePlatformRuntime={shellAccess.canRunGlobalRuntimeActions}
          userProviderCredentialsEnabled={featureFlags.byokProviderKeys}
          managedProviderCreditsEnabled={featureFlags.managedProviderCredits}
        />
      );
    }
    if (centerTab === "proposals") {
      const p = lazyData.proposals;
      if (!p) return renderLazyLoading();
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <ProposalsTab
            proposals={p.proposals}
            archivedProposals={p.archivedProposals}
            seasons={lazyData.seasons?.seasons ?? []}
            tools={tools}
            agentLoops={projectAgentLoops}
            onProjectSelect={selectProject}
          />
        </div>
      );
    }
    if (centerTab === "access") {
      return (
        <AccessTab
          data={accessAdminData}
          projectOptions={liveProjects.map((project) => ({
            id: project.id,
            name: getProjectName(project),
          }))}
        />
      );
    }
    if (centerTab === "seasons") {
      const s = lazyData.seasons;
      if (!s) return renderLazyLoading();
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <SeasonsTab
            seasons={s.seasons}
            tools={tools}
            agentLoops={projectAgentLoops}
          />
        </div>
      );
    }
    if (centerTab === "registry") {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="space-y-8">
            <Link
              href="/admin/prompt-map"
              className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-400 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    Ralph Prompt Map
                  </div>
                  <p className="mt-1 max-w-2xl text-xs text-gray-500 dark:text-slate-400">
                    Open the standalone read-only prompt atlas. Prompt source
                    truth stays in Ralph runtime code.
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  Open Prompt Map
                </span>
              </div>
            </Link>
            <div>
              <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-slate-100">
                Agent Loops
              </h2>
              <LoopsTab agentLoops={agentLoops} />
            </div>
            <div>
              <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-slate-100">
                Tools
              </h2>
              <ToolsTab tools={tools} />
            </div>
          </div>
        </div>
      );
    }
    if (centerTab === "config") {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {localConfigReadiness?.enabled && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      Local Config Readiness
                    </h2>
                    <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                      Small local-devprod check for env that should not fail
                      silently.
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-gray-600 dark:text-slate-400">
                    <div>
                      {localConfigReadiness.criticalMissing.length} critical
                      missing
                    </div>
                    <div>
                      {localConfigReadiness.warningMissing.length} warning
                      missing
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-600 dark:text-slate-400">
                  {localConfigReadiness.splitConfigNote}
                </p>
                <div className="mt-4 space-y-2">
                  {localConfigReadiness.items.map((item) => {
                    const tone =
                      item.status === "missing"
                        ? item.severity === "critical"
                          ? "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200"
                          : "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"
                        : "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200";

                    return (
                      <div
                        key={item.key}
                        className={`rounded-lg border px-3 py-2 ${tone}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold">
                            {item.key}
                          </div>
                          <div className="text-[11px] uppercase tracking-wide opacity-80">
                            {item.status === "missing" ? item.severity : "ok"}
                          </div>
                        </div>
                        <div className="mt-1 text-xs opacity-90">
                          {item.effect}
                        </div>
                        <div className="mt-1 text-[11px] opacity-75">
                          {item.note}
                        </div>
                        <div className="mt-1 text-[11px] opacity-75">
                          <span className="font-medium">Where:</span>{" "}
                          {item.location}
                        </div>
                        <div className="mt-1 text-[11px] opacity-75">
                          <span className="font-medium">Action:</span>{" "}
                          {item.action}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {telegramAccountAudit && (
              <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      Telegram Account Audit
                    </h2>
                    <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                      Read-only check of Arena Telegram account rows used by
                      OIDC login and Mini App handoff.
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-gray-600 dark:text-slate-400">
                    <div>{telegramAccountAudit.warningCount} warnings</div>
                    <div>
                      {telegramAccountAudit.totalTelegramAccounts} accounts
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-gray-600 dark:text-slate-400 sm:grid-cols-3">
                  <div>
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      Users:
                    </span>{" "}
                    {telegramAccountAudit.totalTelegramUsers}
                  </div>
                  <div>
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      Raw ids:
                    </span>{" "}
                    {telegramAccountAudit.rawIdAccountCount}
                  </div>
                  <div>
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      Legacy ids:
                    </span>{" "}
                    {telegramAccountAudit.legacyAccountCount}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {telegramAccountAudit.buckets.map((bucket) => {
                    const tone = bucket.severity === "warning"
                      ? "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"
                      : "border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-200";

                    return (
                      <div
                        key={bucket.code}
                        className={`rounded-lg border px-3 py-2 ${tone}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold">
                            {bucket.title}
                          </div>
                          <div className="text-[11px] uppercase tracking-wide opacity-80">
                            {bucket.count} {bucket.severity}
                          </div>
                        </div>
                        <div className="mt-1 text-xs opacity-90">
                          {bucket.effect}
                        </div>
                        <div className="mt-1 text-[11px] opacity-75">
                          <span className="font-medium">Action:</span>{" "}
                          {bucket.action}
                        </div>
                        {bucket.examples.length > 0 && (
                          <div className="mt-2 space-y-1 text-[11px] opacity-80">
                            {bucket.examples.map((example) => (
                              <div key={example.userId}>
                                <span className="font-medium">
                                  {example.userName ?? example.userEmail ?? example.userId}
                                </span>
                                {" "}/ raw:{" "}
                                {example.rawIds.length > 0 ? example.rawIds.join(", ") : "none"}
                                {" "}/ legacy:{" "}
                                {example.legacyIds.length > 0 ? example.legacyIds.join(", ") : "none"}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <div>
              <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-slate-100">
                Feature Flags
              </h2>
              <FeatureFlagsTab featureFlags={featureFlags} />
            </div>
          </div>
        </div>
      );
    }
    if (centerTab === "quota") {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl">
            <QuotaPanel
              quotaSnapshot={quotaSnapshot}
              loading={quotaLoading}
              error={quotaError}
            />
          </div>
        </div>
      );
    }
    if (centerTab === "finance") {
      const finance = lazyData.finance;
      if (!finance) return renderLazyLoading();
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <CreditAccountsTab
            snapshot={finance}
            onReload={() => loadTabData("finance", { force: true })}
          />
        </div>
      );
    }
    if (centerTab === "vps") {
      const v = lazyData.vps;
      if (!v) return renderLazyLoading();
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <VpsFleetTab entries={v.entries} />
        </div>
      );
    }
    if (centerTab === "jobs") {
      const j = lazyData.jobs;
      if (!j) return renderLazyLoading();
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <JobsTab jobs={j} />
        </div>
      );
    }
    if (centerTab === "lab") {
      return <LabTab projects={liveProjects} />;
    }
    if (centerTab === "notifications") {
      const n = lazyData.notifications;
      if (!n) return renderLazyLoading();
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <NotificationsTab
            logs={n.logs}
            subscriberStats={n.subscriberStats}
            analytics={n.analytics}
            subscribers={n.subscribers}
            userPreferences={n.userPreferences}
          />
        </div>
      );
    }

    // Project-specific tabs
    if (!selectedProject) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400 dark:text-slate-500">
          Select a project from the sidebar
        </div>
      );
    }

    if (centerTab === "logs") {
      const showingArchive = selectedArchiveId !== null;
      const displayLines = showingArchive ? archiveLines : lines;
      const displayLegacy = showingArchive ? archiveLegacy : legacyText;
      const displayIsLegacy = showingArchive ? archiveIsLegacy : isLegacy;

      return (
        <div className="relative flex min-h-0 flex-1 flex-col bg-gray-950">
          {/* RA-108: Archive sub-tabs + search */}
          <div className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-2 py-1">
            <button
              onClick={() => setSelectedArchiveId(null)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                !showingArchive
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span
                className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${selectedProject ? statusDotColor(getOpsDisplayStatus(selectedProject)) : "bg-gray-400"}`}
              />
              Current
            </button>
            {archives.map((a, i) => {
              const icon =
                a.terminalState === "DEPLOYED"
                  ? "✓"
                  : a.terminalState === "FAILED"
                    ? "✗"
                    : "⏸";
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedArchiveId(a.id)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    selectedArchiveId === a.id
                      ? "bg-slate-700 text-slate-100"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  #{archives.length - i} {icon}
                </button>
              );
            })}
            <div className="ml-auto">
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search logs..."
                className="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
              />
            </div>
          </div>
          <div
            ref={showingArchive ? undefined : containerRef}
            onScroll={showingArchive ? undefined : handleScroll}
            className="h-full overflow-y-auto p-4"
          >
            <LogView
              lines={displayLines}
              legacyText={displayLegacy}
              isLegacy={displayIsLegacy}
              searchQuery={logSearch}
            />
          </div>
          {!showingArchive && !pinToBottom && (
            <button
              onClick={() => {
                setPinToBottom(true);
                if (containerRef.current) {
                  containerRef.current.scrollTop =
                    containerRef.current.scrollHeight;
                }
              }}
              className="absolute bottom-4 right-4 rounded border border-sky-500/50 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-sky-100 shadow-sm shadow-sky-950/20 transition-colors hover:border-sky-400/70 hover:bg-slate-800 hover:text-white"
            >
              Scroll to bottom
            </button>
          )}
        </div>
      );
    }

    if (centerTab === "tests") {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-slate-950">
          <TestsTab
            key={selectedProject.id}
            projectId={selectedProject.id}
            previewUrl={getAppComponent(selectedProject)?.previewUrl ?? null}
            initialEvents={[]}
          />
        </div>
      );
    }

    // overview
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-slate-950">
        <OverviewPanel project={selectedProject} />
      </div>
    );
  }
}

function TabButton({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap px-2.5 py-2 text-sm font-medium transition-colors md:px-4 ${
        active
          ? "border-b-2 border-emerald-500 text-gray-900 dark:text-slate-100"
          : disabled
            ? "cursor-not-allowed text-gray-300 dark:text-slate-600"
            : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function OverflowTabMenu({
  tabs,
  activeTab,
  onSelect,
  labels,
}: {
  tabs: CenterTab[];
  activeTab: CenterTab;
  onSelect: (tab: CenterTab) => void;
  labels: Partial<Record<CenterTab, string>>;
}) {
  const isActiveInOverflow = tabs.includes(activeTab);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1 whitespace-nowrap px-2.5 py-2 text-sm font-medium transition-colors md:px-3 ${
            isActiveInOverflow
              ? "border-b-2 border-emerald-500 text-gray-900 dark:text-slate-100"
              : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          {isActiveInOverflow ? (labels[activeTab] ?? activeTab) : "More"}
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 12 12"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab}
            onSelect={() => onSelect(tab)}
            className={
              activeTab === tab
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : ""
            }
          >
            {labels[tab] ?? tab}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-slate-700 dark:text-slate-300">
      {children}
    </span>
  );
}

function HeartbeatRow({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  const ts = new Date(iso).getTime();
  const ageSec = now !== null ? Math.floor((now - ts) / 1000) : null;
  const stale = ageSec !== null && ageSec > 120;
  const label =
    ageSec === null
      ? "—"
      : ageSec < 60
        ? `${ageSec}s ago`
        : ageSec < 3600
          ? `${Math.floor(ageSec / 60)}m ago`
          : `${Math.floor(ageSec / 3600)}h ago`;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-400 dark:text-slate-500">
        Heartbeat
      </span>
      <span
        className={`mono text-[11px] font-medium ${stale ? "text-amber-600 dark:text-amber-400" : "text-gray-700 dark:text-slate-200"}`}
        suppressHydrationWarning
      >
        {label}
      </span>
    </div>
  );
}

function InfoRow({
  label,
  value,
  dot,
  highlight,
}: {
  label: string;
  value: string;
  dot?: string;
  highlight?: "red" | "green";
}) {
  let valueClass = "text-gray-700 dark:text-slate-200";
  if (highlight === "red") valueClass = "text-rose-600";
  if (highlight === "green") valueClass = "text-emerald-600";

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-400 dark:text-slate-500">
        {label}
      </span>
      <span
        className={`mono text-[11px] font-medium ${valueClass} flex items-center gap-1`}
      >
        {dot && (
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        {value}
      </span>
    </div>
  );
}

function SidebarLink({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      >
        {children} &nearr;
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="text-[11px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </Link>
  );
}

// RA-240: Layer-coded section groups for the right sidebar
const LAYER_COLORS = {
  project: {
    border: "border-l-amber-400/60",
    text: "text-amber-400/80",
    bg: "bg-amber-400/5",
  },
  runtime: {
    border: "border-l-cyan-400/60",
    text: "text-cyan-400/80",
    bg: "bg-cyan-400/5",
  },
  agent: {
    border: "border-l-lime-400/60",
    text: "text-lime-400/80",
    bg: "bg-lime-400/5",
  },
  preview: {
    border: "border-l-violet-400/60",
    text: "text-violet-400/80",
    bg: "bg-violet-400/5",
  },
} as const;

function LayerGroup({
  layer,
  title,
  summary,
  children,
}: {
  layer: keyof typeof LAYER_COLORS;
  title: string;
  summary?: string;
  children: React.ReactNode;
}) {
  const colors = LAYER_COLORS[layer];
  return (
    <div className={`border-l-2 ${colors.border}`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 ${colors.bg}`}>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider ${colors.text}`}
        >
          {title}
        </span>
        {summary && (
          <span className="mono truncate text-[10px] text-gray-500 dark:text-slate-500">
            {summary}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ProjectActionsMenu({
  project,
  canManagePlatformProjects,
  canManagePlatformRuntime,
  userProviderCredentialsEnabled,
  managedProviderCreditsEnabled,
}: {
  project: OpsProject;
  canManagePlatformProjects: boolean;
  canManagePlatformRuntime: boolean;
  userProviderCredentialsEnabled: boolean;
  managedProviderCreditsEnabled: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const actionCtx: ProjectActionContext = {
    projectId: project.id,
    projectName: getProjectName(project),
    canManagePlatformProjects,
    canManagePlatformRuntime,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    project: toProjectActionSnapshot(project),
  };
  const actions = getProjectActions(actionCtx);
  const items = groupedActions(actions);
  const handlers = useActionHandlers(
    actionCtx,
    {
      setDeleteOpen,
      setCreditsOpen,
      setLogsOpen,
      setRenameOpen,
    },
    { refresh: false },
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded border border-gray-200 p-1 text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-500 dark:hover:text-slate-300"
            aria-label="Project actions"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {items.map((item, i) =>
            item === "separator" ? (
              <DropdownMenuSeparator key={`sep-${i}`} />
            ) : (
              <DropdownMenuItem
                key={item.id}
                onSelect={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  handlers[item.id]?.();
                }}
                className={item.className}
                disabled={item.disabled}
                title={item.disabledReason}
              >
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RunLogViewer
        projectId={project.id}
        isOpen={logsOpen}
        onClose={() => setLogsOpen(false)}
      />
      <AddCreditsButton
        projectId={project.id}
        externalOpen={creditsOpen}
        onExternalOpenChange={setCreditsOpen}
      />
      <ProjectDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectId={project.id}
        proposalTitle={getProjectName(project)}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        projectId={project.id}
        currentName={getProjectName(project)}
      />
    </>
  );
}

function ProjectsPanel({
  adminProjects,
  tools,
  agentLoops,
  proposals,
  onProjectSelect,
  canCreateProjects,
  canManagePlatformProjects,
  canManagePlatformRuntime,
  userProviderCredentialsEnabled,
  managedProviderCreditsEnabled,
}: {
  adminProjects: any[];
  tools: any[];
  agentLoops: ProjectFacingAgentLoop[];
  proposals?: { id: string; title: string }[];
  onProjectSelect: (projectId: string) => void;
  canCreateProjects: boolean;
  canManagePlatformProjects: boolean;
  canManagePlatformRuntime: boolean;
  userProviderCredentialsEnabled: boolean;
  managedProviderCreditsEnabled: boolean;
}) {
  const [view, setView] = useState<"cards" | "table">("cards");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-end gap-1">
        <div className="mr-auto">
          {canCreateProjects && (
            <CreateProjectButton
              tools={tools}
              agentLoops={agentLoops}
              proposals={proposals}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-gray-800 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              label="+ Project"
              postCreateBehavior="stay"
              allowPlatformCredentials={canManagePlatformProjects}
              allowManagedVps={canManagePlatformProjects}
            />
          )}
        </div>
        <button
          onClick={() => setView("cards")}
          className={`rounded-lg p-2 transition-colors ${view === "cards" ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950" : "text-gray-400 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-200"}`}
          title="Card view"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
        <button
          onClick={() => setView("table")}
          className={`rounded-lg p-2 transition-colors ${view === "table" ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950" : "text-gray-400 hover:text-gray-700 dark:text-slate-500 dark:hover:text-slate-200"}`}
          title="Table view"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
            <rect x="1" y="1" width="14" height="3" rx="1" />
            <rect x="1" y="6" width="14" height="3" rx="1" />
            <rect x="1" y="11" width="14" height="3" rx="1" />
          </svg>
        </button>
      </div>
      {canManagePlatformProjects && (
        <ExploreOrderManager projects={adminProjects as OpsProject[]} />
      )}
      {view === "cards" ? (
        <ProjectsGrid
          projects={adminProjects}
          onProjectClick={onProjectSelect}
          canManagePlatformProjects={canManagePlatformProjects}
          canManagePlatformRuntime={canManagePlatformRuntime}
          userProviderCredentialsEnabled={userProviderCredentialsEnabled}
          managedProviderCreditsEnabled={managedProviderCreditsEnabled}
        />
      ) : (
        <ProjectsTable
          projects={adminProjects}
          tools={tools}
          agentLoops={agentLoops}
          onProjectClick={onProjectSelect}
          canManagePlatformProjects={canManagePlatformProjects}
          canManagePlatformRuntime={canManagePlatformRuntime}
          userProviderCredentialsEnabled={userProviderCredentialsEnabled}
          managedProviderCreditsEnabled={managedProviderCreditsEnabled}
        />
      )}
    </div>
  );
}

const PREVIEW_MONITOR_W = 1280;
const PREVIEW_MONITOR_H = 800;

function SidebarPreview({
  url,
  projectId,
  projectName,
  visibility,
  bust,
}: {
  url: string;
  projectId: string;
  projectName: string;
  visibility: "featured" | "public" | "private";
  bust?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [cacheBust, setCacheBust] = useState(bust ?? 0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / PREVIEW_MONITOR_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Update cache bust when bust prop changes (e.g. after wake)
  useEffect(() => {
    if (bust && bust !== cacheBust) setCacheBust(bust);
  }, [bust]); // eslint-disable-line react-hooks/exhaustive-deps

  // After bust changes (e.g. wake), reload iframe multiple times with increasing delays
  // to catch the moment app starts responding
  useEffect(() => {
    if (!url || !bust) return;
    let cancelled = false;
    const delays = [3000, 5000, 8000, 12000, 20000]; // retry at 3s, 5s, 8s, 12s, 20s
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const delay of delays) {
      timers.push(
        setTimeout(() => {
          if (!cancelled) setCacheBust(Date.now());
        }, delay),
      );
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [url, bust]); // re-poll when bust changes (after wake)

  return (
    <div className="space-y-1.5">
      <div
        ref={containerRef}
        className="relative aspect-[16/10] overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-800"
      >
        <PreviewIframe
          key={cacheBust}
          previewUrl={url}
          proposalTitle={projectName}
          projectId={projectId}
          visibility={visibility}
          iframeClassName="pointer-events-none border-0 origin-top-left"
          iframeStyle={{
            width: PREVIEW_MONITOR_W,
            height: PREVIEW_MONITOR_H,
            transform: `scale(${scale})`,
          }}
          fallbackClassName="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-950/90 px-6 text-center text-slate-300"
        />
      </div>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setCacheBust(Date.now())}
          className="text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
          title="Refresh preview"
        >
          ↻ Refresh
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Open in new tab ↗
        </a>
      </div>
    </div>
  );
}

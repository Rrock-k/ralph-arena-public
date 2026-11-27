"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPowerIntent } from "@/app/actions/power-intent";
import { setAgentIntent } from "@/app/actions/agent-intent";
import { relaunchProject } from "@/app/actions/relaunch";
import { getProjectName } from "@/lib/project-identity";
import { getAdminProjectLabel } from "@/lib/admin-project-label";
import { getAdminLoopIdentity } from "@/lib/admin-loop-identity";
import { getLoopActionBlockMessageFromState } from "@/lib/loop-support";
import { getPowerOffConfirmMessage } from "@/lib/power-off-warning";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import { getOpsLoopMigrationState } from "./ops-loop-migration";
import {
  getAppComponent,
  getOpsStatusDetail,
  getOpsStatusDetailTooltip,
} from "@/lib/operator-display";
import { formatProviderBillingDisplay } from "@/lib/provider-billing-display";
import { getProjectPreviewOpenHref } from "@/lib/preview-url";
import { CollapsibleSection } from "./CollapsibleSection";
import { ContainerPanel } from "./ContainerPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { VpsPanel } from "./VpsPanel";
import { CyclePanel } from "./CyclePanel";
import { BudgetPanel } from "./BudgetPanel";
import { SpecsPanel } from "./SpecsPanel";
import { ProjectSecretsSection } from "../ProjectSecretsSection";
import { ProjectAssetsSection } from "../ProjectAssetsSection";
import { VisibilitySelector } from "../VisibilitySelector";
import { AiDisclaimerToggle } from "../AiDisclaimerToggle";
import { ProjectAccessPanel } from "../access/ProjectAccessPanel";
import { ProjectRuntimeSystemSelector } from "./ProjectModelSelector";
import { getRuntimeStartBlockReason } from "../ProjectActions";
import type { OpsProject } from "./OpsDashboard";
import type { ProjectAccessPanelState } from "@/lib/access-control/types";
import type { AccessAdminData } from "@/lib/access-control/types";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";
import Link from "next/link";
import { toast } from "sonner";

// ── Shared helpers ──────────────────────────────────────

function InfoRow({
  label,
  value,
  dot,
}: {
  label: string;
  value: string;
  dot?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-gray-400 dark:text-slate-500">
        {label}
      </span>
      <span className="mono flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-slate-200">
        {dot && (
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
        )}
        {value}
      </span>
    </div>
  );
}

function Toggle({
  on,
  onToggle,
  disabled,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-slate-600"}`}
      aria-label={label}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function BlockerBadge({ blocker }: { blocker: string }) {
  const colors: Record<string, string> = {
    BUDGET: "border-amber-400/25 bg-amber-500/10 text-amber-300",
    RATE_LIMIT: "border-orange-400/25 bg-orange-500/10 text-orange-300",
    SECRETS: "border-violet-400/25 bg-violet-500/10 text-violet-300",
    INFRA: "border-rose-400/25 bg-rose-500/10 text-rose-300",
    API: "border-red-400/25 bg-red-500/10 text-red-300",
  };
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${colors[blocker] ?? "border-slate-400/25 bg-slate-500/10 text-slate-300"}`}
    >
      {blocker}
    </span>
  );
}

function SectionHeader({ title, color }: { title: string; color: string }) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-slate-800 ${color}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

function formatAge(value: string | Date): string {
  const ageSec = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  return `${Math.floor(ageSec / 3600)}h ago`;
}

function readPayloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function readPayloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function compactText(value: string | null, max = 140): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function buildContextQuestionRows(events: NonNullable<OpsProject["contextQuestionEvents"]>) {
  const answersByQuestionId = new Map<string, NonNullable<OpsProject["contextQuestionEvents"]>[number]>();
  const questions: NonNullable<OpsProject["contextQuestionEvents"]>[number][] = [];
  for (const event of events) {
    if (event.type === "context_answer") {
      const payload = readPayloadObject(event.payload);
      const questionEventId = readPayloadString(payload.questionEventId);
      if (questionEventId && !answersByQuestionId.has(questionEventId)) {
        answersByQuestionId.set(questionEventId, event);
      }
      continue;
    }
    if (event.type === "context_question") {
      questions.push(event);
    }
  }

  return questions.slice(0, 4).map((event) => {
    const payload = readPayloadObject(event.payload);
    const answer = answersByQuestionId.get(event.id);
    const answerPayload = answer ? readPayloadObject(answer.payload) : {};
    const status = readPayloadString(answerPayload.status);
    return {
      id: event.id,
      question: readPayloadString(payload.question) ?? "Question",
      model: readPayloadString(payload.model) ?? "",
      status: status === "failed" ? "failed" : status === "answered" ? "answered" : "pending",
      answer: compactText(readPayloadString(answerPayload.answer)),
      error: compactText(readPayloadString(answerPayload.error), 100),
      askedAt: event.createdAt,
    };
  });
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

// ── Main Component ───────────────────────────────────────

interface ProjectSidebarProps {
  project: OpsProject;
  selectedProjectStatus: string;
  workspaceRoot?: string;
  canManageRuntime?: boolean;
  canManageSettings?: boolean;
  canManageSecrets?: boolean;
  canManageRequiredSecrets?: boolean;
  canRevealSecrets?: boolean;
  canViewBudget?: boolean;
  canManageBudget?: boolean;
  canManageAccess?: boolean;
  canEditSpecs?: boolean;
  canManageAssets?: boolean;
  canViewProject?: boolean;
  canManagePlatformProjects?: boolean;
  canManagePlatformRuntime?: boolean;
  canManagePlatformFinance?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
  // Access panel data
  projectAccessPanelState?: ProjectAccessPanelState;
  accessSubjects?: AccessAdminData["subjects"];
  // Preview render function (SidebarPreview lives in OpsDashboard)
  renderPreview?: () => React.ReactNode;
  tools?: any[];
  agentLoops?: ProjectFacingAgentLoop[];
}

export function ProjectSidebar({
  project,
  selectedProjectStatus,
  workspaceRoot,
  canManageRuntime,
  canManageSettings,
  canManageSecrets,
  canManageRequiredSecrets,
  canRevealSecrets,
  canViewBudget,
  canManageBudget,
  canManageAccess,
  canEditSpecs,
  canManageAssets,
  canViewProject,
  canManagePlatformProjects,
  canManagePlatformRuntime,
  canManagePlatformFinance,
  userProviderCredentialsEnabled,
  managedProviderCreditsEnabled,
  projectAccessPanelState,
  accessSubjects,
  renderPreview,
  tools = [],
  agentLoops = [],
}: ProjectSidebarProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const app = getAppComponent(project);
  const powerIntent = app?.powerIntent ?? "OFF";
  const agentIntent = app?.agentIntent ?? "ON";
  const runtimeState = app?.runtimeState ?? "ABSENT";
  const agentState = app?.agentState ?? null;
  const lastHeartbeat = app?.lastHeartbeat ?? null;
  const lastOutcome = app?.lastOutcome ?? null;
  const blockers = app?.blockers ?? [];
  const previewUrl = app?.previewUrl ?? null;
  const previewHref = getProjectPreviewOpenHref(project.id);
  const containerName = app?.containerName ?? null;
  const workerHost = app?.workerHost ?? null;
  const statusDetail = getOpsStatusDetail(project);
  const statusDetailTooltip = getOpsStatusDetailTooltip(project);
  const contextQuestionRows = buildContextQuestionRows(project.contextQuestionEvents ?? []);

  const appOn = powerIntent === "ON";
  const agentOn = agentIntent === "ON";
  const appStarting = appOn && runtimeState === "ABSENT";
  const appStopping = !appOn && runtimeState === "RUNNING";
  const appRunning = appOn && runtimeState === "RUNNING";
  const loopMigration = getOpsLoopMigrationState(
    project,
    selectedProjectStatus,
  );
  const metadataVersionLabel =
    project.useRepoHead && project.loopVersion
      ? project.loopVersion.startsWith("v")
        ? project.loopVersion
        : `v${project.loopVersion}`
      : null;
  const agentOnBlockReason = getLoopActionBlockMessageFromState(
    {
      loopIdentity: project.loopRuntime,
      supportStatus: project.loopSupportStatus,
      agentStartAllowed: project.agentStartAllowed,
      relaunchAllowed: project.relaunchAllowed,
    },
    "agent_on",
  );
  const runtimeStartBlockReason = getRuntimeStartBlockReason({
    projectId: project.id,
    projectName: getProjectName(project),
    project,
    canManagePlatformProjects,
    canManagePlatformRuntime,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
  });
  const appToggleDisabled =
    pending || appStarting || appStopping || (!appOn && Boolean(runtimeStartBlockReason));
  const agentToggleDisabled =
    pending || !appOn || (!agentOn && Boolean(agentOnBlockReason || runtimeStartBlockReason));

  const handleAppToggle = () => {
    startTransition(async () => {
      const turningOn = !appOn;
      if (turningOn && runtimeStartBlockReason) {
        toast.error(runtimeStartBlockReason);
        return;
      }
      if (
        !turningOn &&
        hasLiveAgentLoop(project) &&
        !window.confirm(getPowerOffConfirmMessage(getProjectName(project)))
      ) {
        return;
      }
      const result = await setPowerIntent(project.id, turningOn ? "ON" : "OFF");
      if (!result.success) {
        toast.error(result.error ?? "Failed");
        return;
      }
      if (turningOn) {
        toast.success("App start requested");
        router.refresh();
        return;
      }
      toast.success("App off");
      router.refresh();
    });
  };

  const handleAgentToggle = () => {
    startTransition(async () => {
      if (!agentOn && runtimeStartBlockReason) {
        toast.error(runtimeStartBlockReason);
        return;
      }
      if (!agentOn && agentOnBlockReason) {
        toast.error(agentOnBlockReason);
        return;
      }
      const result = await setAgentIntent(project.id, agentOn ? "OFF" : "ON");
      if (!result.success) {
        toast.error(result.error ?? "Failed");
        return;
      }
      router.refresh();
    });
  };

  const handleLoopMigration = () => {
    if (!loopMigration.visible || loopMigration.disabled) return;
    if (!window.confirm(loopMigration.confirmMessage)) return;
    startTransition(async () => {
      const result = await relaunchProject(project.id);
      if (!result.success) {
        toast.error(result.error ?? "Failed to migrate project");
        return;
      }
      toast.success("Migration queued. Project will restart on the bundled default runtime.");
      router.refresh();
    });
  };

  return (
    <>
      {/* ══════ PROJECT (amber) — identity, budget, specs, secrets, access ══════ */}
      <SectionHeader title="Project" color="text-amber-400/80 bg-amber-400/5" />

      <CollapsibleSection
        title="Info"
        storageKey="ops-sidebar-info"
        defaultOpen
      >
        <div className="space-y-1.5">
          <InfoRow label="Name" value={getAdminProjectLabel(project)} />
          <InfoRow label="Loop" value={getAdminLoopIdentity(project)} />
          {project.loopSupportLabel && (
            <InfoRow label="Support" value={project.loopSupportLabel} />
          )}
          {metadataVersionLabel && (
            <InfoRow label="Registry base" value={metadataVersionLabel} />
          )}
          {project.archivedAt && (
            <InfoRow label="Status" value="Archived" dot="bg-slate-400" />
          )}
        </div>
      </CollapsibleSection>

      {canViewBudget && (
        <CollapsibleSection
          title="Budget"
          storageKey="ops-sidebar-budget"
          defaultOpen
        >
          <BudgetPanel
            projectId={project.id}
            providerBillingMode={project.providerBillingMode}
            budget={project.budget}
            canEdit={canManageBudget}
            canFinanceAdmin={canManagePlatformFinance}
          />
        </CollapsibleSection>
      )}

      {(canManageSecrets || canManageRequiredSecrets || canRevealSecrets) && (
        <CollapsibleSection title="Secrets" storageKey="ops-sidebar-secrets">
          <ProjectSecretsSection
            projectId={project.id}
            secrets={project.secrets}
            requiredSecrets={project.requiredSecrets}
            showHeader={false}
            showWaitingRunPanel={false}
            canManageSecrets={canManageSecrets}
            canManageRequiredSecrets={canManageRequiredSecrets}
            canRevealCurrent={canRevealSecrets}
          />
        </CollapsibleSection>
      )}

      {canManageAccess && projectAccessPanelState && accessSubjects && (
        <CollapsibleSection title="Access" storageKey="ops-sidebar-access">
          <ProjectAccessPanel
            state={projectAccessPanelState}
            subjects={accessSubjects}
            projectScopedProjectId={project.id}
          />
        </CollapsibleSection>
      )}

      {canViewProject && (
        <CollapsibleSection
          title={`Specs (${project.specs.length})`}
          storageKey="ops-sidebar-specs"
        >
          <SpecsPanel
            projectId={project.id}
            specs={project.specs}
            assets={project.assets}
            canEdit={canEditSpecs}
          />
        </CollapsibleSection>
      )}

      {canViewProject && project.assets.length > 0 && (
        <CollapsibleSection
          title={`Assets (${project.assets.length})`}
          storageKey="ops-sidebar-assets"
        >
          <ProjectAssetsSection
            projectId={project.id}
            assets={project.assets}
            compact
            canEdit={canManageAssets}
          />
        </CollapsibleSection>
      )}

      {/* ══════ APP (cyan) — container, preview, workspace ══════ */}
      <SectionHeader title="App" color="text-cyan-400/80 bg-cyan-400/5" />

      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-700 dark:text-slate-300">
            {appStarting
              ? "Starting..."
              : appStopping
                ? "Stopping..."
                : appOn
                  ? "Running"
                  : "Off"}
          </span>
          {canManageRuntime && (
            <Toggle
              on={appOn}
              onToggle={handleAppToggle}
              disabled={appToggleDisabled}
              label="App power"
            />
          )}
        </div>
        {(appStarting || appStopping) && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-600 border-t-slate-300" />
            {appStarting ? "Container starting..." : "Container stopping..."}
          </div>
        )}
        {!appOn && runtimeStartBlockReason && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            {runtimeStartBlockReason}
          </div>
        )}
      </div>

      {/* Preview iframe */}
      {previewUrl && (
        <CollapsibleSection
          title="Preview"
          storageKey="ops-sidebar-preview"
          defaultOpen
        >
          {canManageSettings && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <VisibilitySelector
                projectId={project.id}
                initialValue={
                  (project.visibility as "featured" | "public" | "private") ??
                  "public"
                }
                showFeatured={canManagePlatformProjects}
              />
              {canManagePlatformProjects && (
                <AiDisclaimerToggle
                  projectId={project.id}
                  initialValue={project.showAiDisclaimer !== false}
                />
              )}
            </div>
          )}
          {runtimeState === "ABSENT" ? (
            <div className="flex items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/50 py-8 text-[11px] text-slate-500">
              Preview unavailable — app is off
            </div>
          ) : renderPreview ? (
            renderPreview()
          ) : (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-blue-400 hover:text-blue-300"
            >
              Open preview
            </a>
          )}
        </CollapsibleSection>
      )}

      {/* Container details */}
      {canManageRuntime && !runtimeStartBlockReason && (
        <CollapsibleSection
          title="Container"
          storageKey="ops-sidebar-container"
          defaultOpen={appRunning}
        >
          <ContainerPanel
            projectId={project.id}
            containerName={containerName}
            projectName={getProjectName(project)}
            projectStatus={selectedProjectStatus}
            powerIntent={powerIntent}
            agentIntent={agentIntent}
            runtimeState={runtimeState}
            agentState={agentState}
          />
        </CollapsibleSection>
      )}

      {/* Workspace */}
      <CollapsibleSection
        title="Workspace"
        storageKey="ops-sidebar-workspace"
        defaultOpen
      >
        <WorkspacePanel
          projectId={project.id}
          projectName={getProjectName(project)}
          projectSlug={project.slug}
          repoUrl={project.repoUrl}
          commitSha={project.commitSha}
          workerHost={workerHost}
          workspaceRoot={workspaceRoot}
        />
      </CollapsibleSection>

      {/* VPS */}
      {canManageRuntime && canManagePlatformRuntime && (
        <CollapsibleSection
          title="VPS"
          storageKey="ops-sidebar-vps"
          defaultOpen={!!project.vpsHost}
        >
          <VpsPanel
            projectId={project.id}
            vpsHost={project.vpsHost}
            projectStatus={selectedProjectStatus}
          />
        </CollapsibleSection>
      )}

      {/* ══════ AGENT (lime) — loop state, cycle, blockers ══════ */}
      <SectionHeader title="Agent" color="text-lime-400/80 bg-lime-400/5" />

      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-gray-700 dark:text-slate-300">
            {agentOn ? (agentState === "RUNNING" ? "Running" : "Idle") : "Off"}
          </span>
          {canManageRuntime && (
            <Toggle
              on={agentOn}
              onToggle={handleAgentToggle}
              disabled={agentToggleDisabled}
              label="Agent loop"
            />
          )}
        </div>
        {!agentOn && (agentOnBlockReason || runtimeStartBlockReason) && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            {agentOnBlockReason ?? runtimeStartBlockReason}
          </div>
        )}
        {project.loopSupportHint && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {project.loopSupportHint}
          </div>
        )}
        {statusDetail && (
          <div
            className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            title={statusDetailTooltip ?? undefined}
          >
            {statusDetail}
          </div>
        )}
        {canManageRuntime && loopMigration.visible && (
          <div className="mt-3 rounded-md border border-lime-200 bg-lime-50/70 px-2 py-2 text-[11px] text-lime-900 dark:border-lime-500/30 dark:bg-lime-500/10 dark:text-lime-100">
            <div className="font-medium">Migrate to bundled default</div>
            <div className="mt-1 text-[10px] text-lime-800 dark:text-lime-100/85">
              {loopMigration.warning}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleLoopMigration}
                disabled={pending || loopMigration.disabled}
                className="rounded-md bg-lime-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-lime-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-lime-500 dark:text-slate-950 dark:hover:bg-lime-400"
              >
                {pending ? "Queueing..." : "Migrate to bundled default"}
              </button>
              {loopMigration.hint && (
                <span className="text-[10px] text-lime-800 dark:text-lime-100/85">
                  {loopMigration.hint}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <CollapsibleSection
        title="Status"
        storageKey="ops-sidebar-agent-status"
        defaultOpen
      >
        <div className="space-y-1.5">
          {canManageRuntime ? (
            <ProjectRuntimeSystemSelector
              projectId={project.id}
              agent={project.agent}
              agentImpl={project.agentImpl}
              currentModel={project.model}
              currentToolId={project.toolId}
              currentProviderBillingMode={project.providerBillingMode}
              allowPlatformCredentials={canManagePlatformProjects || canManagePlatformRuntime}
              tools={tools}
              agentLoops={agentLoops}
              disabled={agentState === "RUNNING"}
            />
          ) : (
            <>
              <InfoRow
                label="System"
                value={`${project.agent}/${project.agentImpl}`}
              />
              <InfoRow
                label="Model"
                value={project.model ?? "\u2014"}
              />
            </>
          )}
          {(canManagePlatformProjects || canManagePlatformRuntime) && (
            <InfoRow
              label="Billing"
              value={formatProviderBillingDisplay(project)}
            />
          )}
          {lastOutcome && (
            <InfoRow
              label="Last outcome"
              value={lastOutcome}
              dot={
                lastOutcome === "COMPLETED" ? "bg-emerald-400" : "bg-rose-400"
              }
            />
          )}
          {lastHeartbeat && (
            <InfoRow label="Heartbeat" value={formatAge(lastHeartbeat)} />
          )}
          {blockers.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {blockers.map((b) => (
                <BlockerBadge key={b} blocker={b} />
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {canViewProject && (
        <CollapsibleSection
          title="Context Q&A"
          storageKey="ops-sidebar-context-questions"
          defaultOpen={contextQuestionRows.length > 0}
        >
          {contextQuestionRows.length === 0 ? (
            <div className="text-[11px] text-gray-400 dark:text-slate-500">
              No context questions yet.
            </div>
          ) : (
            <div className="space-y-2">
              {contextQuestionRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800 dark:text-slate-100">
                      {compactText(row.question, 96)}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${
                        row.status === "answered"
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          : row.status === "failed"
                            ? "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                            : "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                  {(row.answer || row.error) && (
                    <div className="mt-1 text-gray-500 dark:text-slate-400">
                      {row.answer ?? row.error}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-400 dark:text-slate-500">
                    <span className="mono">{row.model}</span>
                    <span>{formatAge(row.askedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Cycle"
        storageKey="ops-sidebar-cycle"
        defaultOpen
      >
        <CyclePanel
          progressJson={project.progressJson}
          status={selectedProjectStatus}
        />
      </CollapsibleSection>

      {/* ══════ Links ══════ */}
      <CollapsibleSection title="Links" storageKey="ops-sidebar-links">
        <div className="flex flex-col gap-1.5">
          <SidebarLink href={`/projects/${project.id}`}>
            Public Page
          </SidebarLink>
          {project.repoUrl && (
            <SidebarLink href={project.repoUrl} external>
              Repository
            </SidebarLink>
          )}
          {previewUrl && (
            <SidebarLink href={previewHref} external>
              Preview
            </SidebarLink>
          )}
        </div>
      </CollapsibleSection>
    </>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type { ProjectInteractionSnapshot } from "@arena/contracts";
import { AgentOffButton } from "@/components/admin/AgentOffButton";
import { AgentOnButton } from "@/components/admin/AgentOnButton";
import { ArchiveProjectButton } from "@/components/admin/ArchiveProjectButton";
import { ProjectAssetsSection } from "@/components/admin/ProjectAssetsSection";
import { ProjectSecretsSection } from "@/components/admin/ProjectSecretsSection";
import { VisibilitySelector } from "@/components/admin/VisibilitySelector";
import { ProjectAccessPanel } from "@/components/admin/access/ProjectAccessPanel";
import {
  ProjectManagerDeliveryTargetPanel,
  type ProjectManagerDeliveryTargetState,
} from "@/components/project-interaction/ProjectManagerDeliveryTargetPanel";
import { RelaunchButton } from "@/components/admin/RelaunchButton";
import { TgSpecLaunchSetupButton } from "@/components/project-interaction/TgSpecLaunchSetupButton";
import { SpecList } from "@/components/admin/SpecList";
import { UnarchiveProjectButton } from "@/components/admin/UnarchiveProjectButton";
import { PowerOnButton } from "@/components/admin/PowerOnButton";
import { BuildProgress } from "@/components/BuildProgress";
import type {
  AccessSubjectSummary,
  ProjectAccessPanelState,
} from "@/lib/access-control/types";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import { isCancelInFlight } from "@/lib/display-status";
import { getMyProjectPausedRecoveryAction } from "@/lib/my-surfaces";
import {
  getOpsStatusDetail,
  getOpsStatusDetailTooltip,
  isPausedPreviewCohort,
  type OperatorDisplayProject,
} from "@/lib/operator-display";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";
import {
  buildProjectSecretsFocusHref,
  PROJECT_INTERACTION_SECRETS_ANCHOR_ID,
  PROJECT_INTERACTION_VISUAL_EVIDENCE_ANCHOR_ID,
  type ProjectInteractionFocus,
} from "@/lib/project-interaction-deeplink";
import { getProjectPreviewOpenHref } from "@/lib/preview-url";
import { formatRetryHint, formatRetryHintTooltip } from "@/lib/retry-status";
import { getStatusClasses } from "@/lib/status-classes";
import { normalizeProviderBillingMode } from "@/lib/user-launch-policy";

type ProjectInteractionTool = {
  id: string;
  name: string;
  description: string | null;
  models: string | null;
  defaultModelId: string | null;
  isActive: boolean;
};

export type ProjectInteractionLaunchConfig = {
  currentAgent?: string;
  currentAgentImpl?: string;
  currentModel?: string | null;
  currentClaudeAuthMode?: string | null;
  currentCodexAuthMode?: string | null;
  currentRunnerBackend?: string | null;
  tools: ProjectInteractionTool[];
  agentLoops: ProjectFacingAgentLoop[];
  simpleRelaunchMode: boolean;
  allowCookieAutoconfirm?: boolean;
  allowPlatformCredentials: boolean;
  allowManagedVps: boolean;
  userProviderCredentialsEnabled: boolean;
  managedProviderCreditsEnabled: boolean;
  currentProviderBillingMode?: string | null;
  tgSpecLaunchConfigurationState?: "required" | "configured" | null;
  userCreditBalance?: number;
};

const PROJECT_INTERACTION_SECTION_IDS = {
  overview: "project-overview",
  preview: "project-preview",
  macBuild: "project-mac-build",
  tasks: "project-tasks",
  visualEvidence: PROJECT_INTERACTION_VISUAL_EVIDENCE_ANCHOR_ID,
  feedback: "project-feedback",
  assumptions: "project-assumptions",
  specs: "project-specs",
  assets: "project-assets",
  secrets: PROJECT_INTERACTION_SECRETS_ANCHOR_ID,
  status: "project-status",
  activity: "project-activity",
  settings: "project-settings",
  managerUpdates: "project-manager-updates",
  access: "project-access",
} as const;

export function buildProjectInteractionDisplayProject(
  snapshot: ProjectInteractionSnapshot,
): OperatorDisplayProject {
  return {
    archivedAt: snapshot.project.archivedAt,
    app: {
      previewUrl: snapshot.preview.url,
      previewHealth: snapshot.app.previewHealth,
      powerIntent: snapshot.app.powerIntent,
      agentIntent: snapshot.app.agentIntent,
      runtimeState: snapshot.app.runtimeState,
      agentState: snapshot.app.agentState,
      blockers: snapshot.app.blockers,
      lastOutcome: snapshot.app.lastOutcome,
      retryAt: snapshot.app.retryAt,
    },
  };
}

function isProviderLaunchBlocked(
  config: ProjectInteractionLaunchConfig,
): boolean {
  const providerBillingMode = normalizeProviderBillingMode(config.currentProviderBillingMode);
  const isProviderAgent = config.currentAgent === "codex" || config.currentAgent === "claude-code";

  return (
    (config.currentRunnerBackend === "vps" && !config.allowManagedVps)
    || (
      isProviderAgent
      && !config.allowPlatformCredentials
      && (
        providerBillingMode === "platform_credits"
          ? !config.managedProviderCreditsEnabled
          : providerBillingMode === "platform_credentials" || !config.userProviderCredentialsEnabled
      )
    )
  );
}

function shouldShowVisualEvidenceSection(
  snapshot: ProjectInteractionSnapshot,
  focus?: ProjectInteractionFocus | null,
): boolean {
  return snapshot.visualEvidenceReviews.length > 0 || focus?.section === "visualEvidence";
}

function toSpecListItems(snapshot: ProjectInteractionSnapshot) {
  return snapshot.specs.map((spec) => ({
    ...spec,
    createdAt: new Date(spec.createdAt),
    updatedAt: new Date(spec.updatedAt),
    versions: spec.versions.map((version) => ({
      version: version.version,
      createdAt: new Date(version.createdAt),
    })),
  }));
}

function toAssetListItems(snapshot: ProjectInteractionSnapshot) {
  return snapshot.assets.map((asset) => ({
    ...asset,
    createdAt: new Date(asset.createdAt),
    updatedAt: new Date(asset.updatedAt),
  }));
}

function shouldShowSecretsSection(
  snapshot: ProjectInteractionSnapshot,
  launchConfig: ProjectInteractionLaunchConfig,
  focus?: ProjectInteractionFocus | null,
) {
  if (!snapshot.viewer.sections.secrets) return false;

  const hasConcreteSecretNeed =
    snapshot.secrets.provided.length > 0
    || snapshot.secrets.required.length > 0
    || snapshot.app.blockers.includes("SECRETS")
    || focus?.section === "secrets";

  if (launchConfig.tgSpecLaunchConfigurationState && !hasConcreteSecretNeed) {
    return false;
  }

  return true;
}

function shouldShowMacBuildSection(snapshot: ProjectInteractionSnapshot): boolean {
  return snapshot.viewer.sections.preview
    && (
      snapshot.macBuild.status !== "not_available"
      || snapshot.macBuild.latestArtifact !== null
    );
}

function CollectionLimitNote({
  meta,
  itemLabel,
}: {
  meta: ProjectInteractionSnapshot["collections"]["tasks"];
  itemLabel: string;
}) {
  if (!meta.hasMore) return null;
  return (
    <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
      Showing first {meta.visible} of {meta.total} {itemLabel}.
    </p>
  );
}

function buildInteractionStatusProgressJson(snapshot: ProjectInteractionSnapshot): string | null {
  if (snapshot.execution.activeChangeBatches.length === 0) {
    return snapshot.progress.raw ? JSON.stringify(snapshot.progress.raw) : null;
  }

  const current = snapshot.execution.current;
  const progress = current?.progress;
  const currentTask = current?.task;
  const steps = snapshot.tasks.map((task) => ({
    id: task.id,
    label: task.label,
    status: task.status,
  }));
  if (!progress && !currentTask && steps.length === 0) return null;

  return JSON.stringify({
    state: snapshot.progress.raw?.state ?? snapshot.progress.summary.state ?? current?.type ?? "working",
    ...(snapshot.progress.raw?.iteration != null ? { iteration: snapshot.progress.raw.iteration } : {}),
    ...(progress?.completed != null ? { featuresCompleted: progress.completed } : {}),
    ...(progress?.total != null ? { featuresTotal: progress.total } : {}),
    ...(steps.length > 0 ? { steps } : {}),
    ...(currentTask ? {
      currentFeature: {
        id: currentTask.id,
        description: currentTask.label,
      },
    } : {}),
  });
}

export function ProjectInteractionManagerNav({
  snapshot,
  launchConfig,
  focus,
}: {
  snapshot: ProjectInteractionSnapshot;
  launchConfig: ProjectInteractionLaunchConfig;
  focus?: ProjectInteractionFocus | null;
}) {
  const showSecrets = shouldShowSecretsSection(snapshot, launchConfig, focus);
  const showVisualEvidence = shouldShowVisualEvidenceSection(snapshot, focus);
  const items = [
    { id: PROJECT_INTERACTION_SECTION_IDS.overview, label: "Overview", visible: true },
    { id: PROJECT_INTERACTION_SECTION_IDS.preview, label: "Preview", visible: snapshot.viewer.sections.preview },
    { id: PROJECT_INTERACTION_SECTION_IDS.macBuild, label: "Mac Build", visible: shouldShowMacBuildSection(snapshot) },
    { id: PROJECT_INTERACTION_SECTION_IDS.tasks, label: "Tasks", visible: snapshot.viewer.sections.tasks },
    { id: PROJECT_INTERACTION_SECTION_IDS.visualEvidence, label: "Screenshots", visible: showVisualEvidence },
    { id: PROJECT_INTERACTION_SECTION_IDS.feedback, label: "Feedback", visible: snapshot.viewer.sections.feedback },
    { id: PROJECT_INTERACTION_SECTION_IDS.assumptions, label: "Assumptions", visible: snapshot.viewer.sections.assumptions },
    { id: PROJECT_INTERACTION_SECTION_IDS.specs, label: "Specs", visible: snapshot.viewer.sections.specs },
    { id: PROJECT_INTERACTION_SECTION_IDS.assets, label: "Assets", visible: snapshot.viewer.sections.assets },
    { id: PROJECT_INTERACTION_SECTION_IDS.secrets, label: "Secrets", visible: showSecrets },
    { id: PROJECT_INTERACTION_SECTION_IDS.status, label: "Progress", visible: snapshot.viewer.sections.status },
    { id: PROJECT_INTERACTION_SECTION_IDS.activity, label: "Activity", visible: snapshot.viewer.sections.activity },
    { id: PROJECT_INTERACTION_SECTION_IDS.settings, label: "Settings", visible: snapshot.viewer.sections.settings },
    { id: PROJECT_INTERACTION_SECTION_IDS.managerUpdates, label: "Telegram Updates", visible: snapshot.viewer.allowedActions.manageAccess },
    { id: PROJECT_INTERACTION_SECTION_IDS.access, label: "Access", visible: snapshot.viewer.sections.access },
  ].filter((item) => item.visible);

  return (
    <nav
      aria-label="Project manager sections"
      className="sticky top-0 z-10 mb-6 border-y border-gray-200 bg-white/95 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="flex gap-2 overflow-x-auto">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

type ProjectInteractionHeaderProps = {
  snapshot: ProjectInteractionSnapshot;
  description?: string | null;
  repoUrl?: string | null;
  launchConfig: ProjectInteractionLaunchConfig;
};

export function ProjectInteractionHeader({
  snapshot,
  description,
  repoUrl,
  launchConfig,
}: ProjectInteractionHeaderProps) {
  const projectId = snapshot.project.id;
  const displayProject = buildProjectInteractionDisplayProject(snapshot);
  const displayStatus = snapshot.app.publicStatus;
  const statusDetail = getOpsStatusDetail(displayProject);
  const statusDetailTooltip = getOpsStatusDetailTooltip(displayProject);
  const isPausedPreview = isPausedPreviewCohort(displayProject);
  const hasLiveLoop = hasLiveAgentLoop(snapshot.app);
  const isPaused = displayStatus === "PAUSED";
  const pausedRecoveryAction = getMyProjectPausedRecoveryAction(displayProject);
  const providerLaunchBlocked = isProviderLaunchBlocked(launchConfig);
  const previewHref = getProjectPreviewOpenHref(projectId);
  const allowedActions = snapshot.viewer.allowedActions;
  const canUseArenaRuntimeControls =
    snapshot.viewer.surface === "arena"
    && snapshot.viewer.effectiveCapabilities.includes("project.runtime.manage");

  return (
    <ProjectInteractionPanel id={PROJECT_INTERACTION_SECTION_IDS.overview}>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl">
            {snapshot.project.name}
          </h1>
          {description && (
            <p className="mt-3 text-sm text-gray-600 dark:text-slate-300">
              {description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <span
            className={`mono inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getStatusClasses(displayStatus)}`}
          >
            {displayStatus}
          </span>
          {snapshot.project.archivedAt && canUseArenaRuntimeControls && (
            <UnarchiveProjectButton projectId={projectId} />
          )}
          {!snapshot.project.archivedAt &&
            canUseArenaRuntimeControls &&
            launchConfig.tgSpecLaunchConfigurationState &&
            !hasLiveLoop && (
              <TgSpecLaunchSetupButton
                projectId={projectId}
                hasAcceptedSpec={snapshot.specs.length > 0}
                currentAgent={launchConfig.currentAgent}
                currentAgentImpl={launchConfig.currentAgentImpl}
                currentModel={launchConfig.currentModel}
                tools={launchConfig.tools}
                agentLoops={launchConfig.agentLoops}
                allowPlatformCredentials={launchConfig.allowPlatformCredentials}
                allowManagedVps={launchConfig.allowManagedVps}
                userProviderCredentialsEnabled={launchConfig.userProviderCredentialsEnabled}
                managedProviderCreditsEnabled={launchConfig.managedProviderCreditsEnabled}
                userCreditBalance={launchConfig.userCreditBalance ?? 0}
                preferDefaultLaunchConfiguration={launchConfig.tgSpecLaunchConfigurationState === "required"}
              />
            )}
          {!snapshot.project.archivedAt &&
            !hasLiveLoop &&
            isPaused &&
            allowedActions.startApp &&
            !providerLaunchBlocked &&
            pausedRecoveryAction === "powerOn" && (
              <PowerOnButton projectId={projectId} />
            )}
          {!snapshot.project.archivedAt &&
            !hasLiveLoop &&
            (isPaused || isPausedPreview) &&
            allowedActions.startAgent &&
            !providerLaunchBlocked &&
            pausedRecoveryAction === "agentOn" && (
              <AgentOnButton
                projectId={projectId}
                loopRuntime={snapshot.app.loopRuntime}
                loopSupportStatus={snapshot.app.loopSupportStatus}
                agentStartAllowed={allowedActions.startAgent}
              />
            )}
          {!snapshot.project.archivedAt && hasLiveLoop && allowedActions.pauseAgent && (
            <>
              <AgentOffButton
                projectId={projectId}
                pendingState={isCancelInFlight(displayProject)}
              />
              <ArchiveProjectButton projectId={projectId} />
            </>
          )}
          {!snapshot.project.archivedAt &&
            !hasLiveLoop &&
            !isPaused &&
            allowedActions.relaunch &&
            !providerLaunchBlocked && (
              <RelaunchButton
                projectId={projectId}
                currentAgent={launchConfig.currentAgent}
                currentAgentImpl={launchConfig.currentAgentImpl}
                currentModel={launchConfig.currentModel}
                currentClaudeAuthMode={launchConfig.currentClaudeAuthMode}
                currentCodexAuthMode={launchConfig.currentCodexAuthMode}
                currentRunnerBackend={launchConfig.currentRunnerBackend}
                tools={launchConfig.tools}
                agentLoops={launchConfig.agentLoops}
                simpleMode={launchConfig.simpleRelaunchMode}
                allowCookieAutoconfirm={launchConfig.allowCookieAutoconfirm}
                allowPlatformCredentials={launchConfig.allowPlatformCredentials}
                allowManagedVps={launchConfig.allowManagedVps}
                userProviderCredentialsEnabled={launchConfig.userProviderCredentialsEnabled}
                managedProviderCreditsEnabled={launchConfig.managedProviderCreditsEnabled}
                currentProviderBillingMode={normalizeProviderBillingMode(launchConfig.currentProviderBillingMode)}
              />
            )}
        </div>
      </div>

      {statusDetail && (
        <div
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          title={statusDetailTooltip ?? undefined}
        >
          {statusDetail}
        </div>
      )}

      <div className="mono mb-4 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
        <span>Mode: {snapshot.project.mode}</span>
        {launchConfig.currentAgent && launchConfig.currentAgentImpl && (
          <span>
            Agent: {launchConfig.currentAgent}/{launchConfig.currentAgentImpl}
          </span>
        )}
        <span>
          Created {new Date(snapshot.project.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {snapshot.preview.url && (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 transition-colors hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
          >
            Open Preview
          </a>
        )}
        {repoUrl && (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-black hover:text-gray-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
          >
            Repository
          </a>
        )}
        {snapshot.macBuild.latestArtifact && (
          <a
            href={snapshot.macBuild.latestArtifact.downloadUrl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300 px-3 py-1.5 text-sm text-cyan-700 transition-colors hover:border-cyan-500 hover:text-cyan-900 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:border-cyan-400 dark:hover:text-cyan-100"
          >
            Download Mac App
          </a>
        )}
        {snapshot.viewer.sections.secrets && snapshot.app.blockers.includes("SECRETS") && (
          <a
            href={buildProjectSecretsFocusHref(projectId)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 px-3 py-1.5 text-sm text-violet-700 transition-colors hover:border-violet-500 hover:text-violet-900 dark:border-violet-500/30 dark:text-violet-300 dark:hover:border-violet-400 dark:hover:text-violet-100"
          >
            Open Secrets
          </a>
        )}
      </div>
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionPreviewSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.preview) return null;

  const previewHref = getProjectPreviewOpenHref(snapshot.project.id);
  const previewHealth = snapshot.preview.health ?? "UNKNOWN";

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.preview}
      title="Preview"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(previewHealth)}`}
            >
              {previewHealth}
            </span>
            {snapshot.preview.checkedAt && (
              <span className="mono text-xs text-gray-500 dark:text-slate-400">
                Checked {new Date(snapshot.preview.checkedAt).toLocaleString()}
              </span>
            )}
          </div>
          {snapshot.preview.url ? (
            <p className="mono mt-2 truncate text-xs text-gray-500 dark:text-slate-400">
              {snapshot.preview.url}
            </p>
          ) : (
            <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
              Preview is not available.
            </p>
          )}
        </div>
        {snapshot.preview.url && (
          <a
            href={previewHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 transition-colors hover:border-emerald-500 hover:text-emerald-900 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:border-emerald-400 dark:hover:text-emerald-100"
          >
            Open Preview
          </a>
        )}
      </div>
    </ProjectInteractionPanel>
  );
}

function macBuildStatusClasses(status: ProjectInteractionSnapshot["macBuild"]["status"]): string {
  switch (status) {
    case "available":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
    case "building":
      return "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200";
    case "build_failed":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";
    case "not_available":
      return "border-gray-200 bg-gray-50 text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function ProjectInteractionMacBuildSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!shouldShowMacBuildSection(snapshot)) return null;

  const latestArtifact = snapshot.macBuild.latestArtifact;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.macBuild}
      title="Mac Build"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${macBuildStatusClasses(snapshot.macBuild.status)}`}
            >
              {snapshot.macBuild.status.replaceAll("_", " ")}
            </span>
            {snapshot.macBuild.updatedAt && (
              <span className="mono text-xs text-gray-500 dark:text-slate-400">
                Updated {new Date(snapshot.macBuild.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
          {latestArtifact ? (
            <div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-slate-300">
              <p className="font-medium text-gray-900 dark:text-slate-100">
                {latestArtifact.filename} · {formatFileSize(latestArtifact.sizeBytes)}
              </p>
              <p className="mono break-all text-xs text-gray-500 dark:text-slate-400">
                {latestArtifact.sha256}
              </p>
              <p className="mono text-xs text-gray-500 dark:text-slate-400">
                {[
                  latestArtifact.version ? `version ${latestArtifact.version}` : null,
                  latestArtifact.tag ? `tag ${latestArtifact.tag}` : null,
                  latestArtifact.commitSha ? `commit ${latestArtifact.commitSha}` : null,
                  snapshot.macBuild.builderLabel ? `builder ${snapshot.macBuild.builderLabel}` : null,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">
              Mac build is not available yet.
            </p>
          )}
          {snapshot.macBuild.failureSummary && (
            <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">
              {snapshot.macBuild.failureSummary}
            </p>
          )}
        </div>
        {latestArtifact && (
          <a
            href={latestArtifact.downloadUrl}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-300 px-3 py-1.5 text-sm text-cyan-700 transition-colors hover:border-cyan-500 hover:text-cyan-900 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:border-cyan-400 dark:hover:text-cyan-100"
          >
            Download Mac App
          </a>
        )}
      </div>
    </ProjectInteractionPanel>
  );
}

function isTaskDone(status: ProjectInteractionSnapshot["tasks"][number]["status"]): boolean {
  return status === "completed" || status === "skipped";
}

function ProjectTaskCountPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "open" | "active" | "done";
}) {
  const classes = {
    open: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    active: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200",
    done: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
  }[tone];

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${classes}`}>
      {value} {label}
    </span>
  );
}

export function ProjectInteractionTasksSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.tasks) return null;

  const doneCount = snapshot.tasks.filter((task) => isTaskDone(task.status)).length;
  const activeCount = snapshot.tasks.filter((task) => task.status === "in_progress").length;
  const openCount = Math.max(0, snapshot.tasks.length - doneCount);

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.tasks}
      title="Tasks"
    >
      {snapshot.tasks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          No tasks yet.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <ProjectTaskCountPill label="open" value={openCount} tone="open" />
            <ProjectTaskCountPill label="now" value={activeCount} tone="active" />
            <ProjectTaskCountPill label="done" value={doneCount} tone="done" />
          </div>
          <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
            Open work is shown first; completed tasks stay below for history.
          </p>
          <div className="divide-y divide-gray-200 dark:divide-slate-800">
            {snapshot.tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm font-medium text-gray-800 dark:text-slate-200">
                  {task.label}
                </span>
                <span
                  className={`mono inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(task.status.toUpperCase())}`}
                >
                  {task.status.replaceAll("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <CollectionLimitNote meta={snapshot.collections.tasks} itemLabel="tasks" />
    </ProjectInteractionPanel>
  );
}

function visualEvidenceStatusClasses(status: ProjectInteractionSnapshot["visualEvidenceReviews"][number]["status"]): string {
  switch (status) {
    case "passed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
    case "failed":
    case "conflict":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";
    case "inconclusive":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
    case "unassessed":
      return "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200";
  }
}

export function ProjectInteractionVisualEvidenceSection({
  snapshot,
  focus,
}: {
  snapshot: ProjectInteractionSnapshot;
  focus?: ProjectInteractionFocus | null;
}) {
  if (!shouldShowVisualEvidenceSection(snapshot, focus)) return null;

  const focusedReviewId = focus?.section === "visualEvidence" ? focus.reviewId : null;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.visualEvidence}
      title="Screenshots"
      isFocused={focus?.section === "visualEvidence"}
    >
      {snapshot.visualEvidenceReviews.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          No visual evidence yet.
        </p>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-slate-800">
          {snapshot.visualEvidenceReviews.map((review) => {
            const latestAssessment = review.assessments.at(-1);
            return (
              <div
                key={review.id}
                className={`py-3 ${focusedReviewId === review.id ? "rounded-md bg-cyan-50 px-3 dark:bg-cyan-500/10" : ""}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {review.taskLabel}
                    </h3>
                    <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                      {review.summary}
                    </p>
                    <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                      {review.target.route} - {review.target.viewport.width}x{review.target.viewport.height}
                      {review.target.claim ? ` - ${review.target.claim}` : ""}
                    </p>
                    {review.artifact.availability === "available" && review.artifact.url ? (
                      <img
                        src={review.artifact.url}
                        alt={review.summary}
                        className="mt-3 aspect-video w-full max-w-3xl rounded-md border border-gray-200 object-contain dark:border-slate-800"
                      />
                    ) : (
                      <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
                        Screenshot unavailable: {review.artifact.unavailableReason?.replaceAll("_", " ")}
                      </p>
                    )}
                    {latestAssessment && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                        {latestAssessment.result}: {latestAssessment.summary}
                      </p>
                    )}
                  </div>
                  <span
                    className={`mono inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${visualEvidenceStatusClasses(review.status)}`}
                  >
                    {review.status.replaceAll("_", " ")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionFeedbackSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.feedback) return null;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.feedback}
      title="Feedback"
    >
      {snapshot.feedback.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          No feedback yet.
        </p>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-slate-800">
          {snapshot.feedback.map((item) => (
            <div key={item.id} className="py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                    {item.body}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`mono inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(item.state.toUpperCase())}`}
                  >
                    {item.state.replaceAll("_", " ")}
                  </span>
                  {item.reopenCount > 0 && (
                    <span className="mono inline-flex w-fit rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      reopened#{item.reopenCount}
                    </span>
                  )}
                </div>
              </div>
              {item.resolution && (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  {item.resolution.kind.replaceAll("_", " ")}: {item.resolution.summary}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <CollectionLimitNote meta={snapshot.collections.feedback} itemLabel="feedback items" />
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionAssumptionsSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.assumptions) return null;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.assumptions}
      title="Assumptions"
    >
      {snapshot.assumptions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          No assumptions yet.
        </p>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-slate-800">
          {snapshot.assumptions.map((assumption) => (
            <div key={assumption.id} className="py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {assumption.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
                    {assumption.statement}
                  </p>
                </div>
                <span
                  className={`mono inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(assumption.state.toUpperCase())}`}
                >
                  {assumption.state.replaceAll("_", " ")}
                </span>
              </div>
              {assumption.outcome && (
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  {assumption.outcome.kind.replaceAll("_", " ")}
                  {assumption.outcome.correctionSummary
                    ? `: ${assumption.outcome.correctionSummary}`
                    : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <CollectionLimitNote meta={snapshot.collections.assumptions} itemLabel="assumptions" />
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionSpecsSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.specs) return null;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.specs}
      title="Specifications"
    >
      <SpecList
        projectId={snapshot.project.id}
        specs={toSpecListItems(snapshot)}
        assets={toAssetListItems(snapshot)}
        canEdit={snapshot.viewer.allowedActions.writeSpecs}
      />
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionAssetsSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.assets) return null;

  const assets = toAssetListItems(snapshot);
  if (assets.length === 0 && !snapshot.viewer.allowedActions.manageAssets) return null;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.assets}
      title="Assets"
    >
      <ProjectAssetsSection
        projectId={snapshot.project.id}
        assets={assets}
        canEdit={snapshot.viewer.allowedActions.manageAssets}
      />
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionSecretsSection({
  snapshot,
  launchConfig,
  focus,
}: {
  snapshot: ProjectInteractionSnapshot;
  launchConfig: ProjectInteractionLaunchConfig;
  focus?: ProjectInteractionFocus;
}) {
  if (!shouldShowSecretsSection(snapshot, launchConfig, focus)) return null;

  const hasLiveLoop = hasLiveAgentLoop(snapshot.app);
  const waitingForSecrets = snapshot.app.blockers.includes("SECRETS")
    ? {
      since: snapshot.app.retryAt ?? snapshot.project.updatedAt,
    }
    : null;

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECRETS_ANCHOR_ID}
      isFocused={focus?.section === "secrets"}
    >
      <ProjectSecretsSection
        projectId={snapshot.project.id}
        secrets={snapshot.secrets.provided}
        requiredSecrets={snapshot.secrets.required}
        focusRequiredSecretKey={focus?.section === "secrets" ? focus.requiredSecretKey : null}
        autoProvideSecretKey={focus?.section === "secrets" ? focus.provideSecretKey : null}
        waitingForSecrets={waitingForSecrets}
        hasLiveAgentLoop={hasLiveLoop}
        currentAgent={launchConfig.currentAgent}
        currentAgentImpl={launchConfig.currentAgentImpl}
        currentModel={launchConfig.currentModel}
        currentClaudeAuthMode={launchConfig.currentClaudeAuthMode}
        currentCodexAuthMode={launchConfig.currentCodexAuthMode}
        currentRunnerBackend={launchConfig.currentRunnerBackend}
        tools={launchConfig.tools}
        agentLoops={launchConfig.agentLoops}
        simpleRelaunchMode={launchConfig.simpleRelaunchMode}
        allowCookieAutoconfirm={launchConfig.allowCookieAutoconfirm}
        allowPlatformCredentials={launchConfig.allowPlatformCredentials}
        allowManagedVps={launchConfig.allowManagedVps}
        userProviderCredentialsEnabled={launchConfig.userProviderCredentialsEnabled}
        managedProviderCreditsEnabled={launchConfig.managedProviderCreditsEnabled}
        currentProviderBillingMode={normalizeProviderBillingMode(launchConfig.currentProviderBillingMode)}
        currentLoopRuntime={snapshot.app.loopRuntime}
        currentLoopSupportStatus={snapshot.app.loopSupportStatus}
        currentAgentStartAllowed={snapshot.viewer.allowedActions.startAgent}
        currentRelaunchAllowed={snapshot.viewer.allowedActions.relaunch}
        canManageSecrets={snapshot.viewer.allowedActions.manageSecrets}
        canManageRequiredSecrets={snapshot.viewer.allowedActions.manageRequiredSecrets}
        canRevealCurrent={snapshot.viewer.allowedActions.revealSecrets}
      />
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionStatusSection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.status) return null;

  const displayProject = buildProjectInteractionDisplayProject(snapshot);
  const displayStatus = snapshot.app.publicStatus;
  const isPaused = displayStatus === "PAUSED";
  const isPausedPreview = isPausedPreviewCohort(displayProject);
  const retryHint = formatRetryHint(snapshot.app.retryAt);
  const retryHintTooltip = formatRetryHintTooltip(snapshot.app.retryAt);
  const progressJson = buildInteractionStatusProgressJson(snapshot);

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.status}
      title="Status"
    >
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(displayStatus)}`}
          >
            {displayStatus}
          </span>
          <span className="mono text-xs text-gray-500 dark:text-slate-400">
            {new Date(snapshot.project.updatedAt).toLocaleString()}
          </span>
        </div>
        {snapshot.viewer.sections.progress && progressJson && (
          <BuildProgress progressJson={progressJson} />
        )}
        {(isPaused || isPausedPreview) && retryHint && (
          <p
            className="mt-1 text-xs text-amber-700 dark:text-amber-300"
            title={retryHintTooltip ?? undefined}
          >
            {retryHint}
          </p>
        )}
      </div>
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionActivitySection({
  snapshot,
}: {
  snapshot: ProjectInteractionSnapshot;
}) {
  if (!snapshot.viewer.sections.activity) return null;

  const activityItems = [
    ...snapshot.activity.runEvents.map((event) => ({
      id: `run-${event.id}`,
      code: event.event,
      label: event.label,
      source: "Run",
      createdAt: event.createdAt,
    })),
    ...snapshot.activity.projectEvents.map((event) => ({
      id: `project-${event.id}`,
      code: event.type,
      label: event.label,
      source: event.direction === "in" ? "Project input" : "Project output",
      createdAt: event.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <ProjectInteractionPanel
      id={PROJECT_INTERACTION_SECTION_IDS.activity}
      title="Event History"
    >
      {activityItems.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          No events yet.
        </p>
      ) : (
        <div className="space-y-2">
          {activityItems.map((event) => (
            <div
              key={event.id}
              className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/80"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`mono inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(event.code)}`}
                >
                  {event.code}
                </span>
                <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
                  {event.label}
                </span>
                <span className="mono text-[11px] text-gray-400 dark:text-slate-500">
                  {event.source}
                </span>
                <span className="mono text-[11px] text-gray-500 dark:text-slate-400">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </ProjectInteractionPanel>
  );
}

export function ProjectInteractionSettingsSection({
  snapshot,
  canFeatureProject,
  accessPanelState,
  accessSubjects,
  managerDeliveryTargetState,
}: {
  snapshot: ProjectInteractionSnapshot;
  canFeatureProject: boolean;
  accessPanelState?: ProjectAccessPanelState | null;
  accessSubjects?: AccessSubjectSummary[];
  managerDeliveryTargetState?: ProjectManagerDeliveryTargetState | null;
}) {
  const showSettings = snapshot.viewer.sections.settings;
  const showAccess = snapshot.viewer.sections.access;
  const showManagerUpdates = Boolean(managerDeliveryTargetState);
  if (!showSettings && !showAccess && !showManagerUpdates) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {showSettings && (
        <ProjectInteractionPanel
          id={PROJECT_INTERACTION_SECTION_IDS.settings}
          title="Settings"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                Visibility
              </h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Current: {snapshot.project.visibility}
              </p>
            </div>
            <VisibilitySelector
              projectId={snapshot.project.id}
              initialValue={snapshot.project.visibility}
              showFeatured={canFeatureProject}
            />
          </div>
        </ProjectInteractionPanel>
      )}

      {showAccess && (
        <ProjectInteractionPanel
          id={PROJECT_INTERACTION_SECTION_IDS.access}
          title="Access"
        >
          {accessPanelState ? (
            <ProjectAccessPanel
              state={accessPanelState}
              subjects={accessSubjects ?? []}
              projectScopedProjectId={snapshot.project.id}
            />
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Access data unavailable.
            </p>
          )}
        </ProjectInteractionPanel>
      )}

      {showManagerUpdates && managerDeliveryTargetState && (
        <ProjectInteractionPanel
          id={PROJECT_INTERACTION_SECTION_IDS.managerUpdates}
          title="Telegram Updates"
        >
          <ProjectManagerDeliveryTargetPanel
            projectId={snapshot.project.id}
            activeTarget={managerDeliveryTargetState.activeTarget}
            recentTargets={managerDeliveryTargetState.recentTargets}
            tgSpecBindings={managerDeliveryTargetState.tgSpecBindings}
          />
        </ProjectInteractionPanel>
      )}
    </div>
  );
}

export function ProjectInteractionPanel({
  id,
  title,
  isFocused = false,
  children,
}: {
  id?: string;
  title?: string;
  isFocused?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={`mb-6 scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none sm:p-6 lg:p-8 ${
        isFocused
          ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-white dark:ring-violet-500 dark:ring-offset-slate-950"
          : ""
      }`}
    >
      {title && (
        <h2 className="mb-3 text-xl font-semibold text-gray-900 dark:text-slate-100 sm:text-2xl">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export function ProjectInteractionBackLink() {
  return (
    <Link
      href="/my"
      className="inline-flex items-center text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      <svg
        className="mr-2 h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      Back to Dashboard
    </Link>
  );
}

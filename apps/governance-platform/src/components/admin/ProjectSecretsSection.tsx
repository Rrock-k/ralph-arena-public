"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createProjectSecret,
  updateProjectSecret,
  deleteProjectSecret,
  revealProjectSecret,
  addRequiredSecret,
  removeRequiredSecret,
} from "@/app/actions/secrets";
import type { SecretListItem } from "@/lib/action-types";
import type { RequiredSecretEntry } from "@/lib/required-secrets";
import {
  getProjectRequiredSecretAnchorId,
  normalizeProjectInteractionRequiredSecretKey,
} from "@/lib/project-interaction-deeplink";
import { getMissingFocusedRequiredSecretKey } from "@/lib/project-secret-focus";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";
import { AgentOnButton } from "@/components/admin/AgentOnButton";
import { RelaunchButton } from "@/components/admin/RelaunchButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type ProjectSecretListItem = {
  id: string;
  key: string;
  description?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

interface ProjectSecretsSectionProps {
  projectId: string;
  secrets: ProjectSecretListItem[];
  requiredSecrets: RequiredSecretEntry[];
  waitingForSecrets?: {
    since?: Date | string | null;
  } | null;
  hasLiveAgentLoop?: boolean;
  currentAgent?: string;
  currentAgentImpl?: string;
  currentModel?: string | null;
  currentClaudeAuthMode?: string | null;
  currentCodexAuthMode?: string | null;
  currentRunnerBackend?: string | null;
  tools?: any[];
  agentLoops?: ProjectFacingAgentLoop[];
  simpleRelaunchMode?: boolean;
  allowCookieAutoconfirm?: boolean;
  allowPlatformCredentials?: boolean;
  allowManagedVps?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
  currentProviderBillingMode?: string | null;
  canManageSecrets?: boolean;
  canManageRequiredSecrets?: boolean;
  canRevealCurrent?: boolean;
  currentLoopRuntime?: string | null;
  currentLoopSupportStatus?: "supported" | "upgrade-required" | "unsupported" | null;
  currentAgentStartAllowed?: boolean;
  currentRelaunchAllowed?: boolean;
  focusRequiredSecretKey?: string | null;
  autoProvideSecretKey?: string | null;
  showHeader?: boolean;
  showWaitingRunPanel?: boolean;
}

type ProviderBillingMode = "byok" | "platform_credits" | "platform_credentials";

function normalizeProviderBillingMode(value: string | null | undefined): ProviderBillingMode {
  if (value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return "byok";
}

export function ProjectSecretsSection({
  projectId,
  secrets,
  requiredSecrets,
  waitingForSecrets = null,
  hasLiveAgentLoop = false,
  currentAgent,
  currentAgentImpl,
  currentModel,
  currentClaudeAuthMode,
  currentCodexAuthMode,
  currentRunnerBackend,
  tools = [],
  agentLoops = [],
  simpleRelaunchMode = false,
  allowCookieAutoconfirm = false,
  allowPlatformCredentials = false,
  allowManagedVps = false,
  userProviderCredentialsEnabled = true,
  managedProviderCreditsEnabled = false,
  currentProviderBillingMode = "byok",
  canManageSecrets = true,
  canManageRequiredSecrets = true,
  canRevealCurrent = true,
  currentLoopRuntime,
  currentLoopSupportStatus,
  currentAgentStartAllowed = true,
  currentRelaunchAllowed = true,
  focusRequiredSecretKey,
  autoProvideSecretKey,
  showHeader = true,
  showWaitingRunPanel = true,
}: ProjectSecretsSectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addRequiredOpen, setAddRequiredOpen] = useState(false);
  const [editSecret, setEditSecret] = useState<ProjectSecretListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSecretListItem | null>(null);
  // When user clicks "Provide" on a missing required secret, pre-fill key
  const [provideKey, setProvideKey] = useState<{ key: string; description?: string } | null>(null);

  const providedKeys = new Set(secrets.map((s) => s.key));
  const isRequirementProvided = (entry: RequiredSecretEntry): boolean => {
    const snapshotProvided = (entry as RequiredSecretEntry & { provided?: boolean }).provided;
    return snapshotProvided === true || providedKeys.has(entry.key);
  };
  const missingRequired = requiredSecrets.filter((r) => !isRequirementProvided(r));
  const normalizedFocusRequiredSecretKey = normalizeProjectInteractionRequiredSecretKey(
    focusRequiredSecretKey,
  );
  const missingFocusedRequiredSecretKey = getMissingFocusedRequiredSecretKey(
    focusRequiredSecretKey,
    requiredSecrets,
  );
  const normalizedAutoProvideSecretKey = normalizeProjectInteractionRequiredSecretKey(
    autoProvideSecretKey,
  );
  const autoProvideEntry = normalizedAutoProvideSecretKey
    ? missingRequired.find((entry) => entry.key === normalizedAutoProvideSecretKey) ?? null
    : null;
  const autoProvideEntryKey = autoProvideEntry?.key ?? null;
  const autoProvideEntryDescription = autoProvideEntry?.description;
  const latestWaitingRun = showWaitingRunPanel ? waitingForSecrets : null;
  const blockingMissingCount = missingRequired.filter((entry) => entry.blocking !== false).length;
  const providerBillingMode = normalizeProviderBillingMode(currentProviderBillingMode);
  const providerLaunchBlocked = !allowPlatformCredentials
    && (currentAgent === "codex" || currentAgent === "claude-code")
    && (
      providerBillingMode === "platform_credits"
        ? !managedProviderCreditsEnabled
        : providerBillingMode === "platform_credentials" || !userProviderCredentialsEnabled
    );
  const canResumeWaitingRun = !providerLaunchBlocked
    && !hasLiveAgentLoop
    && blockingMissingCount === 0
    && !!latestWaitingRun
    && (currentAgentStartAllowed || currentRelaunchAllowed);
  const waitingRunUnavailableMessage = blockingMissingCount === 0
    && !currentAgentStartAllowed
    && !currentRelaunchAllowed
    ? "Runtime controls are unavailable on this surface"
    : "Provide all blocking secrets to unlock agent start";
  const actionButtons = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canManageRequiredSecrets && (
        <button
          onClick={() => setAddRequiredOpen(true)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-all hover:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
        >
          Add Requirement
        </button>
      )}
      {canManageSecrets && (
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-all hover:border-violet-400 hover:bg-violet-100"
        >
          Add Secret
        </button>
      )}
    </div>
  );

  useEffect(() => {
    if (!canManageSecrets || !autoProvideEntryKey) return;
    setProvideKey((current) => (
      current?.key === autoProvideEntryKey
        ? current
        : {
          key: autoProvideEntryKey,
          ...(autoProvideEntryDescription ? { description: autoProvideEntryDescription } : {}),
        }
    ));
  }, [autoProvideEntryDescription, autoProvideEntryKey, canManageSecrets]);

  return (
    <>
      {showHeader ? (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 sm:text-2xl">
            Secrets
          </h2>
          {actionButtons}
        </div>
      ) : (
        (canManageSecrets || canManageRequiredSecrets) && (
          <div className="mb-3 flex items-center justify-end">
            {actionButtons}
          </div>
        )
      )}

      {latestWaitingRun && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Agent waiting for secrets
              </p>
              {latestWaitingRun.since && (
                <p className="mono mt-1 text-xs text-amber-800 dark:text-amber-300">
                  Since {new Date(latestWaitingRun.since).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canResumeWaitingRun ? (
                <>
                  {currentAgentStartAllowed && (
                    <AgentOnButton
                      projectId={projectId}
                      loopRuntime={currentLoopRuntime}
                      loopSupportStatus={currentLoopSupportStatus}
                      agentStartAllowed={currentAgentStartAllowed}
                    />
                  )}
                  {currentRelaunchAllowed && (
                    <RelaunchButton
                      projectId={projectId}
                      currentAgent={currentAgent}
                      currentAgentImpl={currentAgentImpl}
                      currentModel={currentModel}
                      currentClaudeAuthMode={currentClaudeAuthMode}
                      currentCodexAuthMode={currentCodexAuthMode}
                      currentRunnerBackend={currentRunnerBackend}
                      tools={tools}
                      agentLoops={agentLoops}
                      simpleMode={simpleRelaunchMode}
                      allowCookieAutoconfirm={allowCookieAutoconfirm}
                      allowPlatformCredentials={allowPlatformCredentials}
                      allowManagedVps={allowManagedVps}
                      userProviderCredentialsEnabled={userProviderCredentialsEnabled}
                      managedProviderCreditsEnabled={managedProviderCreditsEnabled}
                      currentProviderBillingMode={providerBillingMode}
                    />
                  )}
                </>
              ) : (
                <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300">
                  {waitingRunUnavailableMessage}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {missingFocusedRequiredSecretKey && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          Required secret <span className="mono font-semibold">{missingFocusedRequiredSecretKey}</span> is not configured for this project.
        </div>
      )}

      {/* Required Secrets Checklist */}
      {requiredSecrets.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
            Required
            {missingRequired.length > 0 && (
              <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                {missingRequired.length} missing
              </span>
            )}
          </h3>
          <div className="space-y-1.5">
            {requiredSecrets.map((req) => {
              const isProvided = isRequirementProvided(req);
              const isFocused = normalizedFocusRequiredSecretKey === req.key;
              return (
                <div
                  key={req.key}
                  id={getProjectRequiredSecretAnchorId(req.key)}
                  aria-current={isFocused ? "true" : undefined}
                  className={`flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
                    isProvided
                      ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                      : "border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10"
                  } ${
                    isFocused
                      ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-white dark:ring-violet-500 dark:ring-offset-slate-900"
                      : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={`text-sm ${isProvided ? "text-emerald-600 dark:text-emerald-300" : "text-amber-500 dark:text-amber-300"}`}
                      >
                        {isProvided ? "\u2713" : "\u25CB"}
                      </span>
                      <span className="mono min-w-0 max-w-full break-all text-sm font-medium text-gray-900 dark:text-slate-100">
                        {req.key}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          req.blocking === false
                            ? "border border-sky-200 bg-sky-50 text-sky-700"
                            : "border border-rose-200 bg-rose-50 text-rose-700"
                        }`}
                      >
                        {req.blocking === false ? "optional" : "blocking"}
                      </span>
                    </div>
                    {(req.description || req.requestedAt) && (
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 pl-6 text-[11px] text-gray-500 dark:text-slate-400">
                        {req.description && (
                          <span className="min-w-0 break-words">
                            {req.description}
                          </span>
                        )}
                        {req.requestedAt && (
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 font-medium text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            requested {new Date(req.requestedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                    {!isProvided && canManageSecrets && (
                      <button
                        onClick={() => setProvideKey({ key: req.key, description: req.description })}
                        className="rounded-md border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                      >
                        Provide
                      </button>
                    )}
                    {canManageRequiredSecrets && (
                      <RemoveRequiredButton projectId={projectId} secretKey={req.key} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {missingRequired.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-slate-100">
            Requested by agent
          </h3>
          <div className="space-y-2">
            {missingRequired.map((req) => {
              const isFocused = normalizedFocusRequiredSecretKey === req.key;
              return (
                <div
                  key={`requested-${req.key}`}
                  className={`rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 ${
                    isFocused
                      ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-gray-50 dark:ring-violet-500 dark:ring-offset-slate-800"
                      : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-sm font-semibold text-gray-900 dark:text-slate-100">{req.key}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      req.blocking === false
                        ? "border border-sky-200 bg-sky-50 text-sky-700"
                        : "border border-rose-200 bg-rose-50 text-rose-700"
                    }`}>
                      {req.blocking === false ? "optional" : "blocking"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    {req.description || "No description provided"}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-gray-500 dark:text-slate-400">
                    {req.requestedAt && <span>{new Date(req.requestedAt).toLocaleString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Provided Secrets */}
      {secrets.length === 0 && requiredSecrets.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">
          No secrets configured for this project.
        </p>
      ) : secrets.length > 0 ? (
        <>
          {requiredSecrets.length > 0 && (
            <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
              Provided ({secrets.length})
            </h3>
          )}
          <div className="space-y-2">
            {secrets.map((secret) => (
              <div
                key={secret.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <span className="mono break-all text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {secret.key}
                  </span>
                  {secret.description && (
                    <p className="mt-0.5 break-words text-xs text-gray-500 dark:text-slate-400">
                      {secret.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
                  <span className="mono text-gray-400 dark:text-slate-500">
                    {new Date(secret.updatedAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => setEditSecret(secret)}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:border-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(secret)}
                    className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 font-medium text-rose-600 hover:border-rose-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Add Secret Dialog */}
      {canManageSecrets && (
        <AddEditSecretDialog
          projectId={projectId}
          canRevealCurrent={canRevealCurrent}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}

      {/* Provide (pre-filled key from required) */}
      {provideKey && (
        <AddEditSecretDialog
          projectId={projectId}
          prefillKey={provideKey.key}
          prefillDescription={provideKey.description}
          canRevealCurrent={canRevealCurrent}
          open={true}
          onOpenChange={(open) => {
            if (!open) setProvideKey(null);
          }}
        />
      )}

      {/* Edit Secret Dialog */}
      {editSecret && (
        <AddEditSecretDialog
          projectId={projectId}
          secret={editSecret}
          canRevealCurrent={canRevealCurrent}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditSecret(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <DeleteSecretDialog
          secret={deleteTarget}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      )}

      {/* Add Requirement Dialog */}
      {canManageRequiredSecrets && (
        <AddRequirementDialog
          projectId={projectId}
          open={addRequiredOpen}
          onOpenChange={setAddRequiredOpen}
        />
      )}
    </>
  );
}

// ── Remove Required Secret Button ────────────────────────────

function RemoveRequiredButton({
  projectId,
  secretKey,
}: {
  projectId: string;
  secretKey: string;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    const result = await removeRequiredSecret(projectId, secretKey);
    if (result.success) {
      toast.success(`Removed "${secretKey}" from requirements`);
    } else {
      toast.error(result.error || "Failed to remove");
    }
    setRemoving(false);
  };

  return (
    <button
      onClick={handleRemove}
      disabled={removing}
      className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-slate-300"
      title="Remove requirement"
    >
      ✕
    </button>
  );
}

// ── Add Requirement Dialog ───────────────────────────────────

function AddRequirementDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const result = await addRequiredSecret(projectId, key, description || undefined);
    if (result.success) {
      toast.success(`Added "${key.toUpperCase()}" to requirements`);
      onOpenChange(false);
      setKey("");
      setDescription("");
    } else {
      toast.error(result.error || "Failed to add requirement");
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-slate-100">Add requirement</DialogTitle>
          <DialogDescription className="text-gray-600 dark:text-slate-400">
            Declare a secret this project needs. The value will be provided separately.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Key
            </label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. PostgreSQL connection string"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleSubmit}
            disabled={isSubmitting || !key.trim()}
          >
            {isSubmitting ? "Adding..." : "Add"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add / Edit Secret Dialog ─────────────────────────────────

function AddEditSecretDialog({
  projectId,
  secret,
  prefillKey,
  prefillDescription,
  canRevealCurrent = true,
  open,
  onOpenChange,
}: {
  projectId: string;
  secret?: ProjectSecretListItem;
  prefillKey?: string;
  prefillDescription?: string;
  canRevealCurrent?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = !!secret;
  const [key, setKey] = useState(secret?.key ?? prefillKey ?? "");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState(
    secret?.description ?? prefillDescription ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  const handleReveal = async () => {
    if (!secret) return;
    setIsRevealing(true);
    const result = await revealProjectSecret(secret.id);
    if (result.success) {
      setValue(result.value);
    } else {
      toast.error(result.error || "Failed to reveal secret");
    }
    setIsRevealing(false);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    if (isEdit && secret) {
      const result = await updateProjectSecret(
        secret.id,
        value || undefined,
        description,
      );
      if (result.success) {
        toast.success(`Secret "${secret.key}" updated`);
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed to update secret");
      }
    } else {
      const result = await createProjectSecret(
        projectId,
        key,
        value,
        description || undefined,
      );
      if (result.success) {
        toast.success(`Secret "${key.toUpperCase()}" created`);
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed to create secret");
      }
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-slate-100">
            {isEdit
              ? `Edit secret: ${secret.key}`
              : prefillKey
                ? `Provide secret: ${prefillKey}`
                : "Add secret"}
          </DialogTitle>
          <DialogDescription className="text-gray-600 dark:text-slate-400">
            {isEdit
              ? "Update the value or description. Leave value empty to keep current."
              : "Secrets are encrypted and injected as env vars into agent containers."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {!isEdit && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Key
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="MY_API_KEY"
                readOnly={!!prefillKey}
                className={`mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                  prefillKey ? "bg-gray-100 dark:bg-slate-800" : ""
                }`}
              />
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Value {isEdit && "(leave empty to keep current)"}
              </label>
              {isEdit && canRevealCurrent && (
                <button
                  type="button"
                  onClick={handleReveal}
                  disabled={isRevealing}
                  className="text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50"
                >
                  {isRevealing ? "Revealing..." : "Reveal current"}
                </button>
              )}
            </div>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isEdit ? "Enter new value..." : "secret-value-here"}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Google Maps API key for geocoding"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleSubmit}
            disabled={isSubmitting || (!isEdit && (!key.trim() || !value))}
          >
            {isSubmitting ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirmation Dialog ───────────────────────────────

function DeleteSecretDialog({
  secret,
  open,
  onOpenChange,
}: {
  secret: ProjectSecretListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteProjectSecret(secret.id);
    if (result.success) {
      toast.success(`Secret "${secret.key}" deleted`);
      onOpenChange(false);
    } else {
      toast.error(result.error || "Failed to delete secret");
    }
    setIsDeleting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-slate-100">Delete secret</DialogTitle>
          <DialogDescription className="text-gray-600 dark:text-slate-400">
            Are you sure you want to delete{" "}
            <span className="mono font-semibold text-gray-900 dark:text-slate-100">
              {secret.key}
            </span>
            ? This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

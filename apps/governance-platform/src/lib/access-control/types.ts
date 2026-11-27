export type IsoDateString = string;

export const TG_SPEC_AUTO_SYNC_REASON_PREFIX = "Auto-synced from tg-spec Telegram ";

export const PROJECT_ACCESS_CAPABILITIES = [
  "project.view",
  "project.runtime.manage",
  "project.specs.write",
  "project.assets.manage",
  "project.secrets.manage",
  "project.secrets.reveal",
  "project.required_secrets.manage",
  "project.budget.view",
  "project.budget.manage",
  "project.settings.manage",
  "project.access.manage",
  "project.delete",
] as const;

export const PLATFORM_ACCESS_CAPABILITIES = [
  "platform.ops.view",
  "platform.projects.view",
  "platform.projects.manage",
  "platform.registry.manage",
  "platform.governance.manage",
  "platform.finance.manage",
  "platform.flags.manage",
  "platform.runtime.manage",
  "platform.access.manage",
] as const;

export const ACCESS_CAPABILITIES = [
  ...PROJECT_ACCESS_CAPABILITIES,
  ...PLATFORM_ACCESS_CAPABILITIES,
] as const;

export type ProjectAccessCapability = typeof PROJECT_ACCESS_CAPABILITIES[number];
export type PlatformAccessCapability = typeof PLATFORM_ACCESS_CAPABILITIES[number];
export type AccessCapability = typeof ACCESS_CAPABILITIES[number];

export type AccessScopeType = "platform" | "project";

export interface AccessScopeRef {
  type: AccessScopeType;
  projectId?: string;
  projectName?: string;
  label?: string;
}

export type AccessPresetKey =
  | "superadmin"
  | "ops_admin"
  | "governance_admin"
  | "finance_admin"
  | "registry_admin"
  | "project_manager"
  | "project_curator"
  | "project_viewer";

export type AccessGrantSourceKind = "manual" | "telegram_admin_sync";

export interface AccessPresetDefinition {
  key: AccessPresetKey;
  label: string;
  description: string;
  scopeType: AccessScopeType;
  capabilities: AccessCapability[];
  highlightCapabilities: AccessCapability[];
  accent: "amber" | "emerald" | "sky" | "violet" | "slate";
  isSystemPreset: true;
}

export interface AccessActorSummary {
  id: string | null;
  email: string | null;
  name: string | null;
}

export interface AccessSubjectSummary {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
}

export interface AccessProjectOption {
  id: string;
  name: string;
}

export interface AccessGrantRecord {
  id: string;
  subjectUserId: string;
  subject: AccessSubjectSummary | null;
  scope: AccessScopeRef;
  sourcePresetKey: AccessPresetKey | null;
  sourceKind: AccessGrantSourceKind;
  customLabel: string | null;
  capabilities: AccessCapability[];
  grantedBy: AccessActorSummary | null;
  reason: string | null;
  lastSyncedAt: IsoDateString | null;
  expiresAt: IsoDateString | null;
  revokedAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export type EffectiveAccessSourceKind = "owner" | "direct" | "inherited";

export type AccessGrantVisualState = "active" | "expired" | "revoked";

export interface EffectiveAccessSource {
  kind: EffectiveAccessSourceKind;
  scope: AccessScopeRef;
  label: string;
  sourcePresetKey: AccessPresetKey | null;
  grantId: string | null;
  capabilities: AccessCapability[];
  state: AccessGrantVisualState;
  expiresAt: IsoDateString | null;
  revokedAt: IsoDateString | null;
}

export interface EffectiveAccessCapabilityEntry {
  capability: AccessCapability;
  grantedVia: string[];
}

export interface AccessPeopleRow {
  subject: AccessSubjectSummary;
  activeGrantCount: number;
  directGrants: AccessGrantRecord[];
  inheritedSources: EffectiveAccessSource[];
  effectiveCapabilities: AccessCapability[];
  effectiveCapabilityEntries: EffectiveAccessCapabilityEntry[];
  summaryPills: string[];
}

export type AccessAuditAction =
  | "grant_created"
  | "grant_updated"
  | "grant_revoked"
  | "grant_expired";

export interface AccessAuditEntry {
  id: string;
  action: AccessAuditAction;
  occurredAt: IsoDateString;
  actor: AccessActorSummary | null;
  subject: AccessSubjectSummary;
  scope: AccessScopeRef;
  sourcePresetKey: AccessPresetKey | null;
  sourceKind: AccessGrantSourceKind;
  previousCapabilities: AccessCapability[];
  nextCapabilities: AccessCapability[];
  note: string | null;
}

export interface ProjectAccessPanelState {
  scope: AccessScopeRef;
  owner: AccessSubjectSummary | null;
  directGrants: AccessGrantRecord[];
  inheritedSources: EffectiveAccessSource[];
  hasAnyDirectGrant: boolean;
}

export interface AccessAdminData {
  subjects: AccessSubjectSummary[];
  peopleRows: AccessPeopleRow[];
  grants: AccessGrantRecord[];
  auditEntries: AccessAuditEntry[];
}

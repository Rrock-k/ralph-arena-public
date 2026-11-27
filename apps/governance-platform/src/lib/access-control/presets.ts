import type {
  AccessCapability,
  AccessPresetDefinition,
  AccessPresetKey,
} from "./types";

export const ACCESS_PRESET_ACCENT_STYLES: Record<
  AccessPresetDefinition["accent"],
  { border: string; bg: string; text: string; dot: string; ring: string }
> = {
  amber: {
    border: "border-amber-300 dark:border-amber-400/40",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500 dark:bg-amber-400",
    ring: "ring-amber-300 dark:ring-amber-400/30",
  },
  emerald: {
    border: "border-emerald-300 dark:border-emerald-400/40",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    ring: "ring-emerald-300 dark:ring-emerald-400/30",
  },
  sky: {
    border: "border-sky-300 dark:border-sky-400/40",
    bg: "bg-sky-50 dark:bg-sky-500/10",
    text: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500 dark:bg-sky-400",
    ring: "ring-sky-300 dark:ring-sky-400/30",
  },
  violet: {
    border: "border-violet-300 dark:border-violet-400/40",
    bg: "bg-violet-50 dark:bg-violet-500/10",
    text: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500 dark:bg-violet-400",
    ring: "ring-violet-300 dark:ring-violet-400/30",
  },
  slate: {
    border: "border-gray-300 dark:border-slate-400/40",
    bg: "bg-gray-50 dark:bg-slate-500/10",
    text: "text-gray-600 dark:text-slate-300",
    dot: "bg-gray-400 dark:bg-slate-400",
    ring: "ring-gray-300 dark:ring-slate-400/30",
  },
};

const ALL_CAPABILITIES: AccessCapability[] = [
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
  "platform.ops.view",
  "platform.projects.view",
  "platform.projects.manage",
  "platform.registry.manage",
  "platform.governance.manage",
  "platform.finance.manage",
  "platform.flags.manage",
  "platform.runtime.manage",
  "platform.access.manage",
];

export const PROJECT_CURATOR_CAPABILITIES: AccessCapability[] = [
  "project.view",
  "project.runtime.manage",
  "project.specs.write",
  "project.assets.manage",
  "project.settings.manage",
  "project.secrets.manage",
  "project.required_secrets.manage",
  "project.budget.view",
];

export const PROJECT_VIEWER_CAPABILITIES: AccessCapability[] = [
  "project.view",
];

export const PROJECT_MANAGER_CAPABILITIES: AccessCapability[] = [
  "project.view",
  "project.secrets.manage",
  "project.required_secrets.manage",
];

export const OPS_ADMIN_CAPABILITIES: AccessCapability[] = [
  "platform.ops.view",
  "platform.projects.view",
  "platform.projects.manage",
  "platform.runtime.manage",
  "project.view",
  "project.runtime.manage",
  "project.settings.manage",
];

export const GOVERNANCE_ADMIN_CAPABILITIES: AccessCapability[] = [
  "platform.ops.view",
  "platform.governance.manage",
  "platform.projects.view",
  "project.view",
];

export const FINANCE_ADMIN_CAPABILITIES: AccessCapability[] = [
  "platform.ops.view",
  "platform.finance.manage",
  "platform.projects.view",
  "project.view",
  "project.budget.view",
  "project.budget.manage",
];

export const REGISTRY_ADMIN_CAPABILITIES: AccessCapability[] = [
  "platform.ops.view",
  "platform.registry.manage",
  "platform.projects.view",
  "project.view",
];

export const ACCESS_PRESET_DEFINITIONS: Record<AccessPresetKey, AccessPresetDefinition> = {
  superadmin: {
    key: "superadmin",
    label: "Superadmin",
    description: "Break-glass full platform access. Legacy ADMIN equivalent during migration.",
    scopeType: "platform",
    capabilities: ALL_CAPABILITIES,
    highlightCapabilities: [
      "platform.ops.view",
      "platform.access.manage",
      "platform.runtime.manage",
      "project.access.manage",
      "project.delete",
    ],
    accent: "amber",
    isSystemPreset: true,
  },
  ops_admin: {
    key: "ops_admin",
    label: "Ops Admin",
    description: "Operational control over projects and runtime without finance or access delegation.",
    scopeType: "platform",
    capabilities: OPS_ADMIN_CAPABILITIES,
    highlightCapabilities: [
      "platform.ops.view",
      "platform.runtime.manage",
      "project.runtime.manage",
      "project.settings.manage",
    ],
    accent: "emerald",
    isSystemPreset: true,
  },
  governance_admin: {
    key: "governance_admin",
    label: "Governance Admin",
    description: "Proposal, moderation, and governance workflows without runtime or finance control.",
    scopeType: "platform",
    capabilities: GOVERNANCE_ADMIN_CAPABILITIES,
    highlightCapabilities: [
      "platform.governance.manage",
      "platform.projects.view",
      "project.view",
    ],
    accent: "sky",
    isSystemPreset: true,
  },
  finance_admin: {
    key: "finance_admin",
    label: "Finance Admin",
    description: "Budget and cost management across projects without access delegation.",
    scopeType: "platform",
    capabilities: FINANCE_ADMIN_CAPABILITIES,
    highlightCapabilities: [
      "platform.finance.manage",
      "project.budget.view",
      "project.budget.manage",
    ],
    accent: "violet",
    isSystemPreset: true,
  },
  registry_admin: {
    key: "registry_admin",
    label: "Registry Admin",
    description: "Tool and agent loop registry management without governance, finance, or access delegation.",
    scopeType: "platform",
    capabilities: REGISTRY_ADMIN_CAPABILITIES,
    highlightCapabilities: [
      "platform.ops.view",
      "platform.registry.manage",
      "platform.projects.view",
    ],
    accent: "sky",
    isSystemPreset: true,
  },
  project_curator: {
    key: "project_curator",
    label: "Arena Curator",
    description: "Arena-native project operations for personal/platform flows: runtime, direct spec edits, assets, settings, and secret setup without reveal or budget control.",
    scopeType: "project",
    capabilities: PROJECT_CURATOR_CAPABILITIES,
    highlightCapabilities: [
      "project.runtime.manage",
      "project.specs.write",
      "project.secrets.manage",
      "project.budget.view",
    ],
    accent: "emerald",
    isSystemPreset: true,
  },
  project_manager: {
    key: "project_manager",
    label: "Project Manager",
    description: "Telegram/group-admin style cockpit access with secret setup, without direct spec edits, runtime, access, delete, settings, assets, or budget control.",
    scopeType: "project",
    capabilities: PROJECT_MANAGER_CAPABILITIES,
    highlightCapabilities: [
      "project.view",
      "project.secrets.manage",
      "project.required_secrets.manage",
    ],
    accent: "sky",
    isSystemPreset: true,
  },
  project_viewer: {
    key: "project_viewer",
    label: "Project Viewer",
    description: "Read-only access to a specific project.",
    scopeType: "project",
    capabilities: PROJECT_VIEWER_CAPABILITIES,
    highlightCapabilities: ["project.view"],
    accent: "slate",
    isSystemPreset: true,
  },
};

export const ACCESS_PRESET_ORDER: AccessPresetKey[] = [
  "superadmin",
  "ops_admin",
  "governance_admin",
  "finance_admin",
  "registry_admin",
  "project_manager",
  "project_curator",
  "project_viewer",
];

export function getAccessPresetDefinition(
  key: AccessPresetKey,
): AccessPresetDefinition {
  return ACCESS_PRESET_DEFINITIONS[key];
}

export function listAccessPresetDefinitions(): AccessPresetDefinition[] {
  return ACCESS_PRESET_ORDER.map((key) => ACCESS_PRESET_DEFINITIONS[key]);
}

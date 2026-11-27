export const TG_SPEC_TARGET_RECIPE = "tg_spec_target" as const;
export const LEGACY_AGENT_PROJECT_RECIPE = "agent_project" as const;
export const TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED = "tg_spec_launch_configuration_required" as const;
export const TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED = "tg_spec_launch_configuration_configured" as const;
export const TG_SPEC_TARGET_AWAITING_FIRST_IMPORT_MESSAGE =
  "TG-Spec target is waiting for the first imported spec from Evolution";

function asSourceConfigRecord(sourceConfig: unknown): Record<string, unknown> | null {
  if (!sourceConfig || typeof sourceConfig !== "object" || Array.isArray(sourceConfig)) {
    return null;
  }

  return sourceConfig as Record<string, unknown>;
}

export function getSourceConfigRecipe(sourceConfig: unknown): string | null {
  const record = asSourceConfigRecord(sourceConfig);
  const recipe = record?.recipe;
  return typeof recipe === "string" && recipe.trim() ? recipe.trim() : null;
}

export function isTgSpecTargetSourceConfig(sourceConfig: unknown): boolean {
  return getSourceConfigRecipe(sourceConfig) === TG_SPEC_TARGET_RECIPE;
}

export function requiresTgSpecLaunchConfiguration(sourceConfig: unknown): boolean {
  const record = asSourceConfigRecord(sourceConfig);
  return record?.launchConfiguration === TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED;
}

export function getTgSpecLaunchConfigurationState(
  sourceConfig: unknown,
): typeof TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED | typeof TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED | null {
  const record = asSourceConfigRecord(sourceConfig);
  const state = record?.launchConfiguration;
  if (
    state === TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED
    || state === TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED
  ) {
    return state;
  }
  return null;
}

export function hasTgSpecLaunchConfigurationGate(sourceConfig: unknown): boolean {
  return getTgSpecLaunchConfigurationState(sourceConfig) !== null;
}

export function setTgSpecLaunchConfigurationState(
  sourceConfig: unknown,
  state: typeof TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED | typeof TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED,
): Record<string, unknown> {
  return {
    ...(asSourceConfigRecord(sourceConfig) ?? {}),
    recipe: TG_SPEC_TARGET_RECIPE,
    launchConfiguration: state,
  };
}

export function clearTgSpecLaunchConfigurationState(sourceConfig: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(asSourceConfigRecord(sourceConfig) ?? {}),
    recipe: TG_SPEC_TARGET_RECIPE,
  };
  delete next.launchConfiguration;
  return next;
}

export function hasLegacyAgentProjectRecipe(sourceConfig: unknown): boolean {
  return getSourceConfigRecipe(sourceConfig) === LEGACY_AGENT_PROJECT_RECIPE;
}

export function isAwaitingFirstTgSpecImport(
  sourceConfig: unknown,
  tgSpecLastImportedVersion: number | null | undefined,
): boolean {
  return isTgSpecTargetSourceConfig(sourceConfig) && tgSpecLastImportedVersion == null;
}

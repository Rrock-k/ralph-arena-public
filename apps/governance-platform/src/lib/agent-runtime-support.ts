export const ANTIGRAVITY_OPERATOR_ONLY_REASON =
  "Antigravity CLI uses platform-owned product auth and is only available for platform-operator launches until disposable project smoke is verified.";

export const ANTIGRAVITY_PLATFORM_CREDENTIALS_REASON =
  "Antigravity CLI uses authd-owned product keyring auth; select platform_credentials for controlled operator launches.";

export const ANTIGRAVITY_LOCAL_RALPH_REASON =
  "Antigravity CLI is currently supported only through the local Ralph runtime, where the authd keyring volume is mounted into the worker container.";

export function isAntigravityRuntimeAgent(agent: string | null | undefined): boolean {
  return agent === "antigravity";
}

export function isOpenCodeRuntimeAgent(agent: string | null | undefined): boolean {
  return agent === "opencode";
}

export function isToolVisibleForLaunch(
  agent: string | null | undefined,
  opts: { allowPlatformCredentials: boolean },
): boolean {
  return !isAntigravityRuntimeAgent(agent) || opts.allowPlatformCredentials;
}

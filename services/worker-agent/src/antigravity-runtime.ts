export const ANTIGRAVITY_AUTH_CONTAINER_HOME = "/arena-auth/antigravity-home";
export const ANTIGRAVITY_KEYRING_WRAPPER = "/usr/local/bin/arena-agy-with-keyring";

type RuntimeEnv = Record<string, string>;

interface HostConfigLike {
  Mounts?: unknown;
}

export function isAntigravityRuntime(env: RuntimeEnv): boolean {
  return env.ARENA_AGENT === "antigravity";
}

export function configureAntigravityRuntime(input: {
  env: RuntimeEnv;
  hostConfig: HostConfigLike;
  authVolumeName: string | null | undefined;
}): { configured: boolean; reason?: string } {
  if (!isAntigravityRuntime(input.env)) {
    return { configured: false };
  }

  const volume = input.authVolumeName?.trim();
  if (!volume) {
    throw new Error("Antigravity runtime requires AUTHD_ANTIGRAVITY_DOCKER_VOLUME to materialize authd-owned keyring state.");
  }

  input.env.ARENA_ANTIGRAVITY_HOME = ANTIGRAVITY_AUTH_CONTAINER_HOME;
  input.env.ARENA_ANTIGRAVITY_BIN = input.env.ARENA_ANTIGRAVITY_BIN || ANTIGRAVITY_KEYRING_WRAPPER;
  const currentMounts = Array.isArray(input.hostConfig.Mounts)
    ? input.hostConfig.Mounts
    : [];
  input.hostConfig.Mounts = [...currentMounts, {
    Type: "volume",
    Source: volume,
    Target: ANTIGRAVITY_AUTH_CONTAINER_HOME,
    ReadOnly: false,
  }];

  return { configured: true, reason: `mounted ${volume} at ${ANTIGRAVITY_AUTH_CONTAINER_HOME}` };
}

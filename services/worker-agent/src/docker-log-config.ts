export type DockerLogConfig = {
  Type: "json-file";
  Config: {
    "max-size": string;
    "max-file": string;
  };
};

const DEFAULT_DOCKER_LOG_MAX_SIZE = "10m";
const DEFAULT_DOCKER_LOG_MAX_FILE = "5";

export function buildPreviewContainerLogConfig(env: NodeJS.ProcessEnv = process.env): DockerLogConfig {
  return {
    Type: "json-file",
    Config: {
      "max-size": readDockerLogOption(env.ARENA_DOCKER_LOG_MAX_SIZE, DEFAULT_DOCKER_LOG_MAX_SIZE),
      "max-file": readDockerLogOption(env.ARENA_DOCKER_LOG_MAX_FILE, DEFAULT_DOCKER_LOG_MAX_FILE),
    },
  };
}

export function dockerLogConfigsMatch(existing: unknown, expected: unknown): boolean {
  const normalizedExisting = normalizeLogConfig(existing);
  const normalizedExpected = normalizeLogConfig(expected);
  if (!normalizedExisting || !normalizedExpected) {
    return normalizedExisting === normalizedExpected;
  }

  return (
    normalizedExisting.Type === normalizedExpected.Type &&
    normalizedExisting.Config["max-size"] === normalizedExpected.Config["max-size"] &&
    normalizedExisting.Config["max-file"] === normalizedExpected.Config["max-file"]
  );
}

function normalizeLogConfig(value: unknown): DockerLogConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const config = record.Config && typeof record.Config === "object"
    ? record.Config as Record<string, unknown>
    : {};
  const type = record.Type === "json-file" ? "json-file" : null;
  const maxSize = typeof config["max-size"] === "string" ? config["max-size"] : "";
  const maxFile = typeof config["max-file"] === "string" ? config["max-file"] : "";
  if (!type || !maxSize || !maxFile) return null;

  return {
    Type: type,
    Config: {
      "max-size": maxSize,
      "max-file": maxFile,
    },
  };
}

function readDockerLogOption(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

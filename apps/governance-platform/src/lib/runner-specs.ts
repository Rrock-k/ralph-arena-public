import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { parseAcceptedSpecArtifact } from "@arena/contracts";

export const RUNNER_SPEC_SELECT = {
  id: true,
  title: true,
  content: true,
  orderIndex: true,
  updatedAt: true,
  versions: {
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      message: true,
      createdAt: true,
      updatedAt: true,
      externalSourceSystem: true,
      externalSourceProjectId: true,
      externalSourceVersion: true,
      externalSourceUrl: true,
      externalAcceptedAt: true,
      externalMetadataHash: true,
      acceptedArtifact: true,
    },
  },
} satisfies Prisma.SpecSelect;

type RunnerSpecVersionSource = {
  id: string;
  version: number;
  message: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  externalSourceSystem?: string | null;
  externalSourceProjectId?: string | null;
  externalSourceVersion?: number | null;
  externalSourceUrl?: string | null;
  externalAcceptedAt?: Date | string | null;
  externalMetadataHash?: string | null;
  acceptedArtifact?: unknown;
};

type RunnerSpecSource = {
  id: string;
  title: string | null;
  content: string;
  orderIndex: number;
  updatedAt?: Date | string | null;
  versions?: RunnerSpecVersionSource[];
};

type RunnerAcceptedArtifactBacklogEntry = {
  currentVersion: {
    id: string;
    version: number;
    message: string | null;
    createdAt: string | null;
  };
  source?: {
    system: string;
    projectId: string;
    version: number;
    url?: string;
    acceptedAt?: string;
  };
  acceptedArtifact: unknown;
  metadataHash?: string;
};

export class RunnerSpecAcceptedArtifactMissingError extends Error {
  constructor(latestVersion: RunnerSpecVersionSource) {
    super(`Spec version ${latestVersion.id} has accepted external spec metadata but no acceptedArtifact`);
    this.name = "RunnerSpecAcceptedArtifactMissingError";
  }
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getSpecInputUpdatedAt(spec: RunnerSpecSource): Date | null {
  const specUpdatedAt = toValidDate(spec.updatedAt);
  const versionUpdatedAt = toValidDate(spec.versions?.[0]?.updatedAt);
  if (!specUpdatedAt) return versionUpdatedAt;
  if (!versionUpdatedAt) return specUpdatedAt;
  return versionUpdatedAt.getTime() > specUpdatedAt.getTime()
    ? versionUpdatedAt
    : specUpdatedAt;
}

function definedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      entry !== undefined
        && entry !== null
        && !(Array.isArray(entry) && entry.length === 0)
    )),
  ) as T;
}

function buildAcceptedArtifactForRunner(
  latestVersion: RunnerSpecVersionSource | null,
): unknown {
  if (!latestVersion) return undefined;
  if (!latestVersion.acceptedArtifact) {
    if (hasExternalAcceptedSpecMetadata(latestVersion)) {
      throw new RunnerSpecAcceptedArtifactMissingError(latestVersion);
    }
    return undefined;
  }
  return parseAcceptedSpecArtifact(latestVersion.acceptedArtifact);
}

function buildVersionMetadata(version: RunnerSpecVersionSource): RunnerAcceptedArtifactBacklogEntry["currentVersion"] {
  return {
    id: version.id,
    version: version.version,
    message: version.message,
    createdAt: toIsoString(version.createdAt),
  };
}

function buildSourceMetadata(version: RunnerSpecVersionSource): RunnerAcceptedArtifactBacklogEntry["source"] | undefined {
  if (!version.externalSourceSystem || !version.externalSourceProjectId || !version.externalSourceVersion) {
    return undefined;
  }

  return definedObject({
    system: version.externalSourceSystem,
    projectId: version.externalSourceProjectId,
    version: version.externalSourceVersion,
    url: version.externalSourceUrl ?? undefined,
    acceptedAt: toIsoString(version.externalAcceptedAt) ?? undefined,
  });
}

function artifactIdentityHash(version: RunnerSpecVersionSource, acceptedArtifact: unknown): string {
  return version.externalMetadataHash ?? `sha256:${createHash("sha256").update(stableJson(acceptedArtifact)).digest("hex")}`;
}

function buildAcceptedArtifactBacklogForRunner(
  versions: RunnerSpecVersionSource[],
): RunnerAcceptedArtifactBacklogEntry[] {
  const entries: RunnerAcceptedArtifactBacklogEntry[] = [];

  for (const version of versions) {
    const acceptedArtifact = buildAcceptedArtifactForRunner(version);
    if (!acceptedArtifact) continue;
    const source = buildSourceMetadata(version);
    entries.push({
      currentVersion: buildVersionMetadata(version),
      ...(source ? { source } : {}),
      acceptedArtifact,
      metadataHash: artifactIdentityHash(version, acceptedArtifact),
    });
  }

  return entries.sort(compareAcceptedArtifactBacklogEntries);
}

function compareAcceptedArtifactBacklogEntries(
  left: RunnerAcceptedArtifactBacklogEntry,
  right: RunnerAcceptedArtifactBacklogEntry,
): number {
  const leftSource = left.source?.version;
  const rightSource = right.source?.version;
  if (leftSource != null && rightSource != null && leftSource !== rightSource) {
    return leftSource - rightSource;
  }
  if (left.currentVersion.version !== right.currentVersion.version) {
    return left.currentVersion.version - right.currentVersion.version;
  }
  return (left.currentVersion.createdAt ?? "").localeCompare(right.currentVersion.createdAt ?? "");
}

function hasExternalAcceptedSpecMetadata(latestVersion: RunnerSpecVersionSource): boolean {
  return !!latestVersion.externalSourceSystem
    || !!latestVersion.externalSourceProjectId
    || latestVersion.externalSourceVersion != null
    || !!latestVersion.externalSourceUrl
    || !!latestVersion.externalAcceptedAt
    || !!latestVersion.externalMetadataHash;
}

export function buildRunnerSpecsPayload(specs: RunnerSpecSource[]) {
  const items = specs.map((spec) => {
    const latestVersion = spec.versions?.[0] ?? null;
    const contentHash = md5(spec.content);
    const metadataHash = latestVersion?.externalMetadataHash ?? null;
    const acceptedArtifactBacklog = buildAcceptedArtifactBacklogForRunner(spec.versions ?? []);
    const inputHashes = acceptedArtifactBacklog.map((entry) => entry.metadataHash).filter(Boolean);
    const inputHash = inputHashes.length > 0 ? md5([contentHash, ...inputHashes].join(":")) : undefined;
    const acceptedArtifact = acceptedArtifactBacklog[acceptedArtifactBacklog.length - 1]?.acceptedArtifact
      ?? buildAcceptedArtifactForRunner(latestVersion);
    const source = latestVersion ? buildSourceMetadata(latestVersion) : undefined;

    return definedObject({
      id: spec.id,
      slug: spec.title || `spec-${spec.orderIndex}`,
      content: spec.content,
      hash: contentHash,
      inputHash,
      currentVersion: latestVersion
        ? definedObject(buildVersionMetadata(latestVersion))
        : undefined,
      source,
      acceptedArtifact,
      acceptedArtifactBacklog,
      metadataHash: metadataHash ?? undefined,
    });
  });

  return {
    specs: items,
    hash: md5(items.map((spec) => spec.inputHash ?? spec.hash).join("")),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

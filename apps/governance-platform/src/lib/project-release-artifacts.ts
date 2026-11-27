import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getProjectAddon } from "@/lib/project-addons";
import {
  readProjectReleaseBytes,
  saveProjectReleaseBytes,
} from "@/lib/project-release-storage";

export const MAX_PROJECT_RELEASE_ARTIFACT_BYTES = 500 * 1024 * 1024;
export const PROJECT_RELEASE_PLATFORM_MACOS = "macos";
export const PROJECT_RELEASE_APP_KIND_ELECTRON = "electron";

const SAFE_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const MAC_ELECTRON_RELEASE_TAG_RE = /^mac-build\/petsik-v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?)$/;
const SAFE_COMMIT_SHA_RE = /^[a-f0-9]{7,64}$/i;
const ALLOWED_MAC_RELEASE_EXTENSIONS = new Set([".zip", ".dmg"]);

export type ProjectReleaseArtifactStatus = "building" | "build_failed" | "available";

export type ProjectReleaseArtifactRecord = {
  id: string;
  projectId: string;
  platform: string;
  appKind: string;
  status: string;
  version: string | null;
  tag: string | null;
  commitSha: string | null;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  storageKey: string | null;
  builderLabel: string | null;
  failureSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PublishProjectReleaseArtifactInput = {
  projectId: string;
  platform?: string | null;
  appKind?: string | null;
  status: ProjectReleaseArtifactStatus;
  version?: string | null;
  tag?: string | null;
  commitSha?: string | null;
  filename?: string | null;
  contentType?: string | null;
  buffer?: Buffer | null;
  sha256?: string | null;
  builderLabel?: string | null;
  failureSummary?: string | null;
};

export function normalizeProjectReleaseTag(value: string | null | undefined): string | null {
  const tag = value?.trim();
  if (!tag) return null;
  if (
    !SAFE_TAG_RE.test(tag)
    || tag.includes("//")
    || tag.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Invalid release artifact tag");
  }
  return tag;
}

export function normalizeProjectReleaseSha256(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/^sha256:/, "");
  if (!trimmed) return null;
  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    throw new Error("Invalid release artifact sha256");
  }
  return `sha256:${trimmed}`;
}

export function parseMacElectronReleaseTag(value: string | null | undefined): { tag: string; version: string } | null {
  const tag = normalizeProjectReleaseTag(value);
  if (!tag) return null;
  const match = tag.match(MAC_ELECTRON_RELEASE_TAG_RE);
  if (!match) {
    throw new Error("Invalid Mac Electron release artifact tag");
  }
  return { tag, version: match[1] };
}

export function sanitizeProjectReleaseFilename(filename: string): string {
  const leaf = filename.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "release.zip";
  const parsed = path.posix.parse(leaf);
  const ext = parsed.ext.toLowerCase();
  if (!ALLOWED_MAC_RELEASE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported release artifact extension: ${ext || "(none)"}`);
  }
  const safeBase = (parsed.name || "release")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "release";
  return `${safeBase}${ext}`;
}

export async function publishProjectReleaseArtifact(
  input: PublishProjectReleaseArtifactInput,
): Promise<ProjectReleaseArtifactRecord> {
  await assertProjectAllowsReleaseArtifacts(input.projectId);

  const status = input.status;
  const platform = normalizeShortToken(input.platform ?? PROJECT_RELEASE_PLATFORM_MACOS, "platform");
  const appKind = normalizeShortToken(input.appKind ?? PROJECT_RELEASE_APP_KIND_ELECTRON, "appKind");
  const parsedMacTag = parseMacElectronReleaseTag(input.tag);
  const tag = parsedMacTag?.tag ?? null;
  const commitSha = normalizeCommitSha(input.commitSha);
  const version = normalizeOptionalText(input.version, 80);
  const builderLabel = normalizeOptionalText(input.builderLabel, 120);
  const failureSummary = normalizeOptionalText(input.failureSummary, 1000);

  if (platform !== PROJECT_RELEASE_PLATFORM_MACOS) {
    throw new Error("Only macos release artifacts are supported");
  }
  if (appKind !== PROJECT_RELEASE_APP_KIND_ELECTRON) {
    throw new Error("Only electron release artifacts are supported");
  }

  const existingForTag = tag
    ? await findLatestProjectReleaseArtifactForTag(input.projectId, platform, tag)
    : null;
  if (
    existingForTag?.commitSha
    && commitSha
    && existingForTag.commitSha !== commitSha
  ) {
    throw new Error("Release artifact tag already points to a different commit SHA");
  }

  if (status !== "available") {
    if (input.buffer && input.buffer.byteLength > 0) {
      throw new Error("Only available release artifacts may include bytes");
    }
    return (prisma as any).projectReleaseArtifact.create({
      data: {
        id: randomUUID(),
        projectId: input.projectId,
        platform,
        appKind,
        status,
        version,
        tag,
        commitSha,
        builderLabel,
        failureSummary,
      },
    });
  }

  const buffer = input.buffer;
  if (!version || !tag || !commitSha) {
    throw new Error("Available release artifacts require version, tag and commit SHA");
  }
  if (!parsedMacTag || version !== parsedMacTag.version) {
    throw new Error("Release artifact version must match Mac build tag");
  }
  if (!buffer || buffer.byteLength <= 0) {
    throw new Error("Available release artifacts require file bytes");
  }
  if (buffer.byteLength > MAX_PROJECT_RELEASE_ARTIFACT_BYTES) {
    throw new Error(`Release artifact exceeds ${Math.round(MAX_PROJECT_RELEASE_ARTIFACT_BYTES / 1024 / 1024)}MB limit`);
  }

  const filename = sanitizeProjectReleaseFilename(input.filename ?? "");
  const computedSha256 = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  const expectedSha256 = normalizeProjectReleaseSha256(input.sha256);
  if (expectedSha256 && expectedSha256 !== computedSha256) {
    throw new Error("Release artifact sha256 mismatch");
  }
  if (existingForTag?.status === "available") {
    if (
      existingForTag.sha256 === computedSha256
      && existingForTag.sizeBytes === buffer.byteLength
      && existingForTag.filename === filename
    ) {
      return existingForTag;
    }
    throw new Error("Release artifact tag already has a different published artifact");
  }
  const contentType = normalizeContentType(input.contentType, filename);

  const id = randomUUID();
  const storageKey = await saveProjectReleaseBytes(id, filename, buffer);

  return (prisma as any).projectReleaseArtifact.create({
    data: {
      id,
      projectId: input.projectId,
      platform,
      appKind,
      status,
      version,
      tag,
      commitSha,
      filename,
      contentType,
      sizeBytes: buffer.byteLength,
      sha256: computedSha256,
      storageKey,
      builderLabel,
      failureSummary: null,
    },
  });
}

export async function listProjectReleaseArtifacts(
  projectId: string,
  options: {
    platform?: string;
    limit?: number;
  } = {},
): Promise<ProjectReleaseArtifactRecord[]> {
  return (prisma as any).projectReleaseArtifact.findMany({
    where: {
      projectId,
      platform: options.platform ?? PROJECT_RELEASE_PLATFORM_MACOS,
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(options.limit ?? 10, 50)),
  });
}

export async function getProjectReleaseArtifactForDownload(
  projectId: string,
  artifactId: string,
): Promise<ProjectReleaseArtifactRecord | null> {
  return (prisma as any).projectReleaseArtifact.findFirst({
    where: {
      id: artifactId,
      projectId,
      platform: PROJECT_RELEASE_PLATFORM_MACOS,
      status: "available",
      storageKey: { not: null },
    },
  });
}

export async function readProjectReleaseArtifactBytes(
  artifact: Pick<ProjectReleaseArtifactRecord, "storageKey">,
): Promise<Buffer> {
  if (!artifact.storageKey) {
    throw new Error("Release artifact has no stored bytes");
  }
  return readProjectReleaseBytes(artifact.storageKey);
}

async function assertProjectAllowsReleaseArtifacts(projectId: string): Promise<void> {
  const macAddon = getProjectAddon("mac_electron_app");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      specs: {
        select: {
          title: true,
          versions: {
            take: 1,
            select: { externalSourceSystem: true },
          },
        },
      },
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { sourceConfig: true },
      },
    },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const sourceConfig = objectConfig(project.components?.[0]?.sourceConfig);
  const configuredAddonIds = Array.isArray(sourceConfig.addonIds)
    ? sourceConfig.addonIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const hasConfiguredAddon = configuredAddonIds.includes(macAddon?.id ?? "mac_electron_app");
  const hasAcceptedAddonSpec = (project.specs ?? []).some((
    spec: { title: string | null; versions: { externalSourceSystem: string | null }[] },
  ) => (
    spec.title === macAddon?.specTitle
    && spec.versions.some((version: { externalSourceSystem: string | null }) => version.externalSourceSystem === "arena")
  ));
  if (!hasConfiguredAddon && !hasAcceptedAddonSpec) {
    throw new Error("Project is not allowlisted for Mac Electron release artifacts");
  }
}

async function findLatestProjectReleaseArtifactForTag(
  projectId: string,
  platform: string,
  tag: string,
): Promise<ProjectReleaseArtifactRecord | null> {
  return (prisma as any).projectReleaseArtifact.findFirst({
    where: { projectId, platform, tag },
    orderBy: { createdAt: "desc" },
  });
}

function normalizeShortToken(value: string, field: string): string {
  const token = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(token)) {
    throw new Error(`Invalid release artifact ${field}`);
  }
  return token;
}

function normalizeCommitSha(value: string | null | undefined): string | null {
  const commitSha = value?.trim();
  if (!commitSha) return null;
  if (!SAFE_COMMIT_SHA_RE.test(commitSha)) {
    throw new Error("Invalid release artifact commit SHA");
  }
  return commitSha;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeContentType(value: string | null | undefined, filename: string): string {
  const contentType = value?.trim().toLowerCase();
  const expected = filename.toLowerCase().endsWith(".dmg")
    ? "application/x-apple-diskimage"
    : "application/zip";
  if (!contentType) {
    return expected;
  }
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType)) {
    throw new Error("Invalid release artifact content type");
  }
  if (contentType !== expected) {
    throw new Error("Release artifact content type does not match filename");
  }
  return contentType;
}

function objectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

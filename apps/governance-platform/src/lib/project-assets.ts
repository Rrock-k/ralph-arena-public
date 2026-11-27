import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AssetItem, ProjectInteractionVisualEvidenceArtifactUnavailableReason } from "@arena/contracts";
import { prisma } from "@/lib/prisma";
import { deleteAssetBytes, readAssetBytes, saveAssetBytes } from "@/lib/asset-storage";

export const MAX_PROJECT_ASSET_BYTES = 30 * 1024 * 1024;
const PROOF_ASSET_PATH_PREFIX = "assets/proof/";
const VISUAL_EVIDENCE_ASSET_PATH_PREFIX = "assets/system/visual-evidence/";
export const ALLOWED_PROJECT_ASSET_EXTENSIONS = new Set([
  ".glb",
  ".gltf",
  ".obj",
  ".fbx",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".wav",
  ".mp3",
  ".ogg",
  ".ttf",
  ".woff",
  ".woff2",
]);

export type ProjectAssetRecord = {
  id: string;
  projectId: string;
  path: string;
  originalName: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  uploadedById: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CreateProjectAssetInput = {
  projectId: string;
  originalName: string;
  contentType?: string | null;
  buffer: Buffer;
  assetPath?: string | null;
  uploadedById?: string | null;
};

type NormalizeAssetPathOptions = {
  allowAnyExtension?: boolean;
};

type UpsertProjectAssetInput = CreateProjectAssetInput & {
  allowAnyExtension?: boolean;
};

type VisualEvidenceArtifactAssetLike = {
  id: string;
  path: string;
  contentType: string | null;
  sha256: string;
};

type VisualEvidenceArtifactResolution<T extends VisualEvidenceArtifactAssetLike> =
  | {
    availability: "available";
    asset: T;
    unavailableReason: null;
  }
  | {
    availability: "unavailable";
    asset: null;
    unavailableReason: ProjectInteractionVisualEvidenceArtifactUnavailableReason;
  };

export function sanitizeAssetFilename(originalName: string): string {
  const leaf = originalName.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "asset";
  const parsed = path.posix.parse(leaf);
  const ext = parsed.ext.toLowerCase();
  const base = sanitizeAssetPathSegment(parsed.name || "asset");
  return `${base}${ext}`;
}

export function normalizeAssetPath(
  inputPath: string | null | undefined,
  originalName: string,
  options: NormalizeAssetPathOptions = {},
): string {
  const rawPath = (inputPath?.trim() || sanitizeAssetFilename(originalName))
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const relativePath = rawPath.startsWith("assets/") ? rawPath.slice("assets/".length) : rawPath;
  const rawSegments = relativePath.split("/").filter(Boolean);

  if (rawSegments.length === 0) {
    throw new Error("Asset path is required");
  }

  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Asset path traversal is not allowed");
  }

  const segments = rawSegments.map((segment) => sanitizeAssetPathSegment(segment));
  const filename = segments[segments.length - 1];
  const ext = path.posix.extname(filename).toLowerCase();
  if (!options.allowAnyExtension && !ALLOWED_PROJECT_ASSET_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported asset file extension: ${ext || "(none)"}`);
  }

  return `assets/${segments.join("/")}`;
}

export function visualEvidenceAssetPathPrefixForReviewId(reviewId: string): string {
  const reviewSlug = reviewId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${VISUAL_EVIDENCE_ASSET_PATH_PREFIX}${reviewSlug || "review"}/`;
}

export function isVisualEvidenceArtifactAssetPath(assetPath: string): boolean {
  return assetPath.startsWith(VISUAL_EVIDENCE_ASSET_PATH_PREFIX);
}

export function isUserVisibleProjectAsset(asset: Pick<ProjectAssetRecord, "path">): boolean {
  return !asset.path.startsWith(PROOF_ASSET_PATH_PREFIX)
    && !isVisualEvidenceArtifactAssetPath(asset.path);
}

export function resolveVisualEvidenceArtifactAsset<T extends VisualEvidenceArtifactAssetLike>(input: {
  reviewId: string;
  expectedSha256: string | null;
  assets: T[];
}): VisualEvidenceArtifactResolution<T> {
  const expectedSha256 = normalizeVisualEvidenceSha256(input.expectedSha256);
  if (!expectedSha256) {
    return { availability: "unavailable", asset: null, unavailableReason: "missing_digest" };
  }

  const pathPrefix = visualEvidenceAssetPathPrefixForReviewId(input.reviewId);
  const candidates = input.assets.filter((asset) => asset.path.startsWith(pathPrefix));
  if (candidates.length === 0) {
    return { availability: "unavailable", asset: null, unavailableReason: "missing_artifact" };
  }

  const digestMatches = candidates.filter((asset) => normalizeProjectAssetSha256(asset.sha256) === expectedSha256);
  if (digestMatches.length === 0) {
    return { availability: "unavailable", asset: null, unavailableReason: "digest_mismatch" };
  }
  if (digestMatches.length > 1) {
    return { availability: "unavailable", asset: null, unavailableReason: "ambiguous_artifact" };
  }

  const [asset] = digestMatches;
  if (!asset.contentType || !/^image\/[a-z0-9.+-]+$/i.test(asset.contentType)) {
    return { availability: "unavailable", asset: null, unavailableReason: "non_image_artifact" };
  }

  return { availability: "available", asset, unavailableReason: null };
}

export async function listProjectAssets(projectId: string): Promise<ProjectAssetRecord[]> {
  return (prisma as any).projectAsset.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ path: "asc" }],
  });
}

export async function getProjectAssetManifest(projectId: string): Promise<{ assets: AssetItem[]; hash: string }> {
  const records = await listProjectAssets(projectId);
  const assets = records
    .filter((asset) => isUserVisibleProjectAsset(asset))
    .map((asset) => toAssetItem(asset));
  const hash = createHash("md5")
    .update(assets.map((asset) => `${asset.path}:${asset.sha256}`).join("\n"))
    .digest("hex");
  return { assets, hash };
}

function normalizeVisualEvidenceSha256(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^sha256:[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function normalizeProjectAssetSha256(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase().replace(/^sha256:/, "");
  return trimmed && /^[a-f0-9]{64}$/.test(trimmed) ? `sha256:${trimmed}` : null;
}

export async function createProjectAsset(input: CreateProjectAssetInput): Promise<ProjectAssetRecord> {
  if (input.buffer.byteLength <= 0) {
    throw new Error("Asset file is empty");
  }
  if (input.buffer.byteLength > MAX_PROJECT_ASSET_BYTES) {
    throw new Error(`Asset file exceeds ${Math.round(MAX_PROJECT_ASSET_BYTES / 1024 / 1024)}MB limit`);
  }

  const assetPath = normalizeAssetPath(input.assetPath, input.originalName);
  const filename = sanitizeAssetFilename(assetPath);
  const existing = await findActiveProjectAssetByPath(input.projectId, assetPath, {
    select: { id: true },
  });
  if (existing) {
    throw new Error(`Asset already exists at ${assetPath}`);
  }

  await assertProjectExists(input.projectId);

  const id = randomUUID();
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const storageKey = await saveAssetBytes(id, filename, input.buffer);

  try {
    return await (prisma as any).projectAsset.create({
      data: {
        id,
        projectId: input.projectId,
        path: assetPath,
        originalName: input.originalName,
        contentType: input.contentType || null,
        sizeBytes: input.buffer.byteLength,
        sha256,
        storageKey,
        uploadedById: input.uploadedById || null,
      },
    });
  } catch (error) {
    await deleteAssetBytes(storageKey).catch(() => {});
    throw error;
  }
}

export async function upsertProjectAsset(input: UpsertProjectAssetInput): Promise<ProjectAssetRecord> {
  if (input.buffer.byteLength <= 0) {
    throw new Error("Asset file is empty");
  }
  if (input.buffer.byteLength > MAX_PROJECT_ASSET_BYTES) {
    throw new Error(`Asset file exceeds ${Math.round(MAX_PROJECT_ASSET_BYTES / 1024 / 1024)}MB limit`);
  }

  const assetPath = normalizeAssetPath(input.assetPath, input.originalName, {
    allowAnyExtension: input.allowAnyExtension,
  });
  const filename = sanitizeAssetFilename(assetPath);
  await assertProjectExists(input.projectId);

  const existing = await findActiveProjectAssetByPath(input.projectId, assetPath);
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const nextContentType = input.contentType || null;
  const nextUploadedById = input.uploadedById ?? existing?.uploadedById ?? null;

  if (
    existing
    && existing.sha256 === sha256
    && existing.sizeBytes === input.buffer.byteLength
    && existing.originalName === input.originalName
    && existing.contentType === nextContentType
    && existing.uploadedById === nextUploadedById
  ) {
    return existing;
  }

  const assetId = existing?.id ?? randomUUID();
  const storageKey = await saveAssetBytes(assetId, filename, input.buffer);

  if (!existing) {
    try {
      return await (prisma as any).projectAsset.create({
        data: {
          id: assetId,
          projectId: input.projectId,
          path: assetPath,
          originalName: input.originalName,
          contentType: nextContentType,
          sizeBytes: input.buffer.byteLength,
          sha256,
          storageKey,
          uploadedById: nextUploadedById,
        },
      });
    } catch (error) {
      await deleteAssetBytes(storageKey).catch(() => {});
      throw error;
    }
  }

  return (prisma as any).projectAsset.update({
    where: { id: existing.id },
    data: {
      originalName: input.originalName,
      contentType: nextContentType,
      sizeBytes: input.buffer.byteLength,
      sha256,
      storageKey,
      uploadedById: nextUploadedById,
      deletedAt: null,
    },
  });
}

export async function getProjectAssetForDownload(projectId: string, assetId: string): Promise<ProjectAssetRecord | null> {
  return (prisma as any).projectAsset.findFirst({
    where: { id: assetId, projectId, deletedAt: null },
  });
}

export async function readProjectAssetBytes(asset: Pick<ProjectAssetRecord, "storageKey">): Promise<Buffer> {
  return readAssetBytes(asset.storageKey);
}

export async function deleteProjectAsset(projectId: string, assetId: string): Promise<ProjectAssetRecord> {
  const existing = await getProjectAssetForDownload(projectId, assetId);
  if (!existing) {
    throw new Error("Asset not found");
  }

  const deleted = await (prisma as any).projectAsset.update({
    where: { id: assetId },
    data: { deletedAt: new Date() },
  });
  await deleteAssetBytes(existing.storageKey).catch((error) => {
    console.warn("[project-assets] Failed to delete asset bytes:", error);
  });
  return deleted;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
}

async function findActiveProjectAssetByPath(projectId: string, assetPath: string, options: { select?: Record<string, boolean> } = {}) {
  return (prisma as any).projectAsset.findFirst({
    where: { projectId, path: assetPath, deletedAt: null },
    ...(options.select ? { select: options.select } : {}),
  });
}

function toAssetItem(asset: ProjectAssetRecord): AssetItem {
  return {
    id: asset.id,
    path: asset.path,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    contentType: asset.contentType,
  };
}

function sanitizeAssetPathSegment(segment: string): string {
  const ext = path.posix.extname(segment).toLowerCase();
  const name = ext ? segment.slice(0, -ext.length) : segment;
  const safeName = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "asset";
  return `${safeName}${ext}`;
}

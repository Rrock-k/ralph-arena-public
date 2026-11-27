"use server";

import { revalidatePath } from "next/cache";
import {
  createProjectAsset,
  deleteProjectAsset,
  listProjectAssets,
  type ProjectAssetRecord,
} from "@/lib/project-assets";
import { requireProjectCapability } from "@/lib/project-access";

export type ProjectAssetListItem = Pick<
  ProjectAssetRecord,
  "id" | "path" | "originalName" | "contentType" | "sizeBytes" | "sha256" | "uploadedById" | "createdAt" | "updatedAt"
>;

type AssetActionResult = {
  success: boolean;
  error?: string;
  assetId?: string;
};

export async function listProjectAssetsAction(projectId: string): Promise<ProjectAssetListItem[]> {
  const access = await requireProjectCapability(projectId, "project.assets.manage");
  if (!access.authorized) return [];

  return listProjectAssets(projectId);
}

export async function uploadProjectAsset(projectId: string, formData: FormData): Promise<AssetActionResult> {
  const access = await requireProjectCapability(projectId, "project.assets.manage");
  if (!access.authorized) return { success: false, error: access.error };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "File is required" };
  }

  const assetPath = formData.get("path");
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const asset = await createProjectAsset({
      projectId,
      originalName: file.name,
      contentType: file.type || null,
      buffer,
      assetPath: typeof assetPath === "string" ? assetPath : null,
      uploadedById: access.session?.user?.id ?? null,
    });

    await revalidateProjectAssetPages(projectId);
    return { success: true, assetId: asset.id };
  } catch (error) {
    console.error("[assets] upload failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to upload asset" };
  }
}

export async function deleteProjectAssetAction(projectId: string, assetId: string): Promise<AssetActionResult> {
  const access = await requireProjectCapability(projectId, "project.assets.manage");
  if (!access.authorized) return { success: false, error: access.error };

  try {
    await deleteProjectAsset(projectId, assetId);
    await revalidateProjectAssetPages(projectId);
    return { success: true };
  } catch (error) {
    console.error("[assets] delete failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to delete asset" };
  }
}

async function revalidateProjectAssetPages(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/my/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/my");
  revalidatePath("/admin");

}

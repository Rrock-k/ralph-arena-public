"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePlatformCapability } from "@/lib/platform-access";
import { runLoopCompliance, type ComplianceRecord } from "@/lib/loop-compliance";
import { normalizeLoopSupportTier, type LoopSupportTier } from "@/lib/loop-support";

async function requireAdmin() {
  const access = await requirePlatformCapability("platform.registry.manage");
  if (!access.authorized) return { error: access.error };
  return null;
}

// ── Tools ──────────────────────────────────────────────────

export async function createTool(data: {
  name: string;
  description: string | null;
  models: string; // JSON
  defaultModelId: string | null;
  isActive: boolean;
}) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    // Validate models JSON
    if (data.models) JSON.parse(data.models);

    await (prisma as any).tool.create({ data });
    revalidatePath("/admin");

    return { success: true };
  } catch (e: any) {
    console.error("createTool error:", e);
    return { success: false, error: e.message?.includes("Unique") ? "Name already exists" : "Failed to create tool" };
  }
}

export async function updateTool(id: string, data: {
  name: string;
  description: string | null;
  models: string;
  defaultModelId: string | null;
  isActive: boolean;
}) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    if (data.models) JSON.parse(data.models);
    await (prisma as any).tool.update({ where: { id }, data });
    revalidatePath("/admin");

    return { success: true };
  } catch (e: any) {
    console.error("updateTool error:", e);
    return { success: false, error: e.message?.includes("Unique") ? "Name already exists" : "Failed to update tool" };
  }
}

export async function deleteTool(id: string) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    // Check if any projects reference this tool
    const count = await (prisma as any).project.count({ where: { toolId: id } });
    if (count > 0) return { success: false, error: `Cannot delete: ${count} project(s) use this tool` };

    await (prisma as any).tool.delete({ where: { id } });
    revalidatePath("/admin");

    return { success: true };
  } catch (e: any) {
    console.error("deleteTool error:", e);
    return { success: false, error: "Failed to delete tool" };
  }
}

// ── Agent Loops ────────────────────────────────────────────

export async function createAgentLoop(data: {
  name: string;
  description: string | null;
  isActive: boolean;
  visibility: string;
  sourceUrl: string | null;
  installCommand: string | null;
  initialVersion?: {
    version: string;
    commandTemplate: string;
    capabilities: string[];
    supportTier: LoopSupportTier;
  };
}) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    const { initialVersion, ...loopData } = data;

    const loop = await (prisma as any).agentLoop.create({ data: loopData });

    if (initialVersion) {
      const versionResult = await createAgentLoopVersionInternal(loop.id, {
        version: initialVersion.version,
        commandTemplate: initialVersion.commandTemplate,
        capabilities: initialVersion.capabilities,
        supportTier: initialVersion.supportTier,
        changelog: null,
        setAsCurrent: true,
      });
      if (!versionResult.success) {
        return { success: false, error: versionResult.error ?? "Failed to create initial version", loopId: loop.id };
      }

      revalidatePath("/admin");
      const { success: _versionSuccess, ...versionPayload } = versionResult;
      return { success: true, loopId: loop.id, ...versionPayload };
    }

    revalidatePath("/admin");

    return { success: true, loopId: loop.id };
  } catch (e: any) {
    console.error("createAgentLoop error:", e);
    return { success: false, error: e.message?.includes("Unique") ? "Name already exists" : "Failed to create agent loop" };
  }
}

export async function updateAgentLoop(id: string, data: {
  name: string;
  description: string | null;
  isActive: boolean;
  visibility: string;
  sourceUrl: string | null;
  installCommand: string | null;
}) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    await (prisma as any).agentLoop.update({ where: { id }, data });
    revalidatePath("/admin");

    return { success: true };
  } catch (e: any) {
    console.error("updateAgentLoop error:", e);
    return { success: false, error: "Failed to update agent loop" };
  }
}

export async function deleteAgentLoop(id: string) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    const count = await (prisma as any).agentLoopVersion.count({
      where: { agentLoopId: id, projects: { some: {} } },
    });
    if (count > 0) return { success: false, error: "Cannot delete: versions are referenced by projects" };

    // Clear self-referencing FK, then delete versions, then the loop
    await (prisma as any).agentLoop.update({ where: { id }, data: { currentVersionId: null } });
    await (prisma as any).agentLoopVersion.deleteMany({ where: { agentLoopId: id } });
    await (prisma as any).agentLoop.delete({ where: { id } });
    revalidatePath("/admin");

    return { success: true };
  } catch (e: any) {
    console.error("deleteAgentLoop error:", e);
    return { success: false, error: "Failed to delete agent loop" };
  }
}

export async function createAgentLoopVersion(agentLoopId: string, data: {
  version: string;
  commandTemplate: string;
  capabilities: string[];
  supportTier: LoopSupportTier;
  changelog: string | null;
  setAsCurrent: boolean;
}) {
  const err = await requireAdmin();
  if (err) return { success: false, ...err };

  try {
    return await createAgentLoopVersionInternal(agentLoopId, data);
  } catch (e: any) {
    console.error("createAgentLoopVersion error:", e);
    return { success: false, error: e.message?.includes("Unique") ? "Version already exists" : "Failed to create version" };
  }
}

type ComplianceStatus = "pending" | "verified" | "failed";

function normalizeComplianceResult(record: ComplianceRecord, status: ComplianceStatus) {
  return {
    ...record,
    status,
    checkedAt: new Date().toISOString(),
  };
}

async function createAgentLoopVersionInternal(agentLoopId: string, data: {
  version: string;
  commandTemplate: string;
  capabilities: string[];
  supportTier: LoopSupportTier;
  changelog: string | null;
  setAsCurrent: boolean;
}) {
  const { setAsCurrent, ...versionData } = data;

  if (!versionData.version.trim()) {
    return { success: false, error: "Version is required" };
  }
  if (!versionData.commandTemplate.trim()) {
    return { success: false, error: "Command template is required" };
  }
  const supportTier = normalizeLoopSupportTier(versionData.supportTier);
  if (!supportTier) {
    return { success: false, error: "Support tier is required" };
  }

  const ver = await (prisma as any).agentLoopVersion.create({
    data: {
      agentLoopId,
      ...versionData,
      supportTier,
      complianceStatus: "pending",
      complianceResult: null,
      complianceCheckedAt: null,
    },
  });

  let complianceRecord: ComplianceRecord;
  try {
    complianceRecord = await runLoopCompliance(versionData.commandTemplate);
  } catch (e: any) {
    complianceRecord = {
      passed: false,
      checks: [
        {
          name: "runner-execution",
          passed: false,
          message: e?.message ?? String(e),
          severity: "error",
        },
      ],
      detectedCapabilities: [],
      runner: {
        command: versionData.commandTemplate,
        runnerRoot: "",
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        parseError: e?.message ?? String(e),
      },
    };
  }

  const complianceStatus: ComplianceStatus = complianceRecord.passed ? "verified" : "failed";
  const complianceResult = normalizeComplianceResult(complianceRecord, complianceStatus);

  await (prisma as any).agentLoopVersion.update({
    where: { id: ver.id },
    data: {
      complianceStatus,
      complianceResult,
      complianceCheckedAt: new Date(),
    },
  });

  if (complianceStatus === "verified" && setAsCurrent) {
    await (prisma as any).agentLoop.update({
      where: { id: agentLoopId },
      data: { currentVersionId: ver.id },
    });
  }

  revalidatePath("/admin");

  return {
    success: true,
    versionId: ver.id,
    complianceStatus,
    compliancePassed: complianceRecord.passed,
    complianceResult,
  };
}

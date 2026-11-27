"use server";

import { revalidatePath } from "next/cache";
import { listMaintenanceJobs, runMaintenanceItemNow } from "@/lib/maintenance-jobs";
import { requirePlatformCapability } from "@/lib/platform-access";

const RUNTIME_MANAGE_CAPABILITY = "platform.runtime.manage";

export async function getMaintenanceJobs() {
  const access = await requirePlatformCapability(RUNTIME_MANAGE_CAPABILITY);
  if (!access.authorized) {
    return { success: false, error: access.error, jobs: [] };
  }

  const jobs = await listMaintenanceJobs();
  return { success: true, jobs };
}

export async function runMaintenanceJobNow(key: string) {
  const access = await requirePlatformCapability(RUNTIME_MANAGE_CAPABILITY);
  if (!access.authorized) {
    return {
      success: false,
      error: access.error,
      runId: null,
      summary: null,
      status: null,
    };
  }

  const result = await runMaintenanceItemNow(key, {
    actorType: access.hasBypass ? "system" : "user",
    actorId: access.session?.user?.id ?? null,
    actorCapability: RUNTIME_MANAGE_CAPABILITY,
  });

  revalidatePath("/admin");
  return serializeMaintenanceActionResult(result);
}

function serializeMaintenanceActionResult(result: any) {
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Maintenance job failed",
      runId: result.run?.id ?? null,
      summary: result.run?.summary ?? null,
      status: result.run?.status ?? null,
    };
  }

  return {
    success: true,
    runId: result.run?.id ?? null,
    summary: result.run?.summary ?? null,
    status: result.run?.status ?? null,
  };
}

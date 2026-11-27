"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePlatformCapability } from "@/lib/platform-access";
import { runMaintenanceItemNow } from "@/lib/maintenance-jobs";

async function checkAdmin() {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (!access.authorized) {
    return { error: access.error };
  }
  return null;
}

export async function getCronJobs() {
  return prisma.cronJob.findMany({
    orderBy: { name: "asc" },
  });
}

export async function updateCronJob(
  id: string,
  data: { intervalMin?: number; enabled?: boolean; description?: string },
) {
  const err = await checkAdmin();
  if (err) return { success: false, ...err };

  await prisma.cronJob.update({
    where: { id },
    data,
  });

  revalidatePath("/admin");
  return { success: true };
}

export async function createCronJob(data: {
  name: string;
  endpoint: string;
  intervalMin: number;
  description?: string;
}) {
  const err = await checkAdmin();
  if (err) return { success: false, ...err };

  await prisma.cronJob.create({ data });

  revalidatePath("/admin");
  return { success: true };
}

export async function deleteCronJob(id: string) {
  const err = await checkAdmin();
  if (err) return { success: false, ...err };

  await prisma.cronJob.delete({ where: { id } });

  revalidatePath("/admin");
  return { success: true };
}

export async function runCronJobNow(id: string) {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (!access.authorized) return serializeRunNowResult({ success: false, error: access.error });

  const job = await prisma.cronJob.findUnique({ where: { id } });
  if (!job) return serializeRunNowResult({ success: false, error: "Job not found" });

  const result = await runMaintenanceItemNow(`cron:${job.name}`, {
    actorType: access.hasBypass ? "system" : "user",
    actorId: access.session?.user?.id ?? null,
    actorCapability: "platform.runtime.manage",
  });

  revalidatePath("/admin");
  return serializeRunNowResult(result);
}

function serializeRunNowResult(result: any) {
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Cron job failed",
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import {
  claimProjectUpdates,
  findActiveProjectUpdateDeliveryTarget,
  PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY,
  PROJECT_UPDATE_DELIVERY_TARGET_KIND,
  PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
  PROJECT_UPDATE_AUDIENCES,
  serializeProjectUpdate,
} from "@/lib/project-update-outbox";

const ClaimRequestSchema = z.object({
  audiences: z.array(z.enum(PROJECT_UPDATE_AUDIENCES)).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  consumerId: z.string().trim().min(1).max(120).optional(),
  targetId: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ClaimRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const requestedAudiences = parsed.data.audiences ?? ["project_contributors"];
  const wantsManagerAudience = requestedAudiences.includes("project_managers");
  if (requestedAudiences.includes("public_featured")) {
    return NextResponse.json({
      error: "Audience requires an Arena-owned delivery target contract",
    }, { status: 403 });
  }
  if (wantsManagerAudience && requestedAudiences.some((audience) => audience !== "project_managers")) {
    return NextResponse.json({
      error: "Manager delivery must be claimed separately",
    }, { status: 400 });
  }
  if (wantsManagerAudience) {
    const target = await findActiveProjectUpdateDeliveryTarget(prisma, {
      targetId: parsed.data.targetId,
      audience: "project_managers",
      requiredCapability: PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY,
      sourceSystem: PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
      targetKind: PROJECT_UPDATE_DELIVERY_TARGET_KIND,
    });
    if (!target) {
      return NextResponse.json({
        error: "Manager audience requires an active Arena-owned delivery target",
      }, { status: 403 });
    }
  }

  const updates = await claimProjectUpdates(prisma, {
    audiences: parsed.data.audiences,
    allowedAudiences: wantsManagerAudience ? ["project_managers"] : ["project_contributors"],
    limit: parsed.data.limit,
    consumerId: parsed.data.consumerId,
    targetId: parsed.data.targetId,
  });

  return NextResponse.json({
    updates: updates.map(serializeProjectUpdate),
  });
}

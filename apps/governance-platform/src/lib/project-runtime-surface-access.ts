import "server-only";

import type { AccessCapability } from "@/lib/access-control/types";
import { requireProjectCapability } from "@/lib/project-access";
import { requireTelegramWebAppProjectCapability } from "@/lib/telegram-webapp-project-access";

export async function requireProjectRuntimeSurfaceCapability(
  request: Request,
  projectId: string,
  capability: AccessCapability,
) {
  const surface = new URL(request.url).searchParams.get("surface") ?? "arena";
  if (surface === "arena") {
    return requireProjectCapability(projectId, capability);
  }
  if (surface === "telegram") {
    return requireTelegramWebAppProjectCapability(request, projectId, capability);
  }
  return {
    authorized: false as const,
    error: "Unsupported interaction surface",
    status: 400,
  };
}

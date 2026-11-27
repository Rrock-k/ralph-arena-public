import { NextResponse } from "next/server";
import { requireAnyPlatformCapability } from "@/lib/platform-access";
import { requireAnyProjectCapability } from "@/lib/project-access";
import {
  getProjectRunLogActivity,
  parseRunLogActivityLimit,
} from "@/lib/run-log-activity.server";

const PLATFORM_RUN_LOG_CAPABILITIES = [
  "platform.ops.view",
  "platform.projects.view",
  "platform.projects.manage",
  "platform.runtime.manage",
] as const;

const PROJECT_RUN_LOG_CAPABILITIES = [
  "project.view",
  "project.runtime.manage",
] as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await context.params;
  const access = await requireRunLogReadAccess(projectId);
  if (!access.authorized) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { searchParams } = new URL(request.url);
  const activity = await getProjectRunLogActivity(projectId, {
    windowLimit: parseRunLogActivityLimit(searchParams.get("limit")),
    maxGroups: parseRunLogActivityLimit(searchParams.get("groups")),
  });

  if (!activity) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ activity });
}

async function requireRunLogReadAccess(projectId: string): Promise<
  | { authorized: true }
  | { authorized: false; error: string; status: 401 | 403 | 404 }
> {
  const platformAccess = await requireAnyPlatformCapability([...PLATFORM_RUN_LOG_CAPABILITIES]);
  if (platformAccess.authorized) {
    return { authorized: true };
  }

  const projectAccess = await requireAnyProjectCapability(projectId, [...PROJECT_RUN_LOG_CAPABILITIES]);
  if (projectAccess.authorized) {
    return { authorized: true };
  }

  if (projectAccess.error === "Project not found") {
    return { authorized: false, error: projectAccess.error, status: 404 };
  }

  if (platformAccess.error === "Unauthorized" || projectAccess.error === "Unauthorized") {
    return { authorized: false, error: "Unauthorized", status: 401 };
  }

  return { authorized: false, error: "Project access denied", status: 403 };
}

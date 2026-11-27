import { NextResponse } from "next/server";
import { z } from "zod";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";
import { configureTgSpecProjectLaunch } from "@/lib/tg-spec-project-launch";

export const dynamic = "force-dynamic";

const ConfigureLaunchSchema = z.object({
  agent: z.string().trim().min(1),
  agentImpl: z.string().trim().min(1),
  model: z.string().trim().min(1).nullable().optional(),
  envOverrides: z.object({}).catchall(z.string().nullable()).nullable().optional(),
  claudeAuthMode: z.enum(["oauth", "api_key"]).nullable().optional(),
  codexAuthMode: z.enum(["subscription", "api_key"]).nullable().optional(),
  runnerBackend: z.enum(["local", "vps"]),
  toolId: z.string().trim().min(1).nullable().optional(),
  providerBillingMode: z.enum(["byok", "platform_credits", "platform_credentials"]),
  initialBudgetUsd: z.number().nullable().optional(),
  addonIds: z.array(z.enum(["telegram_mini_app", "mac_electron_app"])).optional(),
  visualEvidenceMode: z.enum(["off", "required", "new_tasks_only"]).optional(),
  visualWorkbenchEvidenceAutomation: z.boolean().optional(),
}).strict();

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const access = await requireProjectRuntimeSurfaceCapability(request, projectId, "project.runtime.manage");
  if (!access.authorized) {
    if ("status" in access && access.status === 400) {
      return NextResponse.json({ error: access.error }, { status: 400 });
    }
    return projectAccessJsonResponse(access.error);
  }
  if (!access.isOwner && !access.isAdmin) {
    return projectAccessJsonResponse("Project access denied");
  }

  let body: z.infer<typeof ConfigureLaunchSchema>;
  try {
    body = ConfigureLaunchSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 });
  }

  const platformAccess = await resolvePlatformAccess(access.session as any, access.hasBypass);
  const result = await configureTgSpecProjectLaunch(projectId, body, {
    actorUserId: access.session?.user?.id ?? null,
    privileged:
      platformAccess.hasCapability("platform.projects.manage")
      || platformAccess.hasCapability("platform.runtime.manage"),
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    projectId: result.projectId,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { setProjectRuntimeSystemInternal } from "@/app/actions/project-settings";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";

export const dynamic = "force-dynamic";

const SetProjectRuntimeSystemSchema = z.object({
  agent: z.string().trim().min(1),
  agentImpl: z.string().trim().min(1),
  model: z.string().trim().min(1).nullable().optional(),
  toolId: z.string().trim().min(1).nullable().optional(),
  providerBillingMode: z.enum(["byok", "platform_credits", "platform_credentials"]),
  claudeAuthMode: z.enum(["oauth", "api_key"]).nullable().optional(),
  codexAuthMode: z.enum(["subscription", "api_key"]).nullable().optional(),
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

  let body: z.infer<typeof SetProjectRuntimeSystemSchema>;
  try {
    body = SetProjectRuntimeSystemSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 });
  }

  if (body.providerBillingMode === "platform_credentials") {
    const platformAccess = await resolvePlatformAccess(access.session as any, access.hasBypass);
    if (
      !platformAccess.hasCapability("platform.projects.manage")
      && !platformAccess.hasCapability("platform.runtime.manage")
    ) {
      return projectAccessJsonResponse("Platform provider credentials require platform runtime access.");
    }
  }

  const result = await setProjectRuntimeSystemInternal(projectId, body, INTERNAL_ACTION_TOKEN);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    projectId: result.projectId,
    agent: result.agent,
    agentImpl: result.agentImpl,
    model: result.model,
    modelId: result.modelId,
    toolId: result.toolId,
    agentLoopVersionId: result.agentLoopVersionId,
    claudeAuthMode: result.claudeAuthMode,
    codexAuthMode: result.codexAuthMode,
    providerBillingMode: result.providerBillingMode,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createPersonalTgSpecProjectInternal } from "@/app/actions/projects";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { TELEGRAM_AUTH_PROVIDER_ID } from "@/lib/telegram-oidc-provider";
import { getProjectAddon } from "@/lib/project-addons";
import { mergeRequiredSecrets } from "@/lib/required-secrets";

export const dynamic = "force-dynamic";

const TgSpecCreateAddonIdSchema = z.enum(["telegram_mini_app", "mac_electron_app"]);

const CreateRequestSchema = z.object({
  sourceProjectId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  creatorTelegramUserId: z.string().trim().regex(/^\d+$/),
  creatorRole: z.enum(["curator", "chat_admin", "admin"]),
  sourceChatId: z.string().trim().min(1).optional(),
  sourceMessageThreadId: z.number().int().nullable().optional(),
  sourceTopicTitle: z.string().trim().min(1).optional(),
  sourceBotAdminCheckedAt: z.string().datetime().optional(),
  sourceActorAdminCheckedAt: z.string().datetime().optional(),
  addonIds: z.array(TgSpecCreateAddonIdSchema).optional(),
}).strict();

function requiredSecretsForAddonIds(addonIds: readonly z.infer<typeof TgSpecCreateAddonIdSchema>[] | undefined) {
  const requiredSecrets = (addonIds ?? []).flatMap((addonId) => getProjectAddon(addonId)?.requiredSecrets ?? []);
  return mergeRequiredSecrets([], requiredSecrets).list;
}

export async function POST(request: Request) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof CreateRequestSchema>;
  try {
    body = CreateRequestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 });
  }

  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: TELEGRAM_AUTH_PROVIDER_ID,
        providerAccountId: body.creatorTelegramUserId,
      },
    },
    select: {
      userId: true,
    },
  });
  if (!account?.userId) {
    return NextResponse.json(
      { error: "Telegram user is not linked to an Arena account" },
      { status: 403 },
    );
  }
  if (
    body.creatorRole === "chat_admin"
    && (!body.sourceChatId || !body.sourceBotAdminCheckedAt || !body.sourceActorAdminCheckedAt)
  ) {
    return NextResponse.json(
      { error: "chat_admin handoff requires verified Telegram chat and bot-admin evidence" },
      { status: 400 },
    );
  }

  const existingProject = await prisma.project.findUnique({
    where: { tgSpecSourceProjectId: body.sourceProjectId },
    select: {
      id: true,
      ownerScopeType: true,
      ownerScopeId: true,
    },
  });
  if (existingProject) {
    if (existingProject.ownerScopeType === "user" && existingProject.ownerScopeId === account.userId) {
      return NextResponse.json({
        ok: true,
        created: false,
        duplicate: true,
        projectId: existingProject.id,
        sourceProjectId: body.sourceProjectId,
      });
    }

    return NextResponse.json(
      { error: "tg-spec source project is already linked to another Arena owner" },
      { status: 409 },
    );
  }

  const result = await createPersonalTgSpecProjectInternal({
    name: body.title,
    agent: "codex",
    agentImpl: "direct",
    model: null,
    codexAuthMode: null,
    claudeAuthMode: null,
    runnerBackend: "local",
    providerBillingMode: "byok",
    addonIds: body.addonIds ?? null,
  }, {
    ownerScopeId: account.userId,
    tgSpecSourceProjectId: body.sourceProjectId,
    awaitingLaunchConfiguration: true,
    allowMissingAddonSecrets: true,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await prisma.runLog.create({
    data: {
      projectId: result.projectId,
      event: "TG_SPEC_CREATE_EVIDENCE",
      detail: JSON.stringify({
        sourceProjectId: body.sourceProjectId,
        creatorTelegramUserId: body.creatorTelegramUserId,
        creatorRole: body.creatorRole,
        sourceChatId: body.sourceChatId ?? null,
        sourceMessageThreadId: body.sourceMessageThreadId ?? null,
        sourceTopicTitle: body.sourceTopicTitle ?? null,
        sourceBotAdminCheckedAt: body.sourceBotAdminCheckedAt ?? null,
        sourceActorAdminCheckedAt: body.sourceActorAdminCheckedAt ?? null,
      }),
    },
  });

  const requiredSecrets = requiredSecretsForAddonIds(body.addonIds);
  const missingBlockingRequiredSecrets = requiredSecrets
    .filter((secret) => secret.blocking !== false)
    .map((secret) => secret.key);

  return NextResponse.json({
    ok: true,
    created: true,
    duplicate: false,
    projectId: result.projectId,
    sourceProjectId: body.sourceProjectId,
    requiresLaunchConfiguration: true,
    addonIds: body.addonIds ?? [],
    requiredSecrets,
    requiresSecretConfiguration: missingBlockingRequiredSecrets.length > 0,
    missingRequiredSecrets: missingBlockingRequiredSecrets,
  }, { status: 201 });
}

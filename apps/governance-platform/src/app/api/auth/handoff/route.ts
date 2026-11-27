import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { decryptSecret, getEncryptionKey } from "@/lib/crypto";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { createHandoffCode, exchangeHandoffCode } from "@/lib/handoff-tokens";
import { getAppComponent } from "@/lib/operator-display";
import { prisma } from "@/lib/prisma";
import { getPreferredPreviewUrl, isValidPreviewUrl } from "@/lib/preview-url";
import { resolveProjectAccess } from "@/lib/project-access";
import {
  TELEGRAM_WEBAPP_INIT_DATA_HEADER,
  resolveTelegramWebAppSessionFromInitData,
} from "@/lib/telegram-webapp-auth";
import { syncTgSpecProjectAccessForTelegramViewer } from "@/lib/tg-spec-project-access";

const PROJECT_TELEGRAM_BOT_SCOPE = "project";
const PROJECT_TELEGRAM_BOT_TOKEN_KEY = "TELEGRAM_BOT_TOKEN";

type HandoffProject = {
  id: string;
  mode: string;
  visibility: string | null;
  ownerScopeType: string | null;
  ownerScopeId: string | null;
  components?: Array<{
    kind: string | null;
    previewUrl: string | null;
    containerName: string | null;
  }>;
  vpsHost?: { previewDomain: string | null } | null;
  secrets?: Array<{
    key: string;
    encryptedValue: string;
    iv: string;
    authTag: string;
  }>;
};

type TelegramWebAppSessionResult = Awaited<ReturnType<typeof resolveTelegramWebAppSessionFromInitData>>;
type ProjectTelegramSessionCustomStatus =
  | "missing_project_bot"
  | "invalid_project_bot";
type ProjectTelegramSessionFailureStatus =
  | Exclude<TelegramWebAppSessionResult["status"], "ok">
  | ProjectTelegramSessionCustomStatus;
type ProjectTelegramSessionResult =
  | TelegramWebAppSessionResult
  | { status: ProjectTelegramSessionFailureStatus; telegramUserId?: string };

function wantsProjectTelegramBotScope(body: unknown): boolean {
  return Boolean(
    body
    && typeof body === "object"
    && (body as { telegramBotScope?: unknown }).telegramBotScope === PROJECT_TELEGRAM_BOT_SCOPE,
  );
}

function wantsPreviewRedirectUrl(body: unknown): boolean {
  return Boolean(
    body
    && typeof body === "object"
    && (body as { includePreviewRedirectUrl?: unknown }).includePreviewRedirectUrl === true,
  );
}

function readBodyProjectId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as { projectId?: unknown }).projectId;
  if (typeof value !== "string") return null;
  const projectId = value.trim();
  return projectId || null;
}

function readProjectTelegramBotId(project: HandoffProject): string | null | "invalid" {
  const secret = project.secrets?.find((entry) => entry.key === PROJECT_TELEGRAM_BOT_TOKEN_KEY);
  if (!secret) return null;

  let token = "";
  try {
    token = decryptSecret({
      ciphertext: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
    }, getEncryptionKey());
  } catch (error) {
    console.warn("Failed to decrypt project Telegram bot token for Mini App handoff", {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const trimmed = token.trim();
  const match = trimmed.match(/^(\d+):/);
  if (!match?.[1]) return "invalid";
  return match[1];
}

function buildPreviewRedirectUrl(input: {
  previewUrl: string;
  code: string;
}): string {
  const isRelative = input.previewUrl.startsWith("/");
  const target = new URL(input.previewUrl, isRelative ? "https://arena.local" : undefined);
  target.searchParams.set("arena_embed", "1");
  target.searchParams.set("arena_token", input.code);

  if (!isRelative) {
    return target.toString();
  }

  return `${target.pathname}${target.search}${target.hash}`;
}

function resolveProjectPreviewUrl(project: HandoffProject): string | null {
  const appComponent = getAppComponent(project);
  return getPreferredPreviewUrl({
    previewUrl: appComponent?.previewUrl ?? null,
    containerName: appComponent?.containerName ?? null,
    previewDomain: project.vpsHost?.previewDomain ?? process.env.PREVIEW_DOMAIN?.trim() ?? null,
  });
}

async function resolveProjectTelegramWebAppSession(
  project: HandoffProject,
  initData: string | null,
): Promise<ProjectTelegramSessionResult> {
  if (!initData?.trim()) {
    return { status: "missing_init_data" };
  }

  const projectBotId = readProjectTelegramBotId(project);
  if (!projectBotId) return { status: "missing_project_bot" };
  if (projectBotId === "invalid") return { status: "invalid_project_bot" };

  return resolveTelegramWebAppSessionFromInitData(initData, { botId: projectBotId });
}

async function syncTgSpecAccessIfPossible(input: {
  projectId: string;
  session: Session;
  telegramSession: ProjectTelegramSessionResult | null;
}) {
  if (input.telegramSession?.status !== "ok" || !input.session.user?.id) {
    return;
  }

  try {
    await syncTgSpecProjectAccessForTelegramViewer({
      projectId: input.projectId,
      arenaUserId: input.session.user.id,
      telegramUserId: input.telegramSession.telegramUserId,
    });
  } catch (error) {
    console.warn("Failed to sync tg-spec project access for Telegram preview handoff", {
      projectId: input.projectId,
      arenaUserId: input.session.user.id,
      telegramUserId: input.telegramSession.telegramUserId,
      error,
    });
  }
}

async function loadHandoffProject(projectId: string): Promise<HandoffProject | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
      visibility: true,
      ownerScopeType: true,
      ownerScopeId: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          previewUrl: true,
          containerName: true,
        },
      },
      vpsHost: { select: { previewDomain: true } },
      secrets: {
        where: { key: PROJECT_TELEGRAM_BOT_TOKEN_KEY },
        take: 1,
        select: {
          key: true,
          encryptedValue: true,
          iv: true,
          authTag: true,
        },
      },
    },
  });
}

/**
 * POST /api/auth/handoff — generate a one-time handoff code for a project.
 * Called by governance frontend before opening preview iframe.
 * Body: { projectId: string, includePreviewRedirectUrl?: boolean }
 * Returns: { code: string, redirectUrl?: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const projectId = readBodyProjectId(body);
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const useProjectTelegramBot = wantsProjectTelegramBotScope(body);
  const includePreviewRedirectUrl = wantsPreviewRedirectUrl(body);

  const [cookieSession, hasBypass] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
  ]);
  const telegramInitData = req.headers.get(TELEGRAM_WEBAPP_INIT_DATA_HEADER);
  if (!useProjectTelegramBot && !cookieSession?.user && !telegramInitData) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await loadHandoffProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const telegramSession = useProjectTelegramBot
    ? await resolveProjectTelegramWebAppSession(project, telegramInitData)
    : telegramInitData
      ? await resolveTelegramWebAppSessionFromInitData(telegramInitData)
      : null;
  const session = telegramSession?.status === "ok"
    ? telegramSession.session
    : useProjectTelegramBot
      ? null
      : cookieSession;

  if (useProjectTelegramBot && telegramSession?.status !== "ok") {
    return NextResponse.json({
      error: "Telegram WebApp handoff rejected",
      status: telegramSession?.status ?? "missing_init_data",
    }, { status: 401 });
  }
  if (
    useProjectTelegramBot
    && telegramSession?.status === "ok"
    && telegramSession.startParam
    && telegramSession.startParam !== projectId
  ) {
    return NextResponse.json({
      error: "Telegram WebApp handoff rejected",
      status: "start_param_project_mismatch",
    }, { status: 403 });
  }

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await syncTgSpecAccessIfPossible({
    projectId,
    session,
    telegramSession,
  });

  const access = await resolveProjectAccess(project, session, hasBypass);
  if (!access.canView) {
    return NextResponse.json({ error: "Project access denied" }, { status: 403 });
  }

  const previewUrl = includePreviewRedirectUrl ? resolveProjectPreviewUrl(project) : null;
  if (includePreviewRedirectUrl && (!previewUrl || !isValidPreviewUrl(previewUrl))) {
    return NextResponse.json({ error: "Preview not available" }, { status: 404 });
  }

  const code = createHandoffCode(projectId, session.user);
  return NextResponse.json({
    code,
    ...(previewUrl ? { redirectUrl: buildPreviewRedirectUrl({ previewUrl, code }) } : {}),
  });
}

/**
 * GET /api/auth/handoff?code=...&projectId=... — exchange code for user info.
 * Called by the app inside the container to verify the handoff token.
 * Returns: { userId, email }
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const projectId = req.nextUrl.searchParams.get("projectId");

  if (!code || !projectId) {
    return NextResponse.json({ error: "code and projectId are required" }, { status: 400 });
  }

  const user = exchangeHandoffCode(code, projectId);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }

  return NextResponse.json(user);
}

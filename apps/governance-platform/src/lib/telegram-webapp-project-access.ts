import "server-only";

import type { AccessCapability } from "@/lib/access-control/types";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/project-access";
import {
  TELEGRAM_WEBAPP_INIT_DATA_HEADER,
  resolveTelegramWebAppSessionFromInitData,
} from "@/lib/telegram-webapp-auth";
import { syncTgSpecProjectAccessForTelegramViewer } from "@/lib/tg-spec-project-access";

async function loadProjectAccessRecord(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
      visibility: true,
      ownerScopeType: true,
      ownerScopeId: true,
    },
  });
}

export async function requireTelegramWebAppProjectCapability(
  request: Request,
  projectId: string,
  capability: AccessCapability,
) {
  const [hasBypass, project] = await Promise.all([
    hasE2EAdminBypass(),
    loadProjectAccessRecord(projectId),
  ]);
  const initData = request.headers.get(TELEGRAM_WEBAPP_INIT_DATA_HEADER);
  const telegramSession = initData
    ? await resolveTelegramWebAppSessionFromInitData(initData)
    : null;
  const session = telegramSession?.status === "ok" ? telegramSession.session : null;

  if (
    project
    && telegramSession?.status === "ok"
    && session?.user?.id
  ) {
    try {
      await syncTgSpecProjectAccessForTelegramViewer({
        projectId,
        arenaUserId: session.user.id,
        telegramUserId: telegramSession.telegramUserId,
      });
    } catch (error) {
      console.warn("Failed to sync tg-spec project access for Telegram WebApp action", {
        projectId,
        arenaUserId: session.user.id,
        telegramUserId: telegramSession.telegramUserId,
        error,
      });
    }
  }

  const access = await resolveProjectAccess(project, session, hasBypass);

  if (!session?.user && !hasBypass) {
    return {
      authorized: false as const,
      error: "Unauthorized",
      session,
      hasBypass,
      project,
      ...access,
    };
  }

  if (!project) {
    return {
      authorized: false as const,
      error: "Project not found",
      session,
      hasBypass,
      project,
      ...access,
    };
  }

  if (!access.hasCapability(capability)) {
    return {
      authorized: false as const,
      error: "Project access denied",
      session,
      hasBypass,
      project,
      ...access,
    };
  }

  return {
    authorized: true as const,
    session,
    hasBypass,
    project,
    ...access,
  };
}

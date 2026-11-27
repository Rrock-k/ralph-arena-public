import type { Prisma, PrismaClient } from "@prisma/client";
import { decryptSecret, getEncryptionKey } from "@/lib/crypto";

type Db = PrismaClient | Prisma.TransactionClient;

const PROJECT_TELEGRAM_BOT_TOKEN_KEY = "TELEGRAM_BOT_TOKEN";

function safeBotUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9_]{5,32}$/.test(text) ? text : null;
}

function safeStartAppParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9_-]{1,512}$/.test(text) ? text : null;
}

function safeMiniAppShortName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9_]{1,64}$/.test(text) ? text : null;
}

function sourceConfigMiniAppShortName(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const direct = safeMiniAppShortName(record.telegramMiniAppShortName);
  if (direct) return direct;
  const telegramMiniApp = record.telegramMiniApp;
  if (telegramMiniApp && typeof telegramMiniApp === "object" && !Array.isArray(telegramMiniApp)) {
    return safeMiniAppShortName((telegramMiniApp as Record<string, unknown>).shortName);
  }
  return null;
}

function sourceConfigMainMiniAppConfigured(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.telegramMainMiniAppConfigured === true;
}

function isTelegramPreviewEntryForProject(value: unknown, projectId: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.pathname !== "/api/auth/telegram-preview-entry") return false;
    return url.searchParams.get("projectId") === projectId;
  } catch {
    return false;
  }
}

export function buildProjectTelegramMiniAppDirectUrl(input: {
  botUsername: string;
  miniAppShortName: string;
  projectId: string;
}): string | null {
  const botUsername = safeBotUsername(input.botUsername);
  const miniAppShortName = safeMiniAppShortName(input.miniAppShortName);
  const startApp = safeStartAppParam(input.projectId);
  if (!botUsername || !miniAppShortName || !startApp) return null;

  const url = new URL(`https://t.me/${botUsername}/${miniAppShortName}`);
  url.searchParams.set("startapp", startApp);
  return url.toString();
}

export function buildProjectTelegramMainMiniAppUrl(input: {
  botUsername: string;
  projectId: string;
}): string | null {
  const botUsername = safeBotUsername(input.botUsername);
  const startApp = safeStartAppParam(input.projectId);
  if (!botUsername || !startApp) return null;

  const url = new URL(`https://t.me/${botUsername}`);
  url.searchParams.set("startapp", startApp);
  return url.toString();
}

export async function resolveProjectTelegramMiniAppEntryUrl(
  db: Db,
  projectId: string,
): Promise<string | null> {
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        components: {
          where: { kind: "app" },
          select: { sourceConfig: true },
          take: 1,
        },
        secrets: {
          where: { key: PROJECT_TELEGRAM_BOT_TOKEN_KEY },
          select: {
            encryptedValue: true,
            iv: true,
            authTag: true,
          },
        },
      },
    });

    const secret = project?.secrets[0];
    if (!project || !secret) return null;
    const sourceConfig = project.components[0]?.sourceConfig;
    const miniAppShortName = sourceConfigMiniAppShortName(sourceConfig);
    const mainMiniAppConfigured = sourceConfigMainMiniAppConfigured(sourceConfig);
    if (!miniAppShortName && !mainMiniAppConfigured) return null;

    const token = decryptSecret({
      ciphertext: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
    }, getEncryptionKey());
    const apiBase = `https://api.telegram.org/bot${token}`;
    const [meResponse, menuResponse] = await Promise.all([
      fetch(`${apiBase}/getMe`),
      fetch(`${apiBase}/getChatMenuButton`),
    ]);
    const mePayload = await meResponse.json().catch(() => null) as {
      ok?: boolean;
      result?: { username?: unknown };
    } | null;
    const menuPayload = await menuResponse.json().catch(() => null) as {
      ok?: boolean;
      result?: {
        type?: unknown;
        web_app?: { url?: unknown };
      };
    } | null;

    if (!mePayload?.ok || !menuPayload?.ok) return null;
    if (menuPayload.result?.type !== "web_app") return null;
    if (!isTelegramPreviewEntryForProject(menuPayload.result.web_app?.url, project.id)) return null;

    const username = safeBotUsername(mePayload.result?.username);
    if (!username) return null;
    if (miniAppShortName) {
      return buildProjectTelegramMiniAppDirectUrl({
        botUsername: username,
        miniAppShortName,
        projectId: project.id,
      });
    }
    return buildProjectTelegramMainMiniAppUrl({
      botUsername: username,
      projectId: project.id,
    });
  } catch {
    return null;
  }
}

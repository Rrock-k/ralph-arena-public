import NextAuth from "next-auth";
import { headers } from "next/headers";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getToken } from "next-auth/jwt";
import { prisma } from "./prisma";
import { jwtCallback, sessionCallback } from "./auth-callbacks";
import {
  ensureBootstrapSuperadminGrantForEmail,
  ensureBootstrapSuperadminGrantForUser,
} from "./access-control/bootstrap";
import { shouldTelegramUserBeAdmin } from "./auth-utils";
import {
  TELEGRAM_AUTH_PROVIDER_ID,
  getTelegramOidcProvider,
  readTelegramOidcRawUserId,
  readTelegramOidcSubject,
} from "./telegram-oidc-provider";
import {
  reclaimEmptyProviderAccountForSignedInUser,
  syncLinkedProviderProfileForUser,
} from "./account-linking";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string | null;
      name?: string | null;
      image?: string | null;
      role: string;
    };
    expired?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    invalid?: boolean;
  }
}

const useSecureCookies = process.env.AUTH_URL?.startsWith("https://") ?? false;
const telegramProvider = getTelegramOidcProvider();

function readTokenUserId(token: unknown): string | null {
  if (!token || typeof token !== "object") return null;
  const record = token as { id?: unknown; sub?: unknown };
  if (typeof record.id === "string" && record.id.trim()) return record.id;
  if (typeof record.sub === "string" && record.sub.trim()) return record.sub;
  return null;
}

async function readCurrentSessionUserId(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  try {
    const requestHeaders = await headers();
    const cookie = requestHeaders.get("cookie");
    if (!cookie) return null;

    for (const secureCookie of [useSecureCookies, !useSecureCookies]) {
      const token = await getToken({
        req: { headers: new Headers({ cookie }) },
        secret,
        secureCookie,
      });
      const userId = readTokenUserId(token);
      if (userId) return userId;
    }
  } catch (error) {
    console.error("Failed to read current session for account linking", error);
  }

  return null;
}

async function ensureTelegramBootstrapGrantForExistingUser(
  userId: string | null | undefined,
  profile: unknown,
): Promise<void> {
  const telegramUserId = readTelegramOidcRawUserId(profile) ?? readTelegramOidcSubject(profile);
  if (!userId || !telegramUserId || !shouldTelegramUserBeAdmin(telegramUserId)) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return;

  await ensureBootstrapSuperadminGrantForUser(
    user.id,
    "Bootstrap superadmin grant from ADMIN_TELEGRAM_USER_IDS",
  );
}

async function ensureEmailBootstrapGrantForExistingUser(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) return;

  await ensureBootstrapSuperadminGrantForEmail(user.email);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/auth/signin",
  },
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    ...(telegramProvider ? [telegramProvider] : []),
  ],
  cookies: {
    pkceCodeVerifier: {
      name: "authjs.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      let effectiveUserId = user.id ?? null;
      let reclaimedForCurrentUser = false;

      if (account?.provider && account.providerAccountId) {
        const currentUserId = await readCurrentSessionUserId();
        if (currentUserId && user.id !== currentUserId) {
          try {
            reclaimedForCurrentUser = await reclaimEmptyProviderAccountForSignedInUser({
              currentUserId,
              account,
              profile,
            });
            if (reclaimedForCurrentUser) {
              effectiveUserId = currentUserId;
            }
          } catch (error) {
            console.error("Failed to reclaim empty provider account during sign-in", error);
          }
        }
      }

      if (account?.provider === TELEGRAM_AUTH_PROVIDER_ID) {
        try {
          await ensureTelegramBootstrapGrantForExistingUser(effectiveUserId, profile);
        } catch (error) {
          console.error("Failed to sync Telegram bootstrap access grant during sign-in", error);
        }
        return true;
      }

      if (reclaimedForCurrentUser) {
        try {
          await ensureEmailBootstrapGrantForExistingUser(effectiveUserId);
        } catch (error) {
          console.error("Failed to sync bootstrap access grant for reclaimed account", error);
        }
        return true;
      }

      if (!user.email) {
        return true;
      }

      try {
        await ensureBootstrapSuperadminGrantForEmail(user.email);
      } catch (error) {
        console.error("Failed to sync bootstrap access grant during sign-in", error);
      }

      return true;
    },
    async jwt({ token, user }) {
      return jwtCallback(token, user, prisma.user);
    },
    async session({ session, token }) {
      return sessionCallback(session, token);
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id || !user.email) {
        return;
      }

      try {
        await ensureBootstrapSuperadminGrantForEmail(user.email);
      } catch (error) {
        console.error("Failed to provision bootstrap access grant for created user", error);
      }
    },
    async linkAccount({ user, account, profile }) {
      if (!user.id) return;

      try {
        await syncLinkedProviderProfileForUser(user.id, account.provider, profile);
      } catch (error) {
        console.error("Failed to sync linked provider profile", error);
      }

      if (account.provider !== TELEGRAM_AUTH_PROVIDER_ID) {
        try {
          await ensureEmailBootstrapGrantForExistingUser(user.id);
        } catch (error) {
          console.error("Failed to provision bootstrap access grant for linked account", error);
        }
        return;
      }

      try {
        await ensureTelegramBootstrapGrantForExistingUser(user.id, profile);
      } catch (error) {
        console.error("Failed to provision Telegram bootstrap access grant for linked account", error);
      }
    },
  },
});

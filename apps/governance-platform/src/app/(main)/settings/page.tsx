import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserCreditBalance, getUserCreditLedgerHistory } from "@/app/actions/credits";
import { CREDIT_PLANS } from "@/lib/credit-plans";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { createHash } from "crypto";
import { listUserProviderCredentialStates } from "@/lib/user-provider-credentials";
import { isByokProviderKeysEnabled, isManagedProviderCreditsEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import { isTelegramOidcConfigured } from "@/lib/telegram-oidc-provider";
import { getFreemiusCheckoutMode } from "@/lib/freemius-checkout-mode";

export const dynamic = "force-dynamic";

interface SettingsProps {
  searchParams?: Promise<{ authError?: string; connected?: string }>;
}

function generateSandboxParams(): { ctx: string; token: string } | null {
  const secretKey = process.env.FREEMIUS_SECRET_KEY;
  const publicKey = process.env.FREEMIUS_PUBLIC_KEY;
  const productId = process.env.FREEMIUS_PRODUCT_ID || "27205";
  if (!secretKey || !publicKey) return null;

  const ctx = String(Date.now());
  const raw = ctx + productId + secretKey + publicKey + "checkout";
  const token = createHash("md5").update(raw).digest("hex");
  return { ctx, token };
}

function authNoticeFor(params: { authError?: string; connected?: string }) {
  if (params.connected === "telegram") {
    return { type: "success" as const, message: "Telegram is connected to your Arena account." };
  }

  if (params.connected === "telegram-webapp") {
    return { type: "success" as const, message: "Telegram Mini App is connected to your Arena account." };
  }

  if (params.connected === "google") {
    return { type: "success" as const, message: "Google is connected to your Arena account." };
  }

  if (params.authError === "TelegramOidcNotConfigured") {
    return { type: "error" as const, message: "Telegram login is not configured for Arena yet." };
  }

  if (params.authError === "OAuthAccountNotLinked") {
    return {
      type: "error" as const,
      message:
        "This login method is already linked to another non-empty Arena user. Sign in with that user or ask an admin to merge accounts.",
    };
  }

  if (params.authError === "TelegramWebAppLinkConflict") {
    return {
      type: "error" as const,
      message: "This Telegram Mini App account is already linked to another Arena user.",
    };
  }

  if (params.authError === "TelegramWebAppLinkInvalid") {
    return {
      type: "error" as const,
      message: "Telegram Mini App link expired. Open the Mini App again and retry.",
    };
  }

  if (params.authError) {
    return { type: "error" as const, message: "Login provider connection failed. Please try again." };
  }

  return null;
}

export default async function Settings({ searchParams }: SettingsProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [
    params,
    balance,
    history,
    providerCredentials,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    linkedAccounts,
  ] = await Promise.all([
    searchParams ?? Promise.resolve({}),
    getUserCreditBalance(session.user.id),
    getUserCreditLedgerHistory(session.user.id),
    listUserProviderCredentialStates(session.user.id),
    isByokProviderKeysEnabled(),
    isManagedProviderCreditsEnabled(),
    prisma.account.findMany({
      where: { userId: session.user.id },
      select: { provider: true },
    }),
  ]);

  const isSandbox = getFreemiusCheckoutMode() === "sandbox";
  const sandboxParams = isSandbox ? generateSandboxParams() : null;
  const linkedAuthProviders = Array.from(new Set(linkedAccounts.map((account) => account.provider)));

  return (
    <SettingsPage
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        linkedAuthProviders,
        telegramOidcEnabled: isTelegramOidcConfigured(),
      }}
      providerCredentials={{
        openai: {
          ...providerCredentials.openai,
          updatedAt: providerCredentials.openai.updatedAt?.toISOString() ?? null,
          validatedAt: providerCredentials.openai.validatedAt?.toISOString() ?? null,
        },
        anthropic: {
          ...providerCredentials.anthropic,
          updatedAt: providerCredentials.anthropic.updatedAt?.toISOString() ?? null,
          validatedAt: providerCredentials.anthropic.validatedAt?.toISOString() ?? null,
        },
        opencode: {
          ...providerCredentials.opencode,
          updatedAt: providerCredentials.opencode.updatedAt?.toISOString() ?? null,
          validatedAt: providerCredentials.opencode.validatedAt?.toISOString() ?? null,
        },
      }}
      userProviderCredentialsEnabled={userProviderCredentialsEnabled}
      managedProviderCreditsEnabled={managedProviderCreditsEnabled}
      authNotice={authNoticeFor(params)}
      credits={{
        userEmail: session.user.email ?? "",
        balance,
        plans: CREDIT_PLANS,
        sandbox: sandboxParams,
        history: history.map((entry) => ({
          ...entry,
          createdAt: entry.createdAt.toISOString(),
        })),
      }}
    />
  );
}

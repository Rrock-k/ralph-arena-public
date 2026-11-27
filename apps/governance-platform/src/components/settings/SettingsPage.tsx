"use client";

import { useEffect, useState } from "react";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { CreditsPage } from "@/components/credits/CreditsPage";
import {
  removeUserProviderCredential,
  saveUserProviderCredential,
} from "@/app/actions/provider-credentials";
import type { UserProviderId } from "@/lib/user-provider-credentials";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { signIn as signInWithProvider } from "next-auth/react";

type Plan = { credits: number; title: string; priceUsd: number };
type Purchase = {
  id: string;
  source: "purchase" | "admin" | "project_reserve" | "refund" | "adjustment";
  kind: string;
  label: string;
  creditsDelta: number;
  amountUsd: number | null;
  note: string | null;
  projectName: string | null;
  actorName: string | null;
  actorEmail: string | null;
  createdAt: string;
};
type ProviderCredentialState = {
  provider: UserProviderId;
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
  validationStatus: string | null;
  validatedAt: string | null;
};

interface SettingsPageProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    linkedAuthProviders: string[];
    telegramOidcEnabled: boolean;
  };
  providerCredentials: Record<UserProviderId, ProviderCredentialState>;
  userProviderCredentialsEnabled: boolean;
  managedProviderCreditsEnabled: boolean;
  authNotice?: { type: "success" | "error"; message: string } | null;
  credits: {
    userEmail: string;
    balance: number;
    plans: Record<string, Plan>;
    history: Purchase[];
    sandbox?: { ctx: string; token: string } | null;
  };
}

const TABS = ["profile", "api-keys", "notifications", "credits"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, string> = {
  profile: "Profile",
  "api-keys": "API Keys",
  notifications: "Notifications",
  credits: "Credits",
};

function isValidTab(value: string): value is TabId {
  return TABS.includes(value as TabId);
}

function isVisibleTab(
  id: TabId,
  opts: { userProviderCredentialsEnabled: boolean; managedProviderCreditsEnabled: boolean },
): boolean {
  if (!opts.userProviderCredentialsEnabled && id === "api-keys") return false;
  if (!opts.managedProviderCreditsEnabled && id === "credits") return false;
  return true;
}

export function SettingsPage({
  user,
  providerCredentials,
  userProviderCredentialsEnabled,
  managedProviderCreditsEnabled,
  authNotice,
  credits,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const visibleTabs: readonly TabId[] = TABS.filter((id) =>
    isVisibleTab(id, { userProviderCredentialsEnabled, managedProviderCreditsEnabled }));

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && isValidTab(hash) && isVisibleTab(hash, { userProviderCredentialsEnabled, managedProviderCreditsEnabled })) {
      setActiveTab(hash);
      return;
    }
    setActiveTab((current) => {
      if (isVisibleTab(current, { userProviderCredentialsEnabled, managedProviderCreditsEnabled })) return current;
      window.history.replaceState(null, "", "/settings#profile");
      return "profile";
    });
  }, [userProviderCredentialsEnabled, managedProviderCreditsEnabled]);

  useEffect(() => {
    if (!authNotice) return;
    if (authNotice.type === "success") {
      toast.success(authNotice.message);
    } else {
      toast.error(authNotice.message);
    }
    const hash = window.location.hash;
    window.history.replaceState(null, "", hash ? `/settings${hash}` : "/settings");
  }, [authNotice]);

  const switchTab = (id: TabId) => {
    if (!visibleTabs.includes(id)) return;
    setActiveTab(id);
    window.history.replaceState(null, "", `/settings#${id}`);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <h1 className="mb-8 text-2xl font-bold text-gray-900">Settings</h1>

      <div className="flex gap-10">
        {/* Vertical sidebar */}
        <nav className="hidden w-48 shrink-0 sm:block">
          <ul className="sticky top-24 space-y-1">
            {visibleTabs.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => switchTab(id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    activeTab === id
                      ? "bg-gray-100 font-semibold text-gray-900"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                >
                  {TAB_LABELS[id]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content — one tab at a time */}
        <div className="min-w-0 flex-1">
          {activeTab === "profile" && <ProfileTab user={user} />}
          {userProviderCredentialsEnabled && activeTab === "api-keys" && (
            <ProviderKeysTab credentials={providerCredentials} />
          )}
          {activeTab === "notifications" && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-gray-900">Notifications</h2>
              <p className="mb-4 text-sm text-gray-500">Choose which notifications you receive and how.</p>
              <NotificationSettings />
            </div>
          )}
          {managedProviderCreditsEnabled && activeTab === "credits" && (
            <CreditsPage
              userEmail={credits.userEmail}
              balance={credits.balance}
              plans={credits.plans}
              history={credits.history}
              sandbox={credits.sandbox}
              embedded
            />
          )}
        </div>
      </div>
    </div>
  );
}

const PROVIDER_ROWS: Array<{
  provider: UserProviderId;
  title: string;
  subtitle: string;
  placeholder: string;
}> = [
  {
    provider: "openai",
    title: "OpenAI",
    subtitle: "Codex launches",
    placeholder: "sk-...",
  },
  {
    provider: "anthropic",
    title: "Anthropic",
    subtitle: "Claude launches",
    placeholder: "sk-ant-...",
  },
  {
    provider: "opencode",
    title: "OpenCode Zen",
    subtitle: "Optional key for OpenCode launches",
    placeholder: "opencode-...",
  },
];

function ProviderKeysTab({
  credentials,
}: {
  credentials: Record<UserProviderId, ProviderCredentialState>;
}) {
  const [values, setValues] = useState<Record<UserProviderId, string>>({
    openai: "",
    anthropic: "",
    opencode: "",
  });
  const [pendingProvider, setPendingProvider] = useState<UserProviderId | null>(null);

  const saveKey = async (provider: UserProviderId) => {
    setPendingProvider(provider);
    try {
      const result = await saveUserProviderCredential(provider, values[provider]);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setValues((current) => ({ ...current, [provider]: "" }));
      toast.success(result.message);
    } finally {
      setPendingProvider(null);
    }
  };

  const removeKey = async (provider: UserProviderId) => {
    setPendingProvider(provider);
    try {
      const result = await removeUserProviderCredential(provider);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setValues((current) => ({ ...current, [provider]: "" }));
      toast.success(result.message);
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold text-gray-900">API Keys</h2>
      <div className="space-y-3">
        {PROVIDER_ROWS.map((row) => {
          const state = credentials[row.provider];
          const pending = pendingProvider === row.provider;
          const hasNewValue = values[row.provider].trim().length > 0;
          return (
            <div
              key={row.provider}
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {row.title}
                  </div>
                  <div className="text-sm text-gray-500">{row.subtitle}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      state.configured
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-gray-50 text-gray-500"
                    }`}
                  >
                    {state.configured ? `Configured ...${state.last4}` : "Not configured"}
                  </span>
                  {state.updatedAt && (
                    <span className="mono text-[11px] text-gray-400">
                      {new Date(state.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={values[row.provider]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [row.provider]: event.target.value,
                    }))
                  }
                  placeholder={row.placeholder}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  disabled={pending || !hasNewValue}
                  onClick={() => void saveKey(row.provider)}
                  className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {state.configured ? "Replace" : "Save"}
                </button>
                {state.configured && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void removeKey(row.provider)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProfileTab({
  user,
}: {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    linkedAuthProviders: string[];
    telegramOidcEnabled: boolean;
  };
}) {
  const googleConnected = user.linkedAuthProviders.includes("google");
  const telegramConnected = user.linkedAuthProviders.includes("telegram");
  const [googlePending, setGooglePending] = useState(false);
  const [telegramPending, setTelegramPending] = useState(false);

  const connectGoogle = async () => {
    setGooglePending(true);
    try {
      await signInWithProvider("google", {
        redirectTo: "/settings?connected=google#profile",
      });
    } catch {
      setGooglePending(false);
      toast.error("Google connection failed.");
    }
  };

  const connectTelegram = async () => {
    setTelegramPending(true);
    try {
      await signInWithProvider("telegram", {
        redirectTo: "/settings?connected=telegram#profile",
      });
    } catch {
      setTelegramPending(false);
      toast.error("Telegram connection failed.");
    }
  };

  return (
    <div>
      <h2 className="mb-4 text-lg font-bold text-gray-900">Profile</h2>
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-4">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name || "User"}
              className="h-14 w-14 rounded-full"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-lg font-semibold text-white">
              {user.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {user.name || "—"}
            </div>
            <div className="text-sm text-gray-500">{user.email ?? "Telegram account"}</div>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Profile is managed through your connected login provider.
        </p>
        <div className="mt-6 border-t border-gray-100 pt-5">
          <div className="mb-3 text-sm font-semibold text-gray-900">Login providers</div>
          <div className="divide-y divide-gray-100">
            <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">Google</div>
                <div className="text-xs text-gray-500">
                  {googleConnected ? "Connected to this account" : "Use Google as a sign-in method for this account"}
                </div>
              </div>
              {googleConnected ? (
                <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Connected
                </span>
              ) : (
                <button
                  type="button"
                  disabled={googlePending}
                  onClick={() => void connectGoogle()}
                  className="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70"
                >
                  <GoogleMark />
                  {googlePending ? "Connecting..." : "Connect Google"}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">Telegram</div>
                <div className="text-xs text-gray-500">
                  {telegramConnected
                    ? "Connected to this account"
                    : user.telegramOidcEnabled
                      ? "Use Telegram as a sign-in method for this account"
                      : "Telegram login is not configured"}
                </div>
              </div>
              {telegramConnected ? (
                <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Connected
                </span>
              ) : user.telegramOidcEnabled ? (
                <button
                  type="button"
                  disabled={telegramPending}
                  onClick={() => void connectTelegram()}
                  className="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-[#54a9eb] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4098dc] disabled:cursor-wait disabled:opacity-70"
                >
                  <Send className="h-4 w-4 fill-white stroke-white" aria-hidden="true" />
                  {telegramPending ? "Connecting..." : "Connect Telegram"}
                </button>
              ) : (
                <span className="w-fit rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-500">
                  Disabled
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

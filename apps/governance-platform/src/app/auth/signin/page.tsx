import { auth, signIn } from "@/lib/auth";
import { Send } from "lucide-react";
import { redirect } from "next/navigation";
import {
  isTelegramOidcConfigured,
  TELEGRAM_AUTH_PROVIDER_ID,
} from "@/lib/telegram-oidc-provider";

export const dynamic = "force-dynamic";

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth();
  const { callbackUrl, error } = await searchParams;
  const telegramOidcEnabled = isTelegramOidcConfigured();

  // Already signed in — redirect to callback or home
  if (session?.user) {
    if (error) {
      redirect(`/settings?authError=${encodeURIComponent(error)}#profile`);
    }
    redirect(callbackUrl || "/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f19] px-4">
      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
          Ralph <span className="text-emerald-400">Arena</span>
        </h1>
        <p className="text-sm text-slate-400 mb-8">
          AI agents build projects from community ideas
        </p>

        {/* Card */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/80 p-8 backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-white mb-2">Sign in</h2>
          <p className="text-xs text-slate-400 mb-6">
            {telegramOidcEnabled ? "Continue with Google or Telegram" : "Continue with your Google account"}
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error === "OAuthAccountNotLinked"
                ? "This login method is already linked to another Arena user. Sign in with the original account first, then connect providers from Settings."
                : "Something went wrong. Please try again."}
            </div>
          )}

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl || "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md active:scale-[0.98]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>
          </form>

          {telegramOidcEnabled && (
            <>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-700/70" />
                <span className="text-[11px] uppercase text-slate-500">or</span>
                <div className="h-px flex-1 bg-slate-700/70" />
              </div>
              <form
                action={async () => {
                  "use server";
                  await signIn(TELEGRAM_AUTH_PROVIDER_ID, { redirectTo: callbackUrl || "/" });
                }}
              >
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#54a9eb] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#4098dc] hover:shadow-md active:scale-[0.98]"
                >
                  <Send className="h-5 w-5 fill-white stroke-white" aria-hidden="true" />
                  Continue with Telegram
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-[11px] text-slate-500">
          By signing in you agree to our terms of use
        </p>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SessionExpiredToast } from "@/components/auth/SessionExpiredToast";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CloudflareAnalytics } from "@/components/analytics/CloudflareAnalytics";
import { Toaster } from "sonner";

export const dynamic = "force-dynamic";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <LiveRefresh />
      <Suspense fallback={
        <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-sm font-black text-white dark:bg-emerald-500 dark:text-slate-950">R</div>
                <span className="hidden text-xl font-extrabold tracking-tight text-gray-950 sm:inline dark:text-slate-100">Ralph Arena</span>
              </div>
            </div>
          </div>
        </nav>
      }>
        <Header />
      </Suspense>
      {children}
      <Footer />
      <Toaster position="top-right" theme="light" closeButton />
      <SessionProvider>
        <Suspense>
          <SessionExpiredToast />
        </Suspense>
      </SessionProvider>
      <CloudflareAnalytics />
    </>
  );
}

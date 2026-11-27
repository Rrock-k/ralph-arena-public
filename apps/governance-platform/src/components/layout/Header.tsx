import Link from "next/link";
import { auth } from "@/lib/auth";
import { SignInButton } from "../auth/SignInButton";
import { UserMenu } from "../auth/UserMenu";
import { NotificationBell } from "../notifications/NotificationBell";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { listManagedProjectsForUser } from "@/lib/access-control/server";
import { isManagedProviderCreditsEnabled } from "@/lib/feature-flags";

export async function Header() {
  const session = await auth();
  const platformAccess = await resolvePlatformAccess(session);
  const managedProjects = session?.user?.id
    ? await listManagedProjectsForUser(session.user.id)
    : [];
  const canOpenOps = platformAccess.canOpenOps || managedProjects.length > 0;
  const showCredits = await isManagedProviderCreditsEnabled();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/85 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-sm font-black text-white dark:bg-emerald-500 dark:text-slate-950">
              R
            </div>
            <span className="hidden text-xl font-extrabold tracking-tight text-gray-950 sm:inline dark:text-slate-100">Ralph Arena</span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            {session?.user && <NotificationBell />}
            {session?.user ? (
              <UserMenu user={session.user} canOpenOps={canOpenOps} showCredits={showCredits} />
            ) : (
              <SignInButton />
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

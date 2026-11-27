import { auth } from "@/lib/auth";
import { listManagedProjectsForUser } from "@/lib/access-control/server";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { redirect } from "next/navigation";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export async function ProtectedRoute({
  children,
  requireAdmin = false,
}: ProtectedRouteProps) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (requireAdmin) {
    const platformAccess = await resolvePlatformAccess(session);
    const managedProjects = session.user.id
      ? await listManagedProjectsForUser(session.user.id)
      : [];
    if (!platformAccess.canOpenOps && managedProjects.length === 0) {
      redirect("/");
    }
  }

  return <>{children}</>;
}

import "server-only";

import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { listManagedProjectsForUser } from "@/lib/access-control/server";

export async function resolveAdminOpsViewer() {
  const [session, hasBypass] = await Promise.all([auth(), hasE2EAdminBypass()]);
  const platformAccess = await resolvePlatformAccess(session, hasBypass);
  const managedProjects = session?.user?.id
    ? await listManagedProjectsForUser(session.user.id)
    : [];

  if (!session?.user && !hasBypass) {
    return { authorized: false as const, status: 401, error: "Unauthorized" };
  }

  const canAccessOpsShell = platformAccess.canOpenOps || managedProjects.length > 0;
  if (!canAccessOpsShell) {
    return { authorized: false as const, status: 403, error: "Platform access denied" };
  }

  return {
    authorized: true as const,
    session,
    hasBypass,
    visibleProjectIds: platformAccess.canOpenOps
      ? undefined
      : managedProjects.map((project) => project.id),
  };
}

import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { redirect } from "next/navigation";

export default async function AdminLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, hasBypass] = await Promise.all([auth(), hasE2EAdminBypass()]);
  const platformAccess = await resolvePlatformAccess(session, hasBypass);

  if (!platformAccess.canOpenOps) {
    redirect("/");
  }

  const params = await searchParams;
  const projectId = typeof params.project === "string" ? params.project : undefined;
  const target = projectId
    ? `/admin?tab=logs&project=${encodeURIComponent(projectId)}`
    : "/admin?tab=logs";

  redirect(target);
}

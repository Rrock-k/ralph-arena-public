import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { getRalphLoopMap } from "@/lib/ralph-loop-map";
import { getRalphPromptMap } from "@/lib/ralph-prompts";
import { getRalphPromptTraceMap } from "@/lib/ralph-prompt-traces";
import { PromptMapPage } from "@/components/admin/PromptMapPage";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminPromptMapPage() {
  const [session, hasBypass] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
  ]);
  const platformAccess = await resolvePlatformAccess(session, hasBypass);

  if (!session?.user && !hasBypass) {
    redirect("/");
  }

  if (!platformAccess.hasCapability("platform.registry.manage")) {
    redirect("/admin");
  }

  const [loopMap, promptMap, traceMap] = await Promise.all([
    Promise.resolve(getRalphLoopMap()),
    Promise.resolve(getRalphPromptMap()),
    getRalphPromptTraceMap(),
  ]);

  return <PromptMapPage loopMap={loopMap} promptMap={promptMap} traceMap={traceMap} />;
}

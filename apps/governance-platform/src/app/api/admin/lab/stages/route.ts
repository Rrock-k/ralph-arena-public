import { NextResponse } from "next/server";
import { getAdminLabStageCatalog } from "@/lib/admin-lab";
import { requirePlatformCapability } from "@/lib/platform-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requirePlatformCapability("platform.runtime.manage");
  if (!access.authorized) {
    return NextResponse.json({ error: access.error }, { status: 401 });
  }

  return NextResponse.json({
    schemaVersion: "ra-356.admin-lab-stage-catalog.v1",
    stages: getAdminLabStageCatalog(),
    notes: [
      "Admin Lab exposes stages by runSurface: admin_lab_run stages run in this UI, direct_cli stages are source-current CLI handoffs, target_shape stages are not runnable yet.",
      "UI-runnable stages must not mutate lifecycle, runtime intents, source, tasks, evidence, progress or Telegram delivery.",
      "direct_cli entries are not executed by this browser route; run them explicitly from the operator shell.",
    ],
  });
}

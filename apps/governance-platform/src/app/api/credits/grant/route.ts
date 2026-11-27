import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { grantCreditsInternal } from "@/app/actions/credits";
import { creditsForPlan } from "@/lib/credit-plans";
import { getFreemius } from "@/lib/freemius";
import { isManagedProviderCreditsEnabled } from "@/lib/feature-flags";
import { verifyFreemiusEntityEnvironment } from "@/lib/freemius-checkout-mode";

/**
 * POST /api/credits/grant
 *
 * Called from the client after Freemius checkout completes.
 * Verifies the license via Freemius API before granting credits.
 * This is a fallback path — the primary path is the webhook.
 */
export async function POST(req: NextRequest) {
  if (!(await isManagedProviderCreditsEnabled())) {
    return NextResponse.json({ error: "Credits are disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { planId, licenseId } = body as {
    planId?: string;
    licenseId?: string;
  };

  if (!planId || !licenseId) {
    return NextResponse.json(
      { error: "planId and licenseId required" },
      { status: 400 },
    );
  }

  const plan = creditsForPlan(planId);
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  // Verify license exists in Freemius before granting
  try {
    const fs = getFreemius();
    const license = await fs.api.license.retrieve(licenseId);

    if (!license || !license.id) {
      console.warn("[credits/grant] License not found in Freemius:", licenseId);
      return NextResponse.json(
        { error: "License not verified" },
        { status: 400 },
      );
    }

    const environmentCheck = verifyFreemiusEntityEnvironment(license);
    if (!environmentCheck.ok) {
      console.warn("[credits/grant] Environment mismatch:", {
        licenseId,
        environment: environmentCheck.environment,
        mode: environmentCheck.mode,
      });
      return NextResponse.json(
        { error: environmentCheck.error },
        { status: 403 },
      );
    }

    // Verify the license belongs to the correct plan
    if (String(license.plan_id) !== planId) {
      console.warn(
        "[credits/grant] Plan mismatch: license plan",
        license.plan_id,
        "!= requested",
        planId,
      );
      return NextResponse.json(
        { error: "Plan mismatch" },
        { status: 400 },
      );
    }

    // Verify the license belongs to the authenticated user
    if (license.user_id) {
      const fsUser = await fs.api.user.retrieve(String(license.user_id));
      if (!fsUser?.email || fsUser.email !== session.user.email) {
        console.warn(
          "[credits/grant] Ownership mismatch: license user",
          fsUser?.email,
          "!= session user",
          session.user.email,
        );
        return NextResponse.json(
          { error: "License does not belong to this account" },
          { status: 403 },
        );
      }
    }
  } catch (err) {
    console.error("[credits/grant] Freemius API verification failed:", err);
    return NextResponse.json(
      { error: "License verification failed" },
      { status: 502 },
    );
  }

  const result = await grantCreditsInternal(session.user.id, planId, licenseId);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, credits: result.credits });
}

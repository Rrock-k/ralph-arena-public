import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { grantCreditsInternal } from "@/app/actions/credits";
import { creditsForPlan } from "@/lib/credit-plans";
import { getFreemius } from "@/lib/freemius";
import { isManagedProviderCreditsEnabled } from "@/lib/feature-flags";
import {
  readFreemiusEntityEnvironment,
  verifyFreemiusEntityEnvironment,
} from "@/lib/freemius-checkout-mode";

/**
 * POST /api/webhooks/freemius
 *
 * Freemius webhook with HMAC-SHA256 signature verification via SDK.
 * Grants credits only for verified `license.created` events.
 */
export async function POST(request: Request) {
  if (!(await isManagedProviderCreditsEnabled())) {
    return NextResponse.json({ error: "Credits are disabled" }, { status: 404 });
  }

  let fs;
  try {
    fs = getFreemius();
  } catch {
    return NextResponse.json(
      { error: "Webhook handler not configured" },
      { status: 503 },
    );
  }

  let capturedLicense: any = null; // eslint-disable-line
  let capturedUser: any = null; // eslint-disable-line

  // Create a fresh listener per request to avoid shared state
  const listener = fs.webhook.createListener();

  listener.on("license.created", async ({ objects: { license, user } }) => {
    capturedLicense = license;
    capturedUser = user ?? null;
  });

  try {
    // SDK verifies x-signature header (HMAC-SHA256), parses event, calls handlers
    const sdkResponse = await fs.webhook.processFetch(listener, request);

    if (!sdkResponse.ok) {
      const text = await sdkResponse.text();
      console.error("[webhook/freemius] SDK rejected:", sdkResponse.status, text);
      return new NextResponse(text, { status: sdkResponse.status });
    }

    // If no license.created event — ack and skip
    if (!capturedLicense) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const license = capturedLicense;
    const planId = String(license.plan_id);
    const licenseId = String(license.id);

    const plan = creditsForPlan(planId);
    if (!plan) {
      console.error("[webhook/freemius] Unknown plan:", planId);
      return NextResponse.json({ ok: true, skipped: "unknown_plan" });
    }

    let licenseForEnvironment = license;
    if (!readFreemiusEntityEnvironment(licenseForEnvironment)) {
      try {
        licenseForEnvironment = await fs.api.license.retrieve(licenseId);
      } catch (err) {
        console.error("[webhook/freemius] Failed to fetch license environment:", err);
        return NextResponse.json({ error: "License environment not verified" }, { status: 502 });
      }
    }

    const environmentCheck = verifyFreemiusEntityEnvironment(licenseForEnvironment);
    if (!environmentCheck.ok) {
      console.warn("[webhook/freemius] Skipped environment mismatch:", {
        licenseId,
        environment: environmentCheck.environment,
        mode: environmentCheck.mode,
      });
      return NextResponse.json({
        ok: true,
        skipped: "environment_mismatch",
      });
    }

    // Get user email: from webhook user object, or fetch from Freemius API
    let userEmail: string | undefined = capturedUser?.email;

    if (!userEmail && license.user_id) {
      try {
        const fsUser = await fs.api.user.retrieve(String(license.user_id));
        userEmail = fsUser?.email;
      } catch (err) {
        console.error("[webhook/freemius] Failed to fetch user from API:", err);
      }
    }

    if (!userEmail) {
      console.error("[webhook/freemius] No user email for license:", licenseId);
      return NextResponse.json({ error: "No user email" }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!dbUser) {
      console.error("[webhook/freemius] User not found:", userEmail);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await grantCreditsInternal(dbUser.id, planId, licenseId);
    console.log(
      `[webhook/freemius] Granted: user=${userEmail} plan=${planId} license=${licenseId} credits=${result.credits}`,
    );

    return NextResponse.json({
      ok: true,
      granted: result.success,
      credits: result.credits,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("signature")) {
      console.error("[webhook/freemius] Signature verification failed:", message);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    console.error("[webhook/freemius] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

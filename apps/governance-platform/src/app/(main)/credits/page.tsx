import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserCreditBalance, getUserCreditLedgerHistory } from "@/app/actions/credits";
import { CREDIT_PLANS } from "@/lib/credit-plans";
import { CreditsPage } from "@/components/credits/CreditsPage";
import { createHash } from "crypto";
import { isManagedProviderCreditsEnabled } from "@/lib/feature-flags";
import { getFreemiusCheckoutMode } from "@/lib/freemius-checkout-mode";

export const dynamic = "force-dynamic";
export const metadata = { title: "Credits — Ralph Arena" };

function generateSandboxParams(): { ctx: string; token: string } | null {
  const secretKey = process.env.FREEMIUS_SECRET_KEY;
  const publicKey = process.env.FREEMIUS_PUBLIC_KEY;
  const productId = process.env.FREEMIUS_PRODUCT_ID || "27205";
  if (!secretKey || !publicKey) return null;

  const ctx = String(Date.now());
  const raw = ctx + productId + secretKey + publicKey + "checkout";
  const token = createHash("md5").update(raw).digest("hex");
  return { ctx, token };
}

export default async function CreditsRoute() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!(await isManagedProviderCreditsEnabled())) redirect("/settings#profile");

  const [balance, history] = await Promise.all([
    getUserCreditBalance(session.user.id),
    getUserCreditLedgerHistory(session.user.id),
  ]);

  const isSandbox = getFreemiusCheckoutMode() === "sandbox";
  const sandboxParams = isSandbox ? generateSandboxParams() : null;

  return (
    <CreditsPage
      userEmail={session.user.email ?? ""}
      balance={balance}
      plans={CREDIT_PLANS}
      sandbox={sandboxParams}
      history={history.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      }))}
    />
  );
}

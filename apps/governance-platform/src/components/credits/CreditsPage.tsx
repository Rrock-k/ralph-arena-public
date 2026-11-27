"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Checkout } from "@freemius/checkout";

type Plan = { credits: number; title: string; priceUsd: number };
type Purchase = {
  id: string;
  source: "purchase" | "admin" | "project_reserve" | "refund" | "adjustment";
  kind: string;
  label: string;
  creditsDelta: number;
  amountUsd: number | null;
  note: string | null;
  projectName: string | null;
  actorName: string | null;
  actorEmail: string | null;
  createdAt: string;
};

type SandboxParams = { ctx: string; token: string };

export function CreditsPage({
  userEmail,
  balance: initialBalance,
  plans,
  history: initialHistory,
  sandbox = null,
  embedded = false,
}: {
  userEmail: string;
  balance: number;
  plans: Record<string, Plan>;
  history: Purchase[];
  sandbox?: SandboxParams | null;
  embedded?: boolean;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [history, setHistory] = useState(initialHistory);
  const [buying, setBuying] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const router = useRouter();
  const checkoutRef = useRef<Checkout | null>(null);

  // Sync server props into client state after router.refresh()
  useEffect(() => setBalance(initialBalance), [initialBalance]);
  useEffect(() => setHistory(initialHistory), [initialHistory]);

  useEffect(() => {
    checkoutRef.current = new Checkout({
      product_id: "27205",
      public_key: "pk_1525fb9cf40e9fd53b17187d1863a",
      ...(sandbox ? { sandbox } : {}),
    });
    setSdkReady(true);

    return () => {
      checkoutRef.current?.close?.();
      checkoutRef.current = null;
    };
  }, [sandbox]);

  const grantCredits = useCallback(
    async (planId: string, licenseId: string) => {
      const plan = plans[planId];
      if (!plan) return false;

      try {
        const res = await fetch("/api/credits/grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, licenseId }),
        });
        const data = await res.json();

        if (data.success) {
          setBalance(data.credits);
          setHistory((prev) => [
            {
              id: crypto.randomUUID(),
              source: "purchase",
              kind: "FREEMIUS_PURCHASE",
              label: `${plan.title} purchase`,
              amountUsd: plan.priceUsd,
              creditsDelta: plan.credits,
              note: null,
              projectName: null,
              actorName: null,
              actorEmail: null,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
          toast.success(`+${plan.credits} credits added!`);
          router.refresh();
          return true;
        }
        if (data.error?.includes("Duplicate")) return true;
        toast.error(data.error || "Failed to grant credits");
      } catch {
        toast.error("Failed to process purchase.");
      }
      return false;
    },
    [plans, router],
  );

  const handleBuy = useCallback(
    (planId: string) => {
      const plan = plans[planId];
      if (!plan || buying) return;

      if (!checkoutRef.current) {
        toast.error("Checkout not ready. Please try again.");
        return;
      }

      setBuying(planId);

      checkoutRef.current.open({
        plan_id: Number(planId),
        licenses: 1,
        billing_cycle: "lifetime",
        user_email: userEmail,
        readonly_user: true,
        purchaseCompleted: async (response: any) => { // eslint-disable-line
          const licenseId = response?.purchase?.license_id
            ? String(response.purchase.license_id)
            : null;

          if (licenseId) {
            await grantCredits(planId, licenseId);
          } else {
            // Webhook will handle it — just show a pending message
            toast.info("Payment received! Credits will appear shortly.");
            // Poll for balance update
            setTimeout(() => router.refresh(), 3000);
            setTimeout(() => router.refresh(), 8000);
          }
          setBuying(null);
        },
        success: () => {
          setBuying(null);
        },
        cancel: () => {
          setBuying(null);
        },
      });
    },
    [plans, buying, userEmail, grantCredits, router],
  );

  const planEntries = Object.entries(plans);

  return (
    <div className={embedded ? "" : "mx-auto max-w-[1200px] px-4 py-10 sm:px-6"}>
      {/* Balance */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-slate-100">
          Credits
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Buy credits to run AI agent sessions that build your projects.
        </p>
        <div className="mt-4 inline-flex items-baseline gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-5 py-3">
          <span className="text-3xl font-bold text-emerald-400">
            {balance}
          </span>
          <span className="text-sm text-emerald-300/70">
            credits available
          </span>
        </div>
        {sandbox && (
          <p className="mt-2 text-xs text-amber-500">
            Sandbox mode — use test card 4242 4242 4242 4242
          </p>
        )}
      </div>

      {/* Plans */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {planEntries.map(([planId, plan]) => (
          <div
            key={planId}
            className="rounded-xl border border-gray-200 bg-white p-6 transition-colors hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
          >
            <h3 className="text-lg font-semibold text-gray-950 dark:text-slate-100">
              {plan.title}
            </h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-gray-950 dark:text-slate-100">
                ${plan.priceUsd}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              {plan.credits} credits
            </p>
            <button
              onClick={() => handleBuy(planId)}
              disabled={buying !== null || !sdkReady}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {buying === planId ? "Processing..." : "Buy"}
            </button>
          </div>
        ))}
      </div>

      {/* Credit History */}
      {history.length > 0 && (
        <div className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-gray-950 dark:text-slate-100">
            Credit History
          </h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-slate-400">Date</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-slate-400">Source</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-slate-400">Detail</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-slate-400">Payment</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-slate-400">Credits</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                    <td className="px-4 py-2 text-gray-600 dark:text-slate-300">{new Date(p.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-4 py-2 text-gray-900 dark:text-slate-100">{p.label}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-slate-300">
                      {p.projectName ?? p.note ?? p.actorName ?? p.actorEmail ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-slate-300">{p.amountUsd == null ? "-" : `$${p.amountUsd.toFixed(2)}`}</td>
                    <td className={`px-4 py-2 text-right font-medium ${p.creditsDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {p.creditsDelta >= 0 ? "+" : ""}{p.creditsDelta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

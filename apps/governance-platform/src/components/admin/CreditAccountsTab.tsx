"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Coins, Plus, RefreshCw, Search, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { adminGrantUserCredits } from "@/app/actions/admin-credits";

type CreditLedgerEntry = {
  id: string;
  source: "purchase" | "admin" | "project_reserve" | "refund" | "adjustment";
  kind: string;
  label: string;
  creditsDelta: number;
  amountUsd: number | null;
  note: string | null;
  createdAt: string;
  projectName: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

type CreditAccount = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  };
  balance: number;
  purchasedCredits: number;
  adminGrantedCredits: number;
  reservedCredits: number;
  lastActivityAt: string | null;
  ledger: CreditLedgerEntry[];
};

type CreditAccountsSnapshot = {
  checkoutMode: "live" | "sandbox";
  accounts: CreditAccount[];
};

function formatCredits(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function accountLabel(account: CreditAccount): string {
  return account.user.name ?? account.user.email ?? account.user.id;
}

function actorLabel(entry: CreditLedgerEntry): string | null {
  if (entry.actorName && entry.actorEmail) return `${entry.actorName} (${entry.actorEmail})`;
  return entry.actorName ?? entry.actorEmail ?? null;
}

function LedgerDetail({ entry }: { entry: CreditLedgerEntry }) {
  const actor = actorLabel(entry);
  if (!entry.projectName && !entry.note && !actor) {
    return <span>-</span>;
  }

  return (
    <div className="space-y-0.5">
      {entry.projectName && <div>{entry.projectName}</div>}
      {entry.note && <div>{entry.note}</div>}
      {actor && (
        <div className="text-xs text-gray-500 dark:text-slate-500">
          by {actor}
        </div>
      )}
    </div>
  );
}

export function CreditAccountsTab({
  snapshot,
  onReload,
}: {
  snapshot: CreditAccountsSnapshot;
  onReload?: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    snapshot.accounts[0]?.user.id ?? null,
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (selectedUserId && snapshot.accounts.some((account) => account.user.id === selectedUserId)) return;
    setSelectedUserId(snapshot.accounts[0]?.user.id ?? null);
  }, [selectedUserId, snapshot.accounts]);

  const filteredAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return snapshot.accounts;
    return snapshot.accounts.filter((account) => {
      const haystack = [
        account.user.id,
        account.user.name,
        account.user.email,
        account.user.role,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, snapshot.accounts]);

  const selectedAccount = snapshot.accounts.find((account) => account.user.id === selectedUserId) ?? filteredAccounts[0] ?? null;
  const totalBalance = snapshot.accounts.reduce((sum, account) => sum + account.balance, 0);
  const totalAdminGrants = snapshot.accounts.reduce((sum, account) => sum + account.adminGrantedCredits, 0);

  const submitGrant = () => {
    if (!selectedAccount) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a positive credit amount.");
      return;
    }
    if (!note.trim()) {
      toast.error("A note is required.");
      return;
    }

    startTransition(async () => {
      const result = await adminGrantUserCredits({
        userId: selectedAccount.user.id,
        amountUsd: parsedAmount,
        note,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Balance is now ${formatCredits(result.credits)} credits.`);
      setAmount("");
      setNote("");
      await onReload?.();
    });
  };

  return (
    <div className="min-h-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Account Credits
          </h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold ${
                snapshot.checkoutMode === "live"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              }`}
            >
              Freemius {snapshot.checkoutMode}
            </span>
            <span>{snapshot.accounts.length} accounts</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onReload?.()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Available" value={`${formatCredits(totalBalance)} credits`} />
        <Metric label="Admin grants" value={`${formatCredits(totalAdminGrants)} credits`} />
        <Metric label="Checkout mode" value={snapshot.checkoutMode} />
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[320px_1fr]">
        <section className="min-h-0 rounded-lg border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-gray-200 p-3 dark:border-slate-800">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search accounts"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>
          <div className="max-h-[640px] overflow-y-auto p-2">
            {filteredAccounts.map((account) => (
              <button
                key={account.user.id}
                type="button"
                onClick={() => setSelectedUserId(account.user.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                  selectedAccount?.user.id === account.user.id
                    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100"
                    : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <UserCircle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{accountLabel(account)}</span>
                  <span className="block truncate text-xs text-gray-500 dark:text-slate-500">
                    {account.user.email ?? account.user.id}
                  </span>
                </span>
                <span className="text-xs font-semibold">{formatCredits(account.balance)}</span>
              </button>
            ))}
            {filteredAccounts.length === 0 && (
              <div className="p-4 text-sm text-gray-500 dark:text-slate-400">No accounts found.</div>
            )}
          </div>
        </section>

        <section className="min-h-0 rounded-lg border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {selectedAccount ? (
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-gray-200 p-4 dark:border-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {accountLabel(selectedAccount)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                      {selectedAccount.user.email ?? selectedAccount.user.id}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <Coins className="h-4 w-4" />
                    <span className="text-sm font-bold">{formatCredits(selectedAccount.balance)} credits</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-b border-gray-200 p-4 lg:grid-cols-[1fr_280px] dark:border-slate-800">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Purchased" value={formatCredits(selectedAccount.purchasedCredits)} />
                  <Metric label="Admin granted" value={formatCredits(selectedAccount.adminGrantedCredits)} />
                  <Metric label="Reserved" value={formatCredits(selectedAccount.reservedCredits)} />
                </div>
                <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
                  <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-slate-500">
                    Admin top-up
                  </label>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="25.00"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Audit note"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={submitGrant}
                    disabled={isPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    {isPending ? "Saving" : "Add credits"}
                  </button>
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto p-4">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-gray-500 dark:text-slate-500">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Date</th>
                      <th className="px-2 py-2 font-semibold">Source</th>
                      <th className="px-2 py-2 font-semibold">Detail</th>
                      <th className="px-2 py-2 text-right font-semibold">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAccount.ledger.map((entry) => (
                      <tr key={entry.id} className="border-t border-gray-100 dark:border-slate-800">
                        <td className="px-2 py-2 text-gray-600 dark:text-slate-300">{formatDate(entry.createdAt)}</td>
                        <td className="px-2 py-2 font-medium text-gray-900 dark:text-slate-100">{entry.label}</td>
                        <td className="px-2 py-2 text-gray-600 dark:text-slate-300">
                          <LedgerDetail entry={entry} />
                        </td>
                        <td className={`px-2 py-2 text-right font-semibold ${entry.creditsDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                          {entry.creditsDelta >= 0 ? "+" : ""}{formatCredits(entry.creditsDelta)}
                        </td>
                      </tr>
                    ))}
                    {selectedAccount.ledger.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
                          No credit history.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-8 text-sm text-gray-500 dark:text-slate-400">No account selected.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-semibold uppercase text-gray-400 dark:text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-gray-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

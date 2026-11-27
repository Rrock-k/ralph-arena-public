"use client";

import { useState } from "react";
import { toast } from "sonner";
import { adjustProjectBudget } from "@/app/actions/budget";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface AddCreditsButtonProps {
  projectId: string;
  /** When provided, the component renders only the dialog (no trigger button). */
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  allowDebit?: boolean;
}

export function AddCreditsButton({
  projectId,
  externalOpen,
  onExternalOpenChange,
  allowDebit = false,
}: AddCreditsButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "debit">("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isControlled = externalOpen !== undefined;
  const isOpen = isControlled ? externalOpen : internalOpen;
  const setIsOpen = isControlled ? (onExternalOpenChange ?? (() => {})) : setInternalOpen;

  const handleSubmit = async () => {
    const baseAmountUsd = parseFloat(amount);
    if (isNaN(baseAmountUsd) || baseAmountUsd <= 0) {
      toast.error("Enter a valid positive amount");
      return;
    }
    const effectiveMode = allowDebit ? mode : "add";
    if (effectiveMode === "debit" && !note.trim()) {
      toast.error("Note is required for debit");
      return;
    }

    const amountUsd = effectiveMode === "debit" ? -baseAmountUsd : baseAmountUsd;

    setIsSubmitting(true);
    const result = await adjustProjectBudget(projectId, amountUsd, note || undefined);

    if (result.success) {
      const action = effectiveMode === "debit" ? "Debited" : "Added";
      toast.success(`${action} $${baseAmountUsd.toFixed(2)} (${(result.remainingUsd ?? 0).toFixed(2)} remaining)`);
      setIsOpen(false);
      setMode("add");
      setAmount("");
      setNote("");
    } else {
      toast.error(result.error || "Failed to adjust budget");
    }
    setIsSubmitting(false);
  };

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setIsOpen(true)}
          className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-all hover:bg-violet-100 hover:border-violet-400"
        >
          Add Credits
        </button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-sm border-gray-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Add credits</DialogTitle>
            <DialogDescription className="text-gray-600">
              {allowDebit
                ? "Add or debit internal credits for this project's budget."
                : "Add credits to this project's budget."}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            {allowDebit && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Operation
                </label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("add")}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      mode === "add"
                        ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                        : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                    }`}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("debit")}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      mode === "debit"
                        ? "border-rose-400 bg-rose-50 text-rose-700"
                        : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                    }`}
                  >
                    Debit
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Amount (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10.00"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Note {mode === "debit" ? "(required)" : "(optional)"}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Initial budget allocation"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-70 ${
                mode === "debit"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-violet-600 hover:bg-violet-700"
              }`}
              onClick={handleSubmit}
              disabled={isSubmitting || !amount}
            >
              {isSubmitting ? "Saving..." : mode === "debit" ? "Debit Budget" : "Add Credits"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
  successMessage?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  successMessage = "Deleted successfully",
}: DeleteConfirmDialogProps) {
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result.success) {
        toast.success(successMessage);
        onOpenChange(false);
      } else {
        toast.error(result.error || "Delete failed");
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

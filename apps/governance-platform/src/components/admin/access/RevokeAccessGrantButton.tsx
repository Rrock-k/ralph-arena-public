"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  revokeAccessGrant,
  revokeProjectAccessGrant,
} from "@/app/actions/access";

interface RevokeAccessGrantButtonProps {
  grantId: string;
  compact?: boolean;
  projectScopedProjectId?: string;
}

export function RevokeAccessGrantButton({
  grantId,
  compact = false,
  projectScopedProjectId,
}: RevokeAccessGrantButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          const result = projectScopedProjectId
            ? await revokeProjectAccessGrant(projectScopedProjectId, grantId)
            : await revokeAccessGrant(grantId);
          if (!result.success) {
            toast.error(result.error);
            return;
          }

          toast.success("Access revoked");
          router.refresh();
        });
      }}
      disabled={isPending}
      className={compact
        ? "text-[10px] font-medium text-rose-500 transition-colors hover:text-rose-600 disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"
        : "text-[11px] font-medium text-rose-500 transition-colors hover:text-rose-600 disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"}
    >
      {isPending ? "Revoking..." : "Revoke"}
    </button>
  );
}

"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const TOAST_ID = "session-expired";

function showExpiredToast() {
  toast.error("Session expired", {
    id: TOAST_ID,
    description: "Your session is no longer valid. Please sign in again.",
    closeButton: true,
    duration: 8000,
  });
}

/**
 * Handles two cases of stale session:
 * 1. Query param ?session=expired (from VoteButton signOut redirect)
 * 2. Server marks session.expired=true (user missing from DB) → auto sign-out
 *
 * Placed inside (main)/layout.tsx wrapped in <Suspense>.
 */
export function SessionExpiredToast() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const fired = useRef(false);

  // Case 1: arrived at ?session=expired after signOut redirect
  useEffect(() => {
    if (searchParams.get("session") === "expired" && !fired.current) {
      fired.current = true;
      showExpiredToast();

      // Clean up URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete("session");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [searchParams, pathname]);

  // Case 2: server flagged session as expired (token.invalid → session.expired)
  useEffect(() => {
    if (status === "authenticated" && (session as any)?.expired && !fired.current) {
      fired.current = true;
      signOut({ callbackUrl: "/?session=expired" });
    }
  }, [session, status]);

  return null;
}

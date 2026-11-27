"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * RA-033: Subscribes to global SSE stream and calls router.refresh()
 * when server signals that data has changed. Mount once in layout.
 *
 * Only real state changes ("changed"/"budget_updated"/"terminal") trigger
 * a refresh. Heartbeat events ("project_progress") are ignored — they
 * happen every few seconds and a full RSC re-render is too expensive.
 *
 * Debounce prevents double-refresh when a server action already triggers
 * revalidatePath AND emits an SSE event.
 */
const MAX_SSE_RETRIES = 5;
const REFRESH_EVENT_TYPES = new Set(["changed", "budget_updated", "terminal"]);
const DEBOUNCE_MS = 2_000;

export function LiveRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const retriesRef = useRef(0);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    if (typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function doRefresh() {
      const now = Date.now();
      const elapsed = now - lastRefreshRef.current;
      if (elapsed < DEBOUNCE_MS) {
        // Already refreshed recently (e.g. from a server action's revalidatePath).
        // Schedule one trailing refresh in case data has changed since.
        if (!debounceTimer) {
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            lastRefreshRef.current = Date.now();
            router.refresh();
          }, DEBOUNCE_MS - elapsed);
        }
        return;
      }
      lastRefreshRef.current = now;
      router.refresh();
    }

    function connect() {
      es = new EventSource("/api/events");

      es.onopen = () => {
        retriesRef.current = 0;
      };

      es.onmessage = (event) => {
        if (!event.data) return;
        if (event.data === "changed") {
          doRefresh();
          return;
        }
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (!payload?.type) return;
          if (REFRESH_EVENT_TYPES.has(payload.type)) {
            doRefresh();
          }
          // "project_progress" and other heartbeat events are intentionally
          // ignored — progress data updates on the next real state change.
        } catch {
          // Unrecognized payload — ignore
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        retriesRef.current += 1;
        if (retriesRef.current <= MAX_SSE_RETRIES) {
          const delay = Math.min(1000 * 2 ** retriesRef.current, 30_000);
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      es?.close();
      es = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [pathname, router]);

  return null;
}

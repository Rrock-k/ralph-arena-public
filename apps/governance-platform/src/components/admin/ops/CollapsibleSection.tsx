"use client";

import { useState, useCallback, useEffect } from "react";

interface CollapsibleSectionProps {
  title: string;
  storageKey?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, storageKey, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Restore from localStorage after hydration (avoids SSR mismatch)
  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = localStorage.getItem(`ops-section:${storageKey}`);
      if (stored !== null) setOpen(stored === "1");
    } catch {}
  }, [storageKey]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey) {
        try { localStorage.setItem(`ops-section:${storageKey}`, next ? "1" : "0"); } catch {}
      }
      return next;
    });
  }, [storageKey]);

  return (
    <div className="border-b border-gray-200 dark:border-slate-800">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

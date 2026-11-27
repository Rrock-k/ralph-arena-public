"use client";

import { useEffect, useRef } from "react";

/**
 * Invisible client component that sets --preview-scale CSS variable
 * on its parent based on container width / 1280px.
 * Drop inside a preview container alongside the 1280x800 iframe.
 */
export function PreviewScaler() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const scale = entry.contentRect.width / 1280;
      el.style.setProperty("--preview-scale", String(scale));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <div ref={ref} className="hidden" />;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { getStatusClasses } from "@/lib/status-classes";

interface StatusBadgeProps {
  status: string;
  className?: string;
  /** Override display text (e.g. "SLEEPING" while status is "DEPLOYED") */
  label?: string;
  /** Override style classes (e.g. for sleeping state) */
  overrideClasses?: string;
  /** Native tooltip text */
  title?: string;
}

/**
 * Status badge with a brief pulse animation on status change.
 * Drop-in replacement for inline status <span> elements.
 */
export function StatusBadge({ status, className = "", label, overrideClasses, title }: StatusBadgeProps) {
  const prevStatus = useRef(status);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 600);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const classes = overrideClasses ?? getStatusClasses(status);

  return (
    <span
      className={`${classes} ${className}`}
      style={animating ? { animation: "status-pulse 0.6s ease-out" } : undefined}
      title={title}
    >
      {label ?? status}
    </span>
  );
}

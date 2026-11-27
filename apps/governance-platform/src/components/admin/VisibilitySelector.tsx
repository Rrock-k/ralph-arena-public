"use client";

import { useState, useTransition } from "react";
import { setProjectVisibility } from "@/app/actions/project-settings";
import type { ProjectVisibility } from "@/lib/action-types";

interface VisibilitySelectorProps {
  projectId: string;
  initialValue: ProjectVisibility;
  /** Hide "featured" option for non-admin contexts */
  showFeatured?: boolean;
}

const OPTIONS: { value: ProjectVisibility; label: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "featured",
    label: "Featured",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300",
  },
  {
    value: "public",
    label: "Public",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
    color: "border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-300",
  },
  {
    value: "private",
    label: "Private",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    color: "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300",
  },
];

export function VisibilitySelector({ projectId, initialValue, showFeatured = true }: VisibilitySelectorProps) {
  const [value, setValue] = useState<ProjectVisibility>(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[1];
  const available = showFeatured ? OPTIONS : OPTIONS.filter((o) => o.value !== "featured");

  const handleSelect = (newValue: ProjectVisibility) => {
    if (newValue === value) {
      setIsOpen(false);
      return;
    }
    const oldValue = value;
    setValue(newValue);
    setIsOpen(false);
    startTransition(async () => {
      const result = await setProjectVisibility(projectId, newValue);
      if (!result.success) setValue(oldValue);
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${current.color} ${isPending ? "opacity-50" : ""}`}
        title={`Project visibility: ${current.label}`}
      >
        {current.icon}
        {current.label}
        <svg className="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {available.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  option.value === value ? "bg-gray-50 dark:bg-gray-700" : ""
                } ${option.color.split(" hover:")[0]}`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

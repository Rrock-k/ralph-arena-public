"use client";

import { useState, useEffect, type ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
}

interface ProjectTabsProps {
  tabs: TabDef[];
  defaultTab?: string;
}

export function ProjectTabs({ tabs, defaultTab }: ProjectTabsProps) {
  const first = defaultTab ?? tabs[0]?.id ?? "overview";
  const [activeTab, setActiveTab] = useState(first);

  // Read initial tab from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab && tabs.some((t) => t.id === urlTab)) {
      setActiveTab(urlTab);
    }
  }, [tabs]);

  function switchTab(tab: string) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === first) {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState({}, "", url.toString());
  }

  if (tabs.length <= 1) {
    return <>{tabs[0]?.content}</>;
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-800/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`relative rounded-md px-4 py-2 text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tabs.find((t) => t.id === activeTab)?.content}
    </div>
  );
}

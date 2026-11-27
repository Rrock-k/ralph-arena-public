"use client";

import { useState } from "react";
import type {
  AccessAdminData,
  AccessProjectOption,
} from "@/lib/access-control/types";
import { PeopleSubView } from "./PeopleSubView";
import { GrantsSubView } from "./GrantsSubView";
import { AuditSubView } from "./AuditSubView";
import { GrantAccessDialog } from "./GrantAccessDialog";

type SubView = "people" | "grants" | "audit";

interface AccessTabProps {
  data: AccessAdminData;
  projectOptions: AccessProjectOption[];
}

export function AccessTab({ data, projectOptions }: AccessTabProps) {
  const [subView, setSubView] = useState<SubView>("people");
  const [showGrantDialog, setShowGrantDialog] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Sub-view navigation */}
      <div className="flex items-center gap-1 border-b border-gray-200 px-6 pt-4 pb-0 dark:border-slate-800">
        {(["people", "grants", "audit"] as const).map((view) => (
          <button
            key={view}
            onClick={() => setSubView(view)}
            className={`relative px-3 py-2 text-sm font-medium transition-colors ${
              subView === view
                ? "text-gray-900 dark:text-slate-100"
                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {view === "people" ? "People" : view === "grants" ? "Grants" : "Audit"}
            {subView === view && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {subView === "people" && (
          <PeopleSubView
            rows={data.peopleRows}
            onGrantAccess={() => setShowGrantDialog(true)}
          />
        )}
        {subView === "grants" && (
          <GrantsSubView
            grants={data.grants}
            onGrantAccess={() => setShowGrantDialog(true)}
          />
        )}
        {subView === "audit" && (
          <AuditSubView entries={data.auditEntries} />
        )}
      </div>

      {/* Grant access dialog */}
      <GrantAccessDialog
        open={showGrantDialog}
        onOpenChange={setShowGrantDialog}
        subjects={data.subjects}
        projectOptions={projectOptions}
      />
    </div>
  );
}

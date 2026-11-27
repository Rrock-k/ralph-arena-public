"use client";

type RepoSource = "fresh" | "custom";

export function RepoSourceSelector({
  value,
  onChange,
  repoUrl,
  onRepoUrlChange,
  branch,
  onBranchChange,
}: {
  value: RepoSource;
  onChange: (v: RepoSource) => void;
  repoUrl: string;
  onRepoUrlChange: (v: string) => void;
  branch: string;
  onBranchChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">
        Repository
      </p>
      <div className="flex gap-2">
        <label
          className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
            value === "fresh"
              ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
              : "border-gray-200 bg-white hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-500"
          }`}
        >
          <input
            type="radio"
            name="repo-source"
            checked={value === "fresh"}
            onChange={() => onChange("fresh")}
            className="h-3.5 w-3.5 text-emerald-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">Fresh</span>
            <p className="text-xs text-gray-500 dark:text-slate-400">Empty workspace from template</p>
          </div>
        </label>
        <label
          className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
            value === "custom"
              ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10"
              : "border-gray-200 bg-white hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-500"
          }`}
        >
          <input
            type="radio"
            name="repo-source"
            checked={value === "custom"}
            onChange={() => onChange("custom")}
            className="h-3.5 w-3.5 text-emerald-600"
          />
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">Custom</span>
            <p className="text-xs text-gray-500 dark:text-slate-400">Clone from existing repo</p>
          </div>
        </label>
      </div>
      {value === "custom" && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Repo URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => onRepoUrlChange(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="mt-0.5 w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Branch</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => onBranchChange(e.target.value)}
              placeholder="main"
              className="mt-0.5 w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}

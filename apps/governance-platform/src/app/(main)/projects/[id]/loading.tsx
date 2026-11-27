export default function Loading() {
  return (
    <main className="min-h-screen bg-white py-8 dark:bg-[#0b0f19]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        {/* Header Card skeleton */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 mb-6 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
            <div className="h-9 w-2/3 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
            <div className="h-7 w-24 animate-pulse rounded-full bg-gray-200 dark:bg-slate-700" />
          </div>
          <div className="flex gap-3 mb-4">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          </div>
          <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-slate-700 mb-2" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        </div>

        {/* Preview skeleton */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 mb-6 dark:border-slate-700 dark:bg-slate-900">
          <div className="h-64 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>

        {/* Specs skeleton */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8 mb-6 dark:border-slate-700 dark:bg-slate-900">
          <div className="h-7 w-36 animate-pulse rounded bg-gray-200 dark:bg-slate-700 mb-3" />
          <div className="space-y-3">
            <div className="h-24 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
          </div>
        </div>
      </div>
    </main>
  );
}

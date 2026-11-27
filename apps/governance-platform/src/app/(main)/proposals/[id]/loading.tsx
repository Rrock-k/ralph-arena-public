export default function Loading() {
  return (
    <main className="min-h-screen py-8">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-6">
          <div className="h-8 w-24 animate-pulse rounded bg-white/10" />
        </div>

        <div className="glow-card rounded-2xl p-8">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1">
              <div className="mb-4 h-10 w-3/4 animate-pulse rounded bg-white/10" />
              <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
            </div>
            <div className="h-16 w-16 animate-pulse rounded bg-white/10" />
          </div>

          <div className="mb-8">
            <div className="mb-3 h-6 w-24 animate-pulse rounded bg-white/10" />
            <div className="mb-2 h-4 w-full animate-pulse rounded bg-white/10" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-white/10" />
          </div>

          <div className="mb-8">
            <div className="mb-3 h-6 w-32 animate-pulse rounded bg-white/10" />
            <div className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-white/10" />
              <div className="h-4 w-full animate-pulse rounded bg-white/10" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-full animate-pulse rounded bg-white/10" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
            </div>
          </div>

          <div className="border-t border-white/10 pt-6">
            <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
          </div>
        </div>
      </div>
    </main>
  );
}

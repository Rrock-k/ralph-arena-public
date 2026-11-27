export default function Loading() {
  return (
    <main className="min-h-screen py-8">
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-8 h-10 w-64 animate-pulse rounded bg-white/10" />

        <div className="glow-card rounded-2xl p-8">
          <div className="space-y-6">
            <div>
              <div className="mb-2 h-5 w-16 animate-pulse rounded bg-white/10" />
              <div className="h-10 w-full animate-pulse rounded bg-white/10" />
            </div>

            <div>
              <div className="mb-2 h-5 w-24 animate-pulse rounded bg-white/10" />
              <div className="h-24 w-full animate-pulse rounded bg-white/10" />
            </div>

            <div>
              <div className="mb-2 h-5 w-20 animate-pulse rounded bg-white/10" />
              <div className="h-64 w-full animate-pulse rounded bg-white/10" />
            </div>

            <div className="flex gap-4 pt-4">
              <div className="h-10 w-32 animate-pulse rounded bg-white/10" />
              <div className="h-10 w-24 animate-pulse rounded bg-white/10" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

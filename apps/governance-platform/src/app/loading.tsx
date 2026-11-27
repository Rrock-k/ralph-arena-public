export default function Loading() {
  return (
    <main className="min-h-screen py-8">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-8">
          <div className="mb-2 h-10 w-96 animate-pulse rounded bg-white/10" />
          <div className="h-6 w-64 animate-pulse rounded bg-white/10" />
        </div>

        <div className="mb-8">
          <div className="h-12 w-40 animate-pulse rounded bg-white/10" />
        </div>

        <section className="mb-12">
          <div className="mb-4 h-8 w-48 animate-pulse rounded bg-white/10" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glow-card rounded-2xl p-6">
                <div className="mb-3 h-6 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="mb-4 h-4 w-20 animate-pulse rounded bg-white/10" />
                <div className="mb-2 h-4 w-full animate-pulse rounded bg-white/10" />
                <div className="mb-4 h-4 w-5/6 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-4 h-8 w-48 animate-pulse rounded bg-white/10" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glow-card rounded-2xl p-6">
                <div className="mb-3 h-6 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="mb-4 h-4 w-20 animate-pulse rounded bg-white/10" />
                <div className="mb-2 h-4 w-full animate-pulse rounded bg-white/10" />
                <div className="mb-4 h-4 w-5/6 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

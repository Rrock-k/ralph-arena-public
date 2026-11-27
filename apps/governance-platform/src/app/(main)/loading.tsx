export default function Loading() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      {/* Hero skeleton */}
      <section className="pt-20 pb-16 text-center">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="mx-auto mb-6 h-8 w-48 animate-pulse rounded-full bg-gray-200" />
          <div className="mx-auto mb-5 h-14 w-96 animate-pulse rounded-lg bg-gray-200" />
          <div className="mx-auto mb-9 h-6 w-80 animate-pulse rounded bg-gray-200" />
          <div className="flex justify-center gap-3">
            <div className="h-12 w-40 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-12 w-40 animate-pulse rounded-xl bg-gray-200" />
          </div>
        </div>
      </section>

      {/* Builds skeleton */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="mb-12">
            <div className="mb-3 h-4 w-24 animate-pulse rounded bg-gray-200" />
            <div className="mb-3 h-10 w-48 animate-pulse rounded-lg bg-gray-200" />
            <div className="h-5 w-64 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-xl border border-gray-200 bg-white" />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

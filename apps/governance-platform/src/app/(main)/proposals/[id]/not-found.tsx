import Link from "next/link";

export default function ProposalNotFound() {
  return (
    <main className="min-h-screen py-8">
      <div className="mx-auto max-w-4xl px-4">
        <div className="glow-card rounded-2xl p-12 text-center">
          <div className="mb-6">
            <svg
              className="mx-auto h-24 w-24 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="mb-4 text-4xl font-bold text-slate-100">
            Proposal Not Found
          </h1>
          <p className="mb-8 text-lg text-slate-300">
            The proposal you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <Link
            href="/"
            className="inline-flex items-center rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-6 py-3 font-semibold text-black transition-all hover:shadow-lg hover:shadow-emerald-500/25"
          >
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

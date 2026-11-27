"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error caught by boundary:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glow-card w-full max-w-md rounded-2xl p-8 text-center">
        <div className="mb-4">
          <svg
            className="mx-auto h-12 w-12 text-rose-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="mb-2 text-2xl font-bold text-slate-100">
          Something went wrong
        </h2>
        <p className="mb-6 text-slate-300">
          An error occurred while loading this page. Please try again.
        </p>
        <button
          onClick={reset}
          className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-2 font-semibold text-black transition-all hover:shadow-lg hover:shadow-emerald-500/25"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#0b0f19] px-6 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/80 p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold">Page not found</h1>
        <p className="text-sm leading-6 text-slate-400">
          The page does not exist or is no longer available.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950"
        >
          Open Ralph Arena
        </Link>
      </section>
    </main>
  );
}

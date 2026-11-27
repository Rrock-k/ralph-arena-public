import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 py-10">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-extrabold">Ralph Arena</span>
            <span className="text-sm text-gray-500">· Community-driven AI development</span>
          </div>
          <ul className="flex gap-6 list-none">
            <li>
              <Link href="/explore" className="text-sm font-semibold text-gray-500 transition-colors hover:text-black">
                Explore
              </Link>
            </li>
            <li>
              <Link href="/#pipeline" className="text-sm font-semibold text-gray-500 transition-colors hover:text-black">
                Pipeline
              </Link>
            </li>
            <li>
              <Link href="/#proposals" className="text-sm font-semibold text-gray-500 transition-colors hover:text-black">
                Proposals
              </Link>
            </li>
            <li>
              <Link href="/retro" className="text-sm font-semibold text-gray-500 transition-colors hover:text-black">
                Retro
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

import Link from "next/link";

export function SignInButton() {
  return (
    <Link
      href="/auth/signin"
      className="rounded-lg bg-transparent px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-black"
    >
      Sign in
    </Link>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";

interface UserMenuProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  canOpenOps?: boolean;
  showCredits?: boolean;
}

export function UserMenu({ user, canOpenOps, showCredits }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  const userLabel = user.name || user.email || "User";
  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email?.charAt(0).toUpperCase() || "U";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 transition-all hover:bg-gray-50 hover:border-gray-300"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt={user.name || "User"}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-semibold text-white">
            {initials}
          </div>
        )}
        <span className="max-w-28 truncate text-sm font-medium text-gray-900 sm:max-w-40">
          {userLabel}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          <div className="border-b border-gray-200 px-4 py-3">
            <p className="truncate text-sm font-medium text-gray-900">{userLabel}</p>
            <p className="truncate text-xs text-gray-500">{user.email ?? "Telegram account"}</p>
          </div>
          <Link
            href="/my"
            className="block px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            onClick={() => setIsOpen(false)}
          >
            My Projects
          </Link>
          {showCredits && (
            <Link
              href="/credits"
              className="block px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              onClick={() => setIsOpen(false)}
            >
              Credits
            </Link>
          )}
          <Link
            href="/settings"
            className="block px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            onClick={() => setIsOpen(false)}
          >
            Settings
          </Link>
          {canOpenOps && (
            <Link
              href="/admin"
              className="block px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              onClick={() => setIsOpen(false)}
            >
              Ops
            </Link>
          )}
          <div className="border-t border-gray-200" />
          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 text-left text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

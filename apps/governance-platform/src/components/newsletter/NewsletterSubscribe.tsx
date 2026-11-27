"use client";

import { useState, type FormEvent } from "react";

interface NewsletterSubscribeProps {
  source?: "landing" | "platform";
  /** Compact mode for inline placement */
  compact?: boolean;
  className?: string;
}

export function NewsletterSubscribe({
  source = "landing",
  compact = false,
  className = "",
}: NewsletterSubscribeProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Something went wrong");
        return;
      }

      setStatus("success");
      setMessage(
        data.status === "already_subscribed"
          ? "You're already subscribed!"
          : "You're in! We'll keep you posted.",
      );
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  };

  if (status === "success") {
    return (
      <div className={`${className}`}>
        <p className="text-sm font-medium text-emerald-400">{message}</p>
      </div>
    );
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className={`flex gap-2 ${className}`}>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          placeholder="person2@example.com"
          required
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="whitespace-nowrap rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "loading" ? "..." : "Subscribe"}
        </button>
        {status === "error" && (
          <p className="absolute -bottom-5 left-0 text-xs text-rose-400">{message}</p>
        )}
      </form>
    );
  }

  return (
    <div className={className}>
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-md gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          placeholder="person2@example.com"
          required
          className="min-w-0 flex-1 rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-xl bg-sky-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "loading" ? "Subscribing..." : "Get Updates"}
        </button>
      </form>
      {status === "error" && (
        <p className="mt-2 text-center text-sm text-rose-400">{message}</p>
      )}
      <p className="mt-3 text-center text-xs text-gray-500">
        No spam. Unsubscribe anytime.
      </p>
    </div>
  );
}

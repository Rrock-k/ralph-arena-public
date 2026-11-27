import { Toaster } from "sonner";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CloudflareAnalytics } from "@/components/analytics/CloudflareAnalytics";

export const dynamic = "force-dynamic";

export default function LegacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100">
      <LiveRefresh />
      {children}
      <Toaster position="top-right" theme="dark" />
      <CloudflareAnalytics />
    </div>
  );
}

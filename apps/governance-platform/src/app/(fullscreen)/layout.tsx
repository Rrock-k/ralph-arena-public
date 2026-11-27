import { AdminThemeShell } from "@/components/theme/AdminThemeShell";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CloudflareAnalytics } from "@/components/analytics/CloudflareAnalytics";

export const dynamic = "force-dynamic";

export default function FullscreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminThemeShell>
      <LiveRefresh />
      {children}
      <CloudflareAnalytics />
    </AdminThemeShell>
  );
}

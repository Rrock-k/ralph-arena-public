import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "A2E Studio",
  description: "Local control plane for Ralph Arena A2E runs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider delayDuration={200}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Доска задач — Ralph Arena",
  description: "Канбан-доска бэклога Ralph Arena",
};

const PASTEL_COLORS: Record<string, string> = {
  blue: "#a8c8f0",
  green: "#a8e6c3",
  pink: "#f0b8d0",
  purple: "#c4b0f0",
  orange: "#f0d0a8",
  yellow: "#f0e8a8",
  red: "#f0b0b0",
  teal: "#a8e0e0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const raw = process.env.BOARD_COLOR || "";
  const borderColor = PASTEL_COLORS[raw] || raw || "";

  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        <ThemeProvider>
          {borderColor && (
            <div
              aria-hidden="true"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                pointerEvents: "none",
                borderStyle: "solid",
                borderColor,
                borderWidth: "4.5px 4.5px 9px 4.5px",
              }}
            />
          )}
          {children}
          <Toaster position="bottom-center" duration={1500} />
        </ThemeProvider>
      </body>
    </html>
  );
}

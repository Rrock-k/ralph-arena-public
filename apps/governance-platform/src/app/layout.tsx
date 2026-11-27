import type { Metadata } from "next";
import "./globals.css";
import "./globals-legacy.css";
import { Nunito, JetBrains_Mono } from "next/font/google";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ralph Arena — Community-Driven AI Development",
  description: "Propose projects, vote on them, and watch AI agents build them live.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${nunito.variable} ${jetbrainsMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

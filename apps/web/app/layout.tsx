import "geist/font/sans";
import "geist/font/mono";
import "./globals.css";

import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Dev Learning Harness",
  description: "Локальная система самостоятельной подготовки JS-разработчика",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <AppShell>{children}</AppShell>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

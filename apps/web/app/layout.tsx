import "geist/font/sans";
import "geist/font/mono";
import "./globals.css";

import type { Metadata } from "next";
import { cookies } from "next/headers";

import type { UiLocale } from "@/lib/i18n";

import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/lib/i18n";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: {
    default: "Aptiloop",
    template: "%s · Aptiloop",
  },
  description: "Local-first deliberate learning with deterministic evidence.",
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const storedLocale = (await cookies()).get("aptiloop.ui-locale")?.value;
  const initialLocale: UiLocale = storedLocale === "ru-RU" ? "ru-RU" : "en-US";

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <LocaleProvider initialLocale={initialLocale}>
              <TooltipProvider delayDuration={250}>
                <AppShell>{children}</AppShell>
                <Toaster position="top-right" closeButton />
              </TooltipProvider>
            </LocaleProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import "geist/font/sans";
import "geist/font/mono";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Script from "next/script";

import type { UiLocale } from "@/lib/i18n";

import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/lib/i18n";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";

const sidebarPreferenceBootstrap = `
try {
  const value = window.localStorage.getItem("aptiloop:sidebar-collapsed");
  if (value === "true" || value === "false") {
    document.documentElement.dataset.sidebarCollapsed = value;
    document.cookie = "aptiloop.sidebar-collapsed=" + value + "; Path=/; Max-Age=31536000; SameSite=Strict";
  }
} catch {}
`;

export const metadata: Metadata = {
  applicationName: "Aptiloop",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1013" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const storedLocale = cookieStore.get("aptiloop.ui-locale")?.value;
  const initialLocale: UiLocale = storedLocale === "ru-RU" ? "ru-RU" : "en-US";
  const initialSidebarCollapsed =
    cookieStore.get("aptiloop.sidebar-collapsed")?.value === "true";

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body>
        <Script id="aptiloop-sidebar-preference" strategy="beforeInteractive">
          {sidebarPreferenceBootstrap}
        </Script>
        <ThemeProvider>
          <QueryProvider>
            <LocaleProvider initialLocale={initialLocale}>
              <TooltipProvider delayDuration={250}>
                <AppShell initialSidebarCollapsed={initialSidebarCollapsed}>
                  {children}
                </AppShell>
                <Toaster position="top-right" closeButton />
              </TooltipProvider>
            </LocaleProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import { describe, expect, it, vi } from "vitest";

vi.mock("geist/font/sans", () => ({}));
vi.mock("geist/font/mono", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: () => null,
}));
vi.mock("@/components/query-provider", () => ({ QueryProvider: () => null }));
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: () => null }));
vi.mock("@/lib/i18n", () => ({ LocaleProvider: () => null }));

import { viewport } from "@/app/layout";

describe("root layout metadata", () => {
  it("opts into full safe-area viewport coverage", () => {
    expect(viewport).toMatchObject({ viewportFit: "cover" });
  });
});

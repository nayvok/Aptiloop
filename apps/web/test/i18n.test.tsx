import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogs, LocaleProvider, type MessageKey, useI18n } from "@/lib/i18n";
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

function LocaleProbe() {
  const { formatDate, formatNumber, locale, setLocale, t } = useI18n();
  return (
    <div>
      <p>{locale}</p>
      <p>{t("nav.home")}</p>
      <p>{t("home.phase.progress", { complete: 2, total: 5 })}</p>
      <p>{formatDate("2026-08-10T00:00:00.000Z", { timeZone: "UTC" })}</p>
      <p>{formatNumber(1234.5)}</p>
      <p>{t("missing.key" as MessageKey)}</p>
      <button type="button" onClick={() => setLocale("ru-RU")}>
        switch
      </button>
    </div>
  );
}

function renderLocaleProbe() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale="en-US">
        <LocaleProbe />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.lang = "";
});

describe("UI locale contract", () => {
  it("keeps complete non-empty en-US and ru-RU catalogs", () => {
    const englishKeys = Object.keys(catalogs["en-US"]).sort();
    const russianKeys = Object.keys(catalogs["ru-RU"]).sort();
    expect(russianKeys).toEqual(englishKeys);
    for (const locale of ["en-US", "ru-RU"] as const) {
      for (const key of englishKeys) {
        expect(catalogs[locale][key as MessageKey].trim()).not.toBe("");
      }
    }
  });

  it("switches locale, updates html lang, interpolates, formats, and exposes missing keys", async () => {
    apiMock.mockResolvedValue({ uiLocale: "en-US" });
    renderLocaleProbe();

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 activities")).toBeInTheDocument();
    expect(screen.getByText("8/10/2026")).toBeInTheDocument();
    expect(screen.getByText("missing.key")).toBeInTheDocument();
    expect(screen.getByText("1,234.5")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"));

    fireEvent.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByText("Главная")).toBeInTheDocument();
    expect(screen.getByText("Активностей: 2 из 5")).toBeInTheDocument();
    expect(screen.getByText("10.08.2026")).toBeInTheDocument();
    expect(screen.getByText(/1\s234,5/u)).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe("ru-RU"));
  });

  it("keeps hardcoded Russian out of production TypeScript outside the locale catalog", async () => {
    const roots = [
      path.resolve(process.cwd(), "app"),
      path.resolve(process.cwd(), "components"),
      path.resolve(process.cwd(), "lib"),
    ];
    const files = (
      await Promise.all(roots.map((root) => productionTypeScriptFiles(root)))
    ).flat();
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(path.join("lib", "i18n.tsx"))) continue;
      const source = await readFile(file, "utf8");
      if (/[А-Яа-яЁё]/u.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function productionTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) return productionTypeScriptFiles(absolute);
      return /\.tsx?$/u.test(entry.name) ? [absolute] : [];
    }),
  );
  return files.flat();
}

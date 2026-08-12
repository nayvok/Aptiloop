import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogs,
  LocaleProvider,
  type MessageKey,
  type UiLocale,
  uiLocaleStorageKey,
  useI18n,
} from "@/lib/i18n";

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
      <button type="button" onClick={() => setLocale("invalid" as UiLocale)}>
        invalid
      </button>
    </div>
  );
}

function renderLocaleProbe(initialLocale: UiLocale = "en-US") {
  return render(
    <LocaleProvider initialLocale={initialLocale} syncSettings={false}>
      <LocaleProbe />
    </LocaleProvider>,
  );
}

function renderFirstRunLocaleProbe(initialLocale: UiLocale = "en-US") {
  return render(
    <LocaleProvider initialLocale={initialLocale}>
      <LocaleProbe />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "aptiloop.ui-locale=; Path=/; Max-Age=0";
});

afterEach(() => {
  cleanup();
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

  it("uses observation terminology for interview reports in both locales", () => {
    const englishInterviewCopy = [
      catalogs["en-US"]["review.viewDescription.interviews"],
      catalogs["en-US"]["interview.setup.description"],
      catalogs["en-US"]["interview.report.summary"],
      catalogs["en-US"]["interview.report.evidence"],
    ].join(" ");
    const russianInterviewCopy = [
      catalogs["ru-RU"]["page.interview.description"],
      catalogs["ru-RU"]["review.viewDescription.interviews"],
      catalogs["ru-RU"]["interview.setup.description"],
      catalogs["ru-RU"]["interview.session.description"],
      catalogs["ru-RU"]["interview.chat.readyDescription"],
      catalogs["ru-RU"]["interview.report.summary"],
      catalogs["ru-RU"]["interview.report.evidence"],
    ].join(" ");

    expect(englishInterviewCopy).toMatch(/answer observations/iu);
    expect(englishInterviewCopy).not.toMatch(/skill evidence/iu);
    expect(russianInterviewCopy).toMatch(/наблюдени/u);
    expect(russianInterviewCopy).not.toMatch(
      /подтверждени[а-яё]* навыка|\b(?:transcript|review)\b/iu,
    );
    expect(catalogs["en-US"]["interview.report.limits"]).toMatch(
      /Technical correctness was not checked/u,
    );
    expect(catalogs["ru-RU"]["interview.report.limits"]).toMatch(
      /Техническая корректность не проверялась/u,
    );
  });

  it("switches locale, updates html lang, interpolates, formats, and exposes missing keys", async () => {
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
    expect(window.localStorage.getItem(uiLocaleStorageKey)).toBe("ru-RU");
    expect(document.cookie).toContain("aptiloop.ui-locale=ru-RU");
  });

  it("ignores malformed runtime locale values", async () => {
    renderLocaleProbe();

    expect(await screen.findByText("Home")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "invalid" }));

    expect(screen.getByText("Home")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"));
  });

  it("hydrates from canonical local storage and mirrors the locale to the SSR cookie", async () => {
    window.localStorage.setItem(uiLocaleStorageKey, "ru-RU");
    renderLocaleProbe("en-US");

    expect(await screen.findByText("Главная")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ru-RU");
    expect(document.cookie).toContain("aptiloop.ui-locale=ru-RU");
  });

  it("discards malformed stored locales and safely keeps the SSR fallback", async () => {
    window.localStorage.setItem(uiLocaleStorageKey, "de-DE");
    renderLocaleProbe("en-US");

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem(uiLocaleStorageKey)).toBeNull();
  });

  it("ignores a malformed locale cookie without breaking the local fallback", async () => {
    document.cookie = "aptiloop.ui-locale=%; Path=/";
    renderLocaleProbe("en-US");

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem(uiLocaleStorageKey)).toBeNull();
  });

  it("uses the confirmed cookie mirror when local storage reads are blocked", async () => {
    document.cookie = "aptiloop.ui-locale=ru-RU; Path=/";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });

    renderFirstRunLocaleProbe("en-US");

    expect(await screen.findByText("Главная")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ru-RU");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("uses the browser prefill and keeps first-run confirmation when local storage reads are blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ru-RU"]);

    renderFirstRunLocaleProbe("en-US");

    expect(await screen.findByText("Главная")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ru-RU");
    expect(
      screen.getByRole("alertdialog", { name: "Выберите язык интерфейса" }),
    ).toBeVisible();
    expect(document.cookie).not.toContain("aptiloop.ui-locale=");
  });

  it("resets to the unsaved fallback when another tab removes the stored locale", async () => {
    window.localStorage.setItem(uiLocaleStorageKey, "ru-RU");
    renderLocaleProbe("en-US");
    expect(await screen.findByText("Главная")).toBeInTheDocument();

    window.localStorage.removeItem(uiLocaleStorageKey);
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: uiLocaleStorageKey,
        newValue: null,
      }),
    );

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.cookie).not.toContain("aptiloop.ui-locale=");
  });

  it("discards a malformed cross-tab locale without restoring the cookie mirror", async () => {
    window.localStorage.setItem(uiLocaleStorageKey, "ru-RU");
    renderLocaleProbe("en-US");
    expect(await screen.findByText("Главная")).toBeInTheDocument();

    window.localStorage.setItem(uiLocaleStorageKey, "de-DE");
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: uiLocaleStorageKey,
        newValue: "de-DE",
      }),
    );

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(window.localStorage.getItem(uiLocaleStorageKey)).toBeNull();
    expect(document.cookie).not.toContain("aptiloop.ui-locale=");
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
  }, 15_000);
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

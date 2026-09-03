import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CourseLibraryClient,
  CoursePackImportClient,
  CoursePackIntakeClient,
} from "@/components/course-pack-client";
import { LocaleProvider } from "@/lib/i18n";

const {
  apiMock,
  navigationState,
  pushMock,
  replaceMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  navigationState: { search: "" },
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));
vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

const contentHash = `sha256:${"a".repeat(64)}`;
const notStartedSummary = {
  state: "not-started" as const,
  completedLessons: 0,
  totalLessons: 4,
  progressPercent: 0,
  lastActivityAt: null,
};
const report = {
  validatorVersion: "m3-v2",
  valid: true,
  errors: 0,
  warnings: 0,
  diagnostics: [],
  limits: {
    maxBytes: 1_048_576,
    maxDecodedCharacters: 900_000,
    maxDepth: 24,
    maxItems: 20_000,
    maxStringCharacters: 50_000,
    maxParseMilliseconds: 100,
  },
};
const validValidationResponse = {
  valid: true,
  storageAvailable: true,
  validationId: "123e4567-e89b-42d3-a456-426614174001",
  expiresAt: "2099-08-10T00:15:00.000Z",
  sourceKind: "course-pack" as const,
  finalized: false,
  report,
  preview: {
    courseKey: "development-kernel-basics",
    revisionKey: "development-kernel-basics/v1",
    courseTitle: "Deterministic Learning Basics",
    revisionNumber: 1,
    primaryLocale: "en-US",
    availableLocales: ["en-US"],
    contentHash,
    lessonCount: 1,
    activityCount: 2,
    sourcePrivacyClasses: { public: 1, private: 0 },
    requirements: {
      activityTypes: ["study", "recall"],
      capabilities: [],
      environmentIds: [],
      checkIds: [],
    },
    provenance: {
      contentStatus: "development-fixture",
      author: "Aptiloop development fixture",
      origin: "original",
      ownership: "owned",
      licenseSpdx: null,
      termsUrl: "https://example.invalid/terms",
      attribution: "Synthetic fixture",
      createdAt: "2026-08-10T00:00:00.000Z",
      notes: null,
    },
  },
};

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(children, {
    wrapper: ({ children: wrappedChildren }) => (
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
          {wrappedChildren}
        </LocaleProvider>
      </QueryClientProvider>
    ),
  });
}

function coursePackFileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#course-pack-file");
  if (!input) throw new Error("Course Pack file input is missing");
  return input;
}

function createDeferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  apiMock.mockReset();
  navigationState.search = "";
  pushMock.mockReset();
  replaceMock.mockReset();
  const rememberSearch = (href: string) => {
    navigationState.search = new URL(href, "http://localhost/courses").search;
  };
  pushMock.mockImplementation(rememberSearch);
  replaceMock.mockImplementation(rememberSearch);
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: vi.fn(() => "123e4567-e89b-42d3-a456-426614174000"),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Course Pack import", () => {
  it("keeps import separate from Course creation and the library", async () => {
    apiMock.mockResolvedValue({ storageAvailable: true, packs: [] });

    renderWithQuery(<CoursePackImportClient />);

    expect(
      screen.getByRole("heading", { name: "Импорт Course Pack", level: 1 }),
    ).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: "Курсы" });
    expect(backLink).toHaveAttribute("href", "/courses");
    expect(backLink).toHaveAttribute("data-variant", "ghost");
    expect(
      screen.queryByRole("heading", { name: "Локальная библиотека" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Создать курс" }),
    ).not.toBeInTheDocument();
    const fileInput = coursePackFileInput();
    expect(fileInput).toHaveAttribute("hidden");
    expect(fileInput).toHaveAttribute("aria-hidden", "true");
    expect(fileInput).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByRole("button", { name: "JSON-файл" })).toHaveLength(
      1,
    );
    expect(screen.queryByLabelText("JSON-файл")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Проверить Pack" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Проверить Pack" }),
    ).toBeDisabled();
    expect(apiMock).not.toHaveBeenCalledWith(
      "/course-packs/validate",
      expect.anything(),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/course-packs"));
  });

  it("stages a rejected result without exposing intake actions on the file-selection route", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/course-packs/validate") {
        return {
          valid: false,
          storageAvailable: true,
          validationId: "123e4567-e89b-42d3-a456-426614174003",
          expiresAt: "2099-08-10T00:15:00.000Z",
          sourceKind: "course-pack",
          finalized: false,
          report: {
            ...report,
            valid: false,
            errors: 1,
            diagnostics: [
              {
                code: "PACK_AUTHORITY_FIELD",
                severity: "error",
                path: "/command",
                entityId: null,
                message: "Authority-bearing field is forbidden: command",
                ruleId: "authority-field",
                context: "field-name",
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithQuery(<CoursePackImportClient />);
    const file = new File(['{"command":"npm test"}'], "unsafe.json", {
      type: "application/json",
    });
    fireEvent.change(coursePackFileInput(), {
      target: { files: [file] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("unsafe.json");
    fireEvent.click(screen.getByRole("button", { name: "Проверить Pack" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/intake/123e4567-e89b-42d3-a456-426614174003",
      ),
    );
    expect(screen.queryByText("PACK_AUTHORITY_FIELD")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      "/course-packs/validate",
      expect.objectContaining({ method: "POST", body: file }),
    );
  });

  it("does not expose a private library failure or misreport it as missing storage", async () => {
    const privateFailure =
      "SQLITE_ERROR at C:\\Users\\yan\\private\\database.sqlite sk-super-secret-sentinel";
    apiMock.mockRejectedValue(new Error(privateFailure));

    renderWithQuery(<CoursePackImportClient />);

    expect(
      await screen.findByText("Не удалось получить данные"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Не удалось загрузить локальную библиотеку курсов."),
    ).toBeInTheDocument();
    expect(screen.queryByText(privateFailure)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Локальное хранилище курсов недоступно"),
    ).not.toBeInTheDocument();
  });

  it("retains hostile long filenames and exposes only bounded failure diagnostics", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/course-packs/validate") {
        throw {
          status: 413,
          code: "payload_too_large",
          message: "C:\\Users\\learner\\private\\pack.json parser offset 412",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithQuery(<CoursePackImportClient />);
    const filename = `${"hostile-name-".repeat(24)}<script>.json`;
    const file = new File(["not json"], filename, {
      type: "application/json",
    });
    fireEvent.change(coursePackFileInput(), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить Pack" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      `Не удалось проверить файл ${filename}. Выбранный файл сохранён`,
    );
    expect(screen.getByRole("status")).toHaveTextContent(filename);
    const picker = screen.getByRole("button", { name: "JSON-файл" });
    expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(picker.getAttribute("aria-describedby")?.split(" ")).toContain(
      error.id,
    );
    const details = within(error)
      .getByText("Технические сведения")
      .closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(
      within(error).getByText("HTTP 413 · payload_too_large"),
    ).not.toBeVisible();
    expect(screen.queryByText(/Users\\learner/u)).not.toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
  it("reports a malformed validation response as a response-contract failure", async () => {
    const privateDetail =
      "C:\\Users\\learner\\private\\database.sqlite sk-super-secret-sentinel";
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/course-packs/validate") {
        return {
          ...validValidationResponse,
          sourceKind: "unsupported-source-kind",
          privateDetail,
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithQuery(<CoursePackImportClient />);
    const file = new File(["{}"], "contract.json", {
      type: "application/json",
    });
    fireEvent.change(coursePackFileInput(), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить Pack" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "Aptiloop получил некорректный ответ проверки для файла contract.json",
    );
    expect(error).not.toHaveTextContent("Не удалось проверить файл");
    expect(screen.queryByText(privateDetail)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps restored commit actions disabled when storage is unavailable", async () => {
    navigationState.search = "?confirm=install";
    apiMock.mockResolvedValue({
      ...validValidationResponse,
      storageAvailable: false,
    });

    renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );

    await screen.findByRole("heading", {
      name: "Deterministic Learning Basics",
    });
    expect(
      screen.getByText("Локальное хранилище курсов недоступно"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть Core и локальные пути" }),
    ).toHaveAttribute("href", "/settings?section=advanced");
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить проверку хранилища" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("button", { name: "Установить и открыть" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Открыть как черновик" }),
    ).toBeDisabled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("expires a restored Preview at expiresAt and requires file reselection", async () => {
    const expiringValidation = {
      ...validValidationResponse,
      expiresAt: new Date(Date.now() + 400).toISOString(),
    };
    apiMock.mockImplementation(async (path: string) => {
      if (
        path === `/course-packs/validations/${expiringValidation.validationId}`
      ) {
        return expiringValidation;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(
      <CoursePackIntakeClient operationId={expiringValidation.validationId} />,
    );

    await screen.findByRole("heading", {
      name: "Deterministic Learning Basics",
    });
    expect(
      screen.getByRole("button", { name: "Установить и открыть" }),
    ).toBeEnabled();

    expect(
      await screen.findByText("Срок проверки истёк", undefined, {
        timeout: 2_000,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Выбрать файл повторно" }),
    );
    expect(pushMock).toHaveBeenLastCalledWith("/courses/import");
  });

  it("locks file selection during validation and ignores a stale response after the file identity changes", async () => {
    const firstValidation = createDeferred<typeof validValidationResponse>();
    const secondContentHash = `sha256:${"b".repeat(64)}`;
    const secondValidation = {
      ...validValidationResponse,
      validationId: "123e4567-e89b-42d3-a456-426614174002",
      preview: {
        ...validValidationResponse.preview,
        courseKey: "course-b",
        revisionKey: "course-b/v1",
        courseTitle: "Course B",
        contentHash: secondContentHash,
      },
    };
    const firstFile = new File(["{}"], "course-a.json", {
      type: "application/json",
    });
    const secondFile = new File(["{}"], "course-b.json", {
      type: "application/json",
    });

    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/course-packs/validate") {
        return init?.body === firstFile
          ? firstValidation.promise
          : secondValidation;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CoursePackImportClient />);
    const fileInput = coursePackFileInput();
    const fileButton = screen.getByRole("button", { name: "JSON-файл" });
    const validateButton = screen.getByRole("button", {
      name: "Проверить Pack",
    });

    fireEvent.change(fileInput, { target: { files: [firstFile] } });
    fireEvent.click(validateButton);

    await waitFor(() => expect(validateButton).toBeDisabled());
    expect(fileButton).toBeDisabled();
    expect(fileInput).toBeDisabled();

    // A disabled input cannot change through the UI. This forced event proves the
    // response guard still protects state if the DOM changes underneath React.
    fireEvent.change(fileInput, { target: { files: [secondFile] } });
    expect(screen.getByText("course-b.json")).toBeInTheDocument();

    await act(async () => {
      firstValidation.resolve(validValidationResponse);
      await firstValidation.promise;
    });

    await waitFor(() => expect(validateButton).not.toBeDisabled());
    expect(
      screen.queryByRole("heading", {
        name: "Deterministic Learning Basics",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();

    fireEvent.click(validateButton);
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/intake/123e4567-e89b-42d3-a456-426614174002",
      ),
    );
    expect(
      screen.queryByRole("heading", {
        name: "Deterministic Learning Basics",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Course B" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([path]) => String(path).endsWith("/commit")),
    ).toBe(false);
  });

  it("requires Preview confirmation and opens the committed Course revision", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (
        path ===
        `/course-packs/validations/${validValidationResponse.validationId}`
      ) {
        return validValidationResponse;
      }
      if (path.endsWith("/commit")) {
        return {
          result: {
            courseId: "development-kernel-basics",
            revisionId: "development-kernel-basics/v1",
            contentHash,
            action: "install",
            revisionStatus: "published",
            installed: true,
            idempotent: false,
          },
          openPath:
            "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const rendered = renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Deterministic Learning Basics",
      }),
    ).toBeInTheDocument();
    const technicalDetails = screen
      .getByText("Технические сведения")
      .closest("details");
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(screen.getByText(contentHash)).not.toBeVisible();
    fireEvent.click(screen.getByText("Технические сведения"));
    expect(technicalDetails).toHaveAttribute("open");
    expect(screen.getByText(contentHash)).toBeVisible();
    navigationState.search = "?confirm=install";
    rendered.rerender(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Установить эту неизменяемую ревизию?",
    });
    expect(
      apiMock.mock.calls.some(
        ([path]) =>
          String(path).includes("/course-packs/validations/") &&
          String(path).endsWith("/commit"),
      ),
    ).toBe(false);
    expect(
      within(confirmation).getByText("development-kernel-basics/v1"),
    ).toBeInTheDocument();
    expect(within(confirmation).getByText(contentHash)).toBeInTheDocument();
    expect(
      within(confirmation).getByText(
        "Локальная библиотека курсов, затем учебный маршрут только для чтения",
      ),
    ).toBeInTheDocument();
    expect(
      within(confirmation).getByText(
        "Импортированная опубликованная ревизия неизменяема: её нельзя редактировать на месте.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Установить неизменяемую ревизию",
      }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
      ),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/course-packs/validations/123e4567-e89b-42d3-a456-426614174001/commit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: `course-pack:${validValidationResponse.validationId}:install`,
          action: "install",
          expectedContentHash: contentHash,
        }),
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Course Pack установлен. Открываем учебный путь.",
    );
  });

  it("reports an idempotent repeat install without claiming a new installation", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (
        path ===
        `/course-packs/validations/${validValidationResponse.validationId}`
      ) {
        return validValidationResponse;
      }
      if (path.endsWith("/commit")) {
        return {
          result: {
            courseId: "development-kernel-basics",
            revisionId: "development-kernel-basics/v1",
            contentHash,
            action: "install",
            revisionStatus: "published",
            installed: false,
            idempotent: true,
          },
          openPath:
            "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    navigationState.search = "?confirm=install";
    renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Установить неизменяемую ревизию",
      }),
    );

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Эта точная ревизия Course Pack уже установлена. Открываем существующий учебный путь.",
      ),
    );
    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      "Course Pack установлен. Открываем учебный путь.",
    );
  });

  it("opens a committed draft in the stable Studio route when openPath is null", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (
        path ===
        `/course-packs/validations/${validValidationResponse.validationId}`
      ) {
        return validValidationResponse;
      }
      if (path.endsWith("/commit")) {
        return {
          result: {
            courseId: "development-kernel-basics",
            revisionId: "development-kernel-basics/v1-draft",
            contentHash,
            action: "open-as-draft",
            revisionStatus: "draft",
            installed: true,
            idempotent: false,
          },
          openPath: null,
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    navigationState.search = "?confirm=open-as-draft";
    renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Создать этот локальный черновик?",
    });
    expect(
      within(confirmation).getByText("development-kernel-basics/v1"),
    ).toBeInTheDocument();
    expect(within(confirmation).getByText(contentHash)).toBeInTheDocument();
    expect(
      within(confirmation).getByText(
        "Локальный редактируемый черновик в Adaptive Studio",
      ),
    ).toBeInTheDocument();
    expect(
      within(confirmation).getByText(
        "Исходный Pack останется неизменным; публикация выполняется отдельным явным действием.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Создать локальный черновик",
      }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/studio?version=development-kernel-basics%2Fv1-draft",
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Course Pack сохранён как черновик.",
    );
  });

  it("shows the pending indicator on Open as draft instead of Install", async () => {
    const draftCommit = createDeferred<{
      result: {
        courseId: string;
        revisionId: string;
        contentHash: string;
        action: "open-as-draft";
        revisionStatus: "draft";
        installed: boolean;
        idempotent: boolean;
      };
      openPath: null;
    }>();
    apiMock.mockImplementation((path: string) => {
      if (
        path ===
        `/course-packs/validations/${validValidationResponse.validationId}`
      ) {
        return validValidationResponse;
      }
      if (path.endsWith("/commit")) {
        return draftCommit.promise;
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    navigationState.search = "?confirm=open-as-draft";
    renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Создать локальный черновик",
      }),
    );

    await waitFor(() => {
      const confirmation = screen.getByRole("alertdialog", {
        name: "Создать этот локальный черновик?",
      });
      const draftButton = within(confirmation).getByRole("button", {
        name: "Создать локальный черновик",
      });
      expect(draftButton).toBeDisabled();
      expect(
        draftButton.querySelector('[data-slot="spinner"]'),
      ).toBeInTheDocument();
      expect(
        within(confirmation).getByRole("button", { name: "Отмена" }),
      ).toBeDisabled();
    });

    await act(async () => {
      draftCommit.resolve({
        result: {
          courseId: "development-kernel-basics",
          revisionId: "development-kernel-basics/v1-draft",
          contentHash,
          action: "open-as-draft",
          revisionStatus: "draft",
          installed: true,
          idempotent: false,
        },
        openPath: null,
      });
      await draftCommit.promise;
    });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/studio?version=development-kernel-basics%2Fv1-draft",
      ),
    );
  });

  it("keeps an uncertain commit confirmation open with details and supports retry", async () => {
    let commitAttempts = 0;
    const commitBodies: Array<Record<string, unknown>> = [];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (
        path ===
        `/course-packs/validations/${validValidationResponse.validationId}`
      ) {
        return validValidationResponse;
      }
      if (path.endsWith("/commit")) {
        commitAttempts += 1;
        commitBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        if (commitAttempts === 1)
          throw {
            status: 503,
            code: "storage_unavailable",
            message:
              "C:\\private\\database.sqlite connection closed after send",
          };
        return {
          result: {
            courseId: "development-kernel-basics",
            revisionId: "development-kernel-basics/v1",
            contentHash,
            action: "install",
            revisionStatus: "published",
            installed: false,
            idempotent: true,
          },
          openPath:
            "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    navigationState.search = "?confirm=install";
    renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    const confirmation = await screen.findByRole("alertdialog", {
      name: "Установить эту неизменяемую ревизию?",
    });
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Установить неизменяемую ревизию",
      }),
    );

    expect(
      await within(confirmation).findByText("Локальное изменение не завершено"),
    ).toBeInTheDocument();
    expect(confirmation).toBeInTheDocument();
    expect(within(confirmation).getByText(contentHash)).toBeInTheDocument();
    const details = within(confirmation)
      .getAllByText("Технические сведения")
      .at(-1)
      ?.closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(
      within(confirmation).getByText("HTTP 503 · storage_unavailable"),
    ).not.toBeVisible();
    expect(
      within(confirmation).queryByText(/private\\database/u),
    ).not.toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Повторить локальное изменение",
      }),
    );
    await waitFor(() => expect(commitAttempts).toBe(2));
    expect(commitBodies).toHaveLength(2);
    expect(commitBodies[1]).toEqual(commitBodies[0]);
    expect(commitBodies[0]).toMatchObject({
      operationId: `course-pack:${validValidationResponse.validationId}:install`,
      action: "install",
      expectedContentHash: contentHash,
    });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
      ),
    );
  });
});

describe("Course Pack staged intake", () => {
  it("restores Preview and URL-backed confirmation across Back and Forward without committing on GET", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (
        path ===
        "/course-packs/validations/123e4567-e89b-42d3-a456-426614174001"
      ) {
        return validValidationResponse;
      }
      if (path.endsWith("/commit")) {
        return {
          result: {
            courseId: "development-kernel-basics",
            revisionId: "development-kernel-basics/v1",
            contentHash,
            action: "install",
            revisionStatus: "published",
            installed: true,
            idempotent: false,
          },
          openPath:
            "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    const rendered = renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Deterministic Learning Basics",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("JSON-файл")).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([path]) => String(path).endsWith("/commit")),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Установить и открыть" }),
    );
    expect(pushMock).toHaveBeenLastCalledWith(
      `/courses/intake/${validValidationResponse.validationId}?confirm=install`,
      { scroll: false },
    );
    rendered.rerender(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    expect(
      await screen.findByRole("alertdialog", {
        name: "Установить эту неизменяемую ревизию?",
      }),
    ).toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([path]) => String(path).endsWith("/commit")),
    ).toBe(false);

    navigationState.search = "";
    rendered.rerender(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    navigationState.search = "?confirm=install";
    rendered.rerender(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    const restoredConfirmation = await screen.findByRole("alertdialog", {
      name: "Установить эту неизменяемую ревизию?",
    });
    fireEvent.click(
      within(restoredConfirmation).getByRole("button", {
        name: "Установить неизменяемую ревизию",
      }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/course-packs/validations/${validValidationResponse.validationId}/commit`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("restores rejected diagnostics without exposing commit controls", async () => {
    const invalidValidation = {
      valid: false as const,
      storageAvailable: true,
      validationId: "123e4567-e89b-42d3-a456-426614174004",
      expiresAt: "2099-08-10T00:15:00.000Z",
      sourceKind: "course-pack" as const,
      finalized: false,
      report: {
        ...report,
        valid: false,
        errors: 1,
        diagnostics: [
          {
            code: "PACK_AUTHORITY_FIELD",
            severity: "error" as const,
            path: "/command",
            entityId: null,
            message: "Authority-bearing field is forbidden: command",
            ruleId: "authority-field",
            context: "field-name",
          },
        ],
      },
    };
    apiMock.mockResolvedValue(invalidValidation);

    renderWithQuery(
      <CoursePackIntakeClient operationId={invalidValidation.validationId} />,
    );

    const rejection = await screen.findByRole("alert");
    expect(within(rejection).getByText("Pack отклонён")).toBeInTheDocument();
    expect(screen.getByText("PACK_AUTHORITY_FIELD")).toBeInTheDocument();
    expect(screen.getByText("authority-field")).toBeInTheDocument();
    expect(screen.getByText("field-name")).toBeInTheDocument();
    expect(
      screen.queryByText("Authority-bearing field is forbidden: command"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Открыть как черновик" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("JSON-файл")).not.toBeInTheDocument();
  });
  it("distinguishes a malformed staged response from a staging failure", async () => {
    apiMock.mockResolvedValue({
      ...validValidationResponse,
      expiresAt: 42,
      privateDetail:
        "C:\\Users\\learner\\private\\database.sqlite sk-super-secret-sentinel",
    });

    renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );

    expect(
      await screen.findByText("Ответ сохранённой проверки некорректен"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Не удалось восстановить проверку"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Users\\learner/u)).not.toBeInTheDocument();
  });

  it("fails closed for expired and unavailable staged operations", async () => {
    navigationState.search = "?confirm=install";
    apiMock.mockResolvedValueOnce({
      ...validValidationResponse,
      expiresAt: "2026-08-10T00:15:00.000Z",
    });

    const expired = renderWithQuery(
      <CoursePackIntakeClient
        operationId={validValidationResponse.validationId}
      />,
    );
    expect(await screen.findByText("Срок проверки истёк")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Выбрать файл повторно" }),
    );
    expect(pushMock).toHaveBeenLastCalledWith("/courses/import");

    expired.unmount();
    navigationState.search = "";
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error("server detail must stay hidden"), {
        status: 404,
      }),
    );
    renderWithQuery(
      <CoursePackIntakeClient operationId="123e4567-e89b-42d3-a456-426614174099" />,
    );
    expect(
      await screen.findByText("Эта сохранённая проверка больше недоступна"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Выбрать файл повторно" }),
    ).toHaveAttribute("href", "/courses/import");
    expect(
      screen.queryByText("server detail must stay hidden"),
    ).not.toBeInTheDocument();
  });
});

describe("Course library", () => {
  it("offers dedicated create and import routes without rendering the importer", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return { courses: [] };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    for (const link of screen.getAllByRole("link", { name: "Создать курс" })) {
      expect(link).toHaveAttribute("href", "/courses/new");
    }
    for (const link of screen.getAllByRole("link", {
      name: "Импорт Course Pack",
    })) {
      expect(link).toHaveAttribute("href", "/courses/import");
    }
    expect(screen.queryByLabelText("JSON-файл")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Локальных курсов пока нет"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Aptiloop специально устанавливается без готовых курсов. Создайте собственный курс локально или импортируйте JSON Course Pack, которому доверяете.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Текущий курс не выбран"),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="empty-state"]')).toHaveLength(
      1,
    );
  });

  it("renders one row per Course and applies search without changing the current card", async () => {
    navigationState.search = "?keep=yes";
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "current-course",
              stableId: "current-course",
              title: "Current foundations",
              description: "The selected Course",
              primaryLocale: "en-US",
              selected: true,
              activeRevisionId: "current-v2",
              currentSessionId: null,
              revisions: [
                {
                  id: "current-v1",
                  revisionNumber: 1,
                  status: "archived",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: notStartedSummary,
                },
                {
                  id: "current-v2",
                  revisionNumber: 2,
                  status: "published",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: {
                    ...notStartedSummary,
                    state: "in-progress",
                    completedLessons: 2,
                    progressPercent: 50,
                    lastActivityAt: "2026-08-10T02:00:00.000Z",
                  },
                },
              ],
            },
            {
              id: "draft-course",
              stableId: "draft-course",
              title: "Draft systems",
              description: "Still being authored",
              primaryLocale: "en-US",
              selected: false,
              activeRevisionId: null,
              currentSessionId: null,
              revisions: [
                {
                  id: "draft-v1",
                  revisionNumber: 1,
                  status: "draft",
                  branchKind: "personal",
                  contentHash: null,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    const view = renderWithQuery(<CourseLibraryClient />);

    expect(
      await screen.findByRole("heading", { name: "Current foundations" }),
    ).toBeInTheDocument();
    expect(
      view.container.querySelector('[data-slot="course-current-summary"]'),
    ).toBeInTheDocument();
    expect(
      view.container.querySelector('[data-slot="course-current-summary"]'),
    ).toHaveClass(
      "flex-col",
      "@min-[48rem]/course-current:flex-row",
      "@min-[48rem]/course-current:justify-between",
    );
    expect(
      view.container.querySelector('[data-slot="course-library-table"]'),
    ).toBeInTheDocument();
    const libraryLayout = view.container.querySelector(
      ".\\@container\\/course-library",
    );
    expect(libraryLayout).toBeInTheDocument();
    expect(
      view.container.querySelector('[data-slot="table-header"]'),
    ).toHaveClass("@min-[60rem]/course-library:table-header-group");
    const currentRow = screen
      .getByRole("heading", { name: "Current foundations" })
      .closest("tr");
    expect(currentRow).not.toBeNull();
    expect(currentRow).toHaveClass(
      "grid",
      "@min-[60rem]/course-library:table-row",
    );
    expect(
      within(currentRow as HTMLElement).getByText("Текущий курс"),
    ).toBeVisible();
    const revisionsDisclosure = screen.getByRole("button", {
      name: "Current foundations: Ревизий: 2",
    });
    fireEvent.click(revisionsDisclosure);
    expect(
      within(screen.getByRole("listitem", { name: "Ревизия 1" })).getByRole(
        "button",
        { name: "Недоступно · Ревизия 1" },
      ),
    ).toBeDisabled();
    expect(
      within(screen.getByRole("listitem", { name: "Ревизия 2" })).getByRole(
        "link",
        { name: "Открыть · Ревизия 2" },
      ),
    ).toHaveAttribute("href", "/courses/current-course/revisions/current-v2");
    const progressRings = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        '[data-slot="course-progress-ring"]',
      ),
    );
    expect(progressRings).toHaveLength(2);
    expect(progressRings.map((ring) => ring.dataset.percent)).toEqual([
      "50",
      "0",
    ]);
    expect(
      progressRings.map(
        (ring) =>
          ring.querySelector('[data-slot="course-progress-value"]')
            ?.textContent,
      ),
    ).toEqual(["50%", "0%"]);
    expect(progressRings[0]).toHaveClass("size-11", "shrink-0");
    expect(
      within(currentRow as HTMLElement).getByRole("button", {
        name: "Другие действия для курса «Current foundations»",
      }),
    ).toHaveClass("size-11", "shrink-0", "md:size-11");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.getByText("Показано 1–2 из 2")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск курсов" }), {
      target: { value: "Draft" },
    });

    expect(replaceMock).toHaveBeenLastCalledWith("/courses?keep=yes&q=Draft", {
      scroll: false,
    });
    expect(
      screen.queryByRole("heading", { name: "Current foundations" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Draft systems" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Показано 1–1 из 1")).toBeInTheDocument();
    expect(screen.getAllByText("Текущий курс").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск курсов" }), {
      target: { value: "" },
    });
    expect(replaceMock).toHaveBeenLastCalledWith("/courses?keep=yes", {
      scroll: false,
    });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Фильтр" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Опубликован" }),
    );

    expect(pushMock).toHaveBeenLastCalledWith(
      "/courses?keep=yes&filter=published",
      { scroll: false },
    );
    expect(
      screen.getByRole("heading", { name: "Current foundations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Draft systems" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a three-digit completed percentage centered in the fixed ring", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "complete-course",
              stableId: "complete-course",
              title: "Complete foundations",
              description:
                "A deliberately long completion description that must not resize the progress ring.",
              primaryLocale: "en-US",
              selected: true,
              activeRevisionId: "complete-v1",
              currentSessionId: null,
              revisions: [
                {
                  id: "complete-v1",
                  revisionNumber: 1,
                  status: "published",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: {
                    state: "completed",
                    completedLessons: 12,
                    totalLessons: 12,
                    progressPercent: 100,
                    lastActivityAt: "2026-08-10T02:00:00.000Z",
                  },
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    const view = renderWithQuery(<CourseLibraryClient />);
    expect(
      await screen.findByRole("heading", { name: "Complete foundations" }),
    ).toBeInTheDocument();
    const ring = view.container.querySelector<HTMLElement>(
      '[data-slot="course-progress-ring"]',
    );
    expect(ring).toHaveAttribute("data-percent", "100");
    expect(ring).toHaveClass("size-11", "shrink-0");
    expect(
      ring?.querySelector('[data-slot="course-progress-value"]'),
    ).toHaveTextContent("100%");
  });

  it("shows storage recovery without hiding the readable local library", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: false, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "draft-course",
              stableId: "draft-course",
              title: "Readable local draft",
              description: null,
              primaryLocale: "en-US",
              selected: false,
              activeRevisionId: null,
              currentSessionId: null,
              revisions: [
                {
                  id: "draft-revision",
                  revisionNumber: 1,
                  status: "draft",
                  branchKind: "personal",
                  contentHash: null,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    expect(
      await screen.findByRole("heading", { name: "Readable local draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Локальное хранилище курсов недоступно"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть Core и локальные пути" }),
    ).toHaveAttribute("href", "/settings?section=advanced");
    expect(
      screen.getByRole("button", { name: "Повторить проверку хранилища" }),
    ).toBeInTheDocument();
  });

  it("fails a stale selected archived revision closed while preserving history", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "stale-course",
              stableId: "stale-course",
              title: "Archived selection",
              description: "Selection points at history, not a learning target",
              primaryLocale: "en-US",
              selected: true,
              activeRevisionId: "archived-revision",
              currentSessionId: null,
              revisions: [
                {
                  id: "archived-revision",
                  revisionNumber: 1,
                  status: "archived",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    const currentSummary = await screen.findByText("Ревизия курса недоступна");
    expect(currentSummary).toBeInTheDocument();
    expect(
      currentSummary.closest('[data-slot="course-current-summary"]'),
    ).not.toHaveTextContent("Открыть");
    const row = screen
      .getByRole("heading", { name: "Archived selection" })
      .closest("tr");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByRole("button", { name: "Недоступно" }),
    ).toBeDisabled();
  });

  it("matches status filters against every immutable Course revision", async () => {
    navigationState.search = "?filter=archived";
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "course-history",
              stableId: "course-history",
              title: "Course with history",
              description: null,
              primaryLocale: "en-US",
              selected: true,
              activeRevisionId: "published-revision",
              currentSessionId: null,
              revisions: [
                {
                  id: "archived-revision",
                  revisionNumber: 1,
                  status: "archived",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: notStartedSummary,
                },
                {
                  id: "published-revision",
                  revisionNumber: 2,
                  status: "published",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    expect(
      await screen.findByRole("heading", { name: "Course with history" }),
    ).toBeInTheDocument();
    const row = screen
      .getByRole("heading", { name: "Course with history" })
      .closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Ревизия 1")).toBeVisible();
    expect(within(row as HTMLElement).getByText("Архивный")).toBeVisible();
    expect(
      within(row as HTMLElement).getByRole("button", { name: "Недоступно" }),
    ).toBeDisabled();
    expect(
      within(row as HTMLElement).queryByRole("link", { name: "Открыть" }),
    ).not.toBeInTheDocument();
  });

  it("restores search, filter, and pagination from browser history and reloads", async () => {
    const courses = [
      ...Array.from({ length: 9 }, (_, index) => {
        const number = index + 1;
        const suffix = String(number).padStart(2, "0");
        return {
          id: `draft-course-${suffix}`,
          stableId: `draft-course-${suffix}`,
          title: `Course ${suffix}`,
          description: `Draft ${suffix}`,
          primaryLocale: "en-US",
          selected: false,
          activeRevisionId: null,
          currentSessionId: null,
          revisions: [
            {
              id: `draft-revision-${suffix}`,
              revisionNumber: 1,
              status: "draft" as const,
              branchKind: "personal" as const,
              contentHash: null,
              learningSummary: notStartedSummary,
            },
          ],
        };
      }),
      {
        id: "published-course-10",
        stableId: "published-course-10",
        title: "Course 10",
        description: "Published 10",
        primaryLocale: "en-US",
        selected: false,
        activeRevisionId: "published-revision-10",
        currentSessionId: null,
        revisions: [
          {
            id: "published-revision-10",
            revisionNumber: 1,
            status: "published" as const,
            branchKind: "upstream" as const,
            contentHash,
            learningSummary: notStartedSummary,
          },
        ],
      },
    ];
    navigationState.search = "?q=Course&filter=draft&page=2&keep=yes";
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") return { courses };
      throw new Error(`Unexpected API call: ${path}`);
    });

    const view = renderWithQuery(<CourseLibraryClient />);

    expect(
      await screen.findByRole("heading", { name: "Course 09" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Course 01" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("searchbox", { name: "Поиск курсов" }),
    ).toHaveValue("Course");
    expect(screen.getByText("Показано 9–9 из 9")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "Страницы курсов" }),
      ).getByText("2"),
    ).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Фильтр" }), {
      button: 0,
      ctrlKey: false,
    });
    const draftFilter = await screen.findByRole("menuitemradio", {
      name: "Черновик",
    });
    expect(draftFilter).toHaveAttribute("aria-checked", "true");
    expect(draftFilter).toHaveClass("min-h-11", "md:min-h-9", "md:py-1.5");
    fireEvent.keyDown(document, { key: "Escape" });

    navigationState.search = "?q=Course&filter=draft&keep=yes";
    view.rerender(<CourseLibraryClient />);
    expect(
      await screen.findByRole("heading", { name: "Course 01" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Course 09" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Показано 1–8 из 9")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    replaceMock.mockClear();
    navigationState.search = "?q=Course&filter=draft&page=2&keep=yes";
    view.rerender(<CourseLibraryClient />);
    expect(
      await screen.findByRole("heading", { name: "Course 09" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Показано 9–9 из 9")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("canonicalizes malformed and default library URL state without losing search or unrelated parameters", async () => {
    navigationState.search = "?q=Course&filter=unknown&page=0&keep=yes";
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "course-query-state",
              stableId: "course-query-state",
              title: "Course query state",
              description: null,
              primaryLocale: "en-US",
              selected: false,
              activeRevisionId: null,
              currentSessionId: null,
              revisions: [
                {
                  id: "course-query-state/v1",
                  revisionNumber: 1,
                  status: "draft",
                  branchKind: "personal",
                  contentHash: null,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    const view = renderWithQuery(<CourseLibraryClient />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/courses?q=Course&keep=yes", {
        scroll: false,
      }),
    );
    expect(
      await screen.findByRole("searchbox", { name: "Поиск курсов" }),
    ).toHaveValue("Course");

    replaceMock.mockClear();
    navigationState.search = "?q=Course&filter=draft&page=2&keep=yes";
    view.rerender(<CourseLibraryClient />);
    expect(replaceMock).not.toHaveBeenCalledWith(
      "/courses?q=Course&filter=draft&page=2&keep=yes",
      expect.anything(),
    );

    navigationState.search = "?q=Course&filter=all&page=1&keep=yes";
    view.rerender(<CourseLibraryClient />);
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/courses?q=Course&keep=yes", {
        scroll: false,
      }),
    );
  });

  it("renders historical revisions with an unprefixed SHA-256 digest", async () => {
    const historicalHash = "b".repeat(64);
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "curriculum-legacy-bridge",
              stableId: "curriculum-legacy-bridge",
              title: "Legacy curriculum bridge",
              description: "Immutable migration history",
              primaryLocale: "und",
              selected: false,
              activeRevisionId: null,
              currentSessionId: null,
              revisions: [
                {
                  id: "curriculum-legacy-v1-r1",
                  revisionNumber: 1,
                  status: "archived",
                  branchKind: "upstream",
                  contentHash: historicalHash,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    expect(
      await screen.findByRole("heading", {
        name: "Legacy curriculum bridge",
      }),
    ).toBeInTheDocument();
    const row = screen
      .getByRole("heading", { name: "Legacy curriculum bridge" })
      .closest("tr");
    expect(row).not.toBeNull();
    expect(screen.queryByText(historicalHash)).not.toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByRole("button", { name: "Недоступно" }),
    ).toBeDisabled();
    fireEvent.pointerDown(
      within(row as HTMLElement).getByRole("button", {
        name: "Другие действия для курса «Legacy curriculum bridge»",
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Технические сведения" }),
    );
    expect(screen.getByText(historicalHash)).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Открыть" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Не удалось получить данные"),
    ).not.toBeInTheDocument();
  });

  it("keeps locally created drafts discoverable through Studio", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "course-draft",
              stableId: "course-draft",
              title: "Draft course",
              description: null,
              primaryLocale: "ru-RU",
              selected: false,
              activeRevisionId: null,
              currentSessionId: null,
              revisions: [
                {
                  id: "draft/revision-1",
                  revisionNumber: 1,
                  status: "draft",
                  branchKind: "personal",
                  contentHash: null,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    const draftHeading = await screen.findByRole("heading", {
      name: "Draft course",
    });
    const draftRow = draftHeading.closest("tr");
    expect(draftRow).not.toBeNull();
    expect(
      within(draftRow as HTMLElement).getByRole("link", {
        name: "Редактировать",
      }),
    ).toHaveAttribute("href", "/courses/studio?version=draft%2Frevision-1");
    expect(
      within(draftRow as HTMLElement).getByRole("button", {
        name: "Другие действия для курса «Draft course»",
      }),
    ).toBeInTheDocument();
  });

  it("retains Studio access for published authoring revisions", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "course-available",
              stableId: "course-available",
              title: "Available course",
              description: "A published revision ready to select",
              primaryLocale: "en-US",
              selected: false,
              activeRevisionId: null,
              currentSessionId: null,
              revisions: [
                {
                  id: "revision-available",
                  revisionNumber: 2,
                  status: "published",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: notStartedSummary,
                },
              ],
            },
          ],
        };
      }
      if (path === "/learning/courses/course-available/select") {
        return {
          selected: true,
          courseId: "course-available",
          revisionId: "revision-available",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithQuery(<CourseLibraryClient />);

    const heading = await screen.findByRole("heading", {
      name: "Available course",
    });
    const row = heading.closest("tr");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByRole("link", {
        name: "Открыть",
      }),
    ).toHaveAttribute(
      "href",
      "/courses/course-available/revisions/revision-available",
    );
    expect(
      within(row as HTMLElement).queryByRole("menuitem", {
        name: "Сделать текущей",
      }),
    ).not.toBeInTheDocument();

    fireEvent.pointerDown(
      within(row as HTMLElement).getByRole("button", {
        name: "Другие действия для курса «Available course»",
      }),
      { button: 0, ctrlKey: false },
    );
    expect(
      await screen.findByRole("menuitem", {
        name: "Открыть в Adaptive Studio",
      }),
    ).toHaveAttribute("href", "/courses/studio?version=revision-available");
    fireEvent.click(screen.getByRole("menuitem", { name: "Сделать текущей" }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/courses/course-available/select",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"revisionId":"revision-available"'),
        }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Эта ревизия курса стала текущей. Главная будет использовать её детерминированный маршрут и следующее действие.",
    );
  });

  it("keeps revision export scoped and deletes the Course only after confirmation", async () => {
    let deletionBlocked = true;
    const invalidateQueries = vi.spyOn(
      QueryClient.prototype,
      "invalidateQueries",
    );
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return {
          storageAvailable: true,
          packs: [
            {
              courseId: "course-1",
              courseKey: "course-1",
              title: "Course one",
              revisionId: "revision-1",
              revisionNumber: 1,
              contentHash,
              revisionStatus: "published",
              lifecycleAction: "install",
              importedAt: "2026-08-10T00:00:00.000Z",
            },
            {
              courseId: "course-1",
              courseKey: "course-1",
              title: "Course one",
              revisionId: "revision-2",
              revisionNumber: 2,
              contentHash,
              revisionStatus: "published",
              lifecycleAction: "install",
              importedAt: "2026-08-11T00:00:00.000Z",
            },
          ],
        };
      }
      if (path === "/learning/courses") {
        return {
          courses: [
            {
              id: "course-1",
              stableId: "course-1",
              title: "Course one",
              description: null,
              primaryLocale: "en-US",
              selected: true,
              activeRevisionId: "revision-2",
              currentSessionId: "session-1",
              revisions: [
                {
                  id: "revision-1",
                  revisionNumber: 1,
                  status: "published",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: notStartedSummary,
                },
                {
                  id: "revision-2",
                  revisionNumber: 2,
                  status: "published",
                  branchKind: "upstream",
                  contentHash,
                  learningSummary: {
                    state: "in-progress",
                    completedLessons: 1,
                    totalLessons: 4,
                    progressPercent: 25,
                    lastActivityAt: "2026-08-10T01:00:00.000Z",
                  },
                },
              ],
            },
          ],
        };
      }
      if (path === "/course-packs/delete") {
        if (deletionBlocked) {
          deletionBlocked = false;
          throw Object.assign(
            new Error("Course is pinned by an active learning session"),
            { code: "active_session", status: 409 },
          );
        }
        return { archived: true };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 500 }));

    renderWithQuery(<CourseLibraryClient />);
    const courseHeading = await screen.findByRole("heading", {
      name: "Course one",
      level: 3,
    });
    const courseRow = courseHeading.closest("tr");
    expect(courseRow).not.toBeNull();
    expect(
      within(courseRow as HTMLElement).getByRole("link", {
        name: "Продолжить",
      }),
    ).toHaveAttribute("href", "/session?id=session-1");
    expect(
      within(courseRow as HTMLElement).getByRole("img", {
        name: "Выполнено 25%, уроков завершено: 1 из 4",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Открыть в Adaptive Studio" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);

    const disclosure = screen.getByRole("button", {
      name: "Course one: Ревизий: 2",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("aria-controls");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");

    const revisionOne = screen.getByRole("listitem", {
      name: "Ревизия 1",
    });
    const revisionTwo = screen.getByRole("listitem", {
      name: "Ревизия 2",
    });
    expect(
      within(revisionOne).getByRole("link", {
        name: "Открыть · Ревизия 1",
      }),
    ).toHaveAttribute("href", "/courses/course-1/revisions/revision-1");
    expect(
      within(revisionTwo).getByRole("link", {
        name: "Открыть · Ревизия 2",
      }),
    ).toHaveAttribute("href", "/courses/course-1/revisions/revision-2");
    expect(
      screen.queryByRole("link", {
        name: "Открыть в Adaptive Studio",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(revisionOne).getByRole("button", {
        name: "Экспорт · Ревизия 1",
      }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Не удалось экспортировать (500)",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/course-packs/export?revisionId=revision-1",
      { headers: { "X-Aptiloop-Client": "web" } },
    );
    expect(
      screen.getByRole("heading", { name: "Course one" }),
    ).toBeInTheDocument();

    expect(
      within(revisionTwo).queryByRole("button", { name: /Удалить/u }),
    ).not.toBeInTheDocument();

    fireEvent.pointerDown(
      within(courseRow as HTMLElement).getByRole("button", {
        name: "Другие действия для курса «Course one»",
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Удалить курс" }),
    );
    expect(
      await screen.findByRole("alertdialog", {
        name: "Удалить курс без возможности восстановления?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Курс «Course one» и все его ревизии исчезнут/u),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Завершите активное занятие перед удалением курса. Aptiloop не прервёт и не отбросит активную сессию.",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    fireEvent.pointerDown(
      within(courseRow as HTMLElement).getByRole("button", {
        name: "Другие действия для курса «Course one»",
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Удалить курс" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Удалить навсегда" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/course-packs/delete",
        expect.objectContaining({
          method: "POST",
          body: expect.stringMatching(
            /"courseId":"course-1".*"confirmCourseKey":"course-1"/u,
          ),
        }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Курс удалён из раздела «Курсы». Восстановить его из библиотеки нельзя.",
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["learning-path"],
    });
  });
});

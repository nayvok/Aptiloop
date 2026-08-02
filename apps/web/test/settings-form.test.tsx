import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsForm } from "@/components/settings-form";

const { apiMock, setThemeMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  setThemeMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "system",
    resolvedTheme: "light",
    setTheme: setThemeMock,
  }),
}));

const settingsResponse = {
  workspaceRoot: "C:/trusted/exercises",
  zedExecutable: "zed",
  opencodeBaseUrl: "http://127.0.0.1:4096",
  teacherProvider: "mock",
  teacherModel: "mock-deterministic",
  reviewerProvider: "opencode",
  reviewerModel: "oc-model",
  interviewerProvider: "opencode",
  interviewerModel: "oc-model",
  curatorProvider: "mock",
  curatorModel: "mock-deterministic",
  codexExpertProvider: "codex",
  codexExpertModel: "codex-model",
  theme: "system",
  providers: [
    {
      id: "mock",
      status: "connected",
      models: [{ id: "mock-deterministic", name: "Mock" }],
    },
    {
      id: "opencode",
      status: "connected",
      models: [
        { id: "oc-model", name: "OpenCode Model" },
        { id: "oc-model-2", name: "OpenCode Model 2" },
      ],
    },
    {
      id: "codex",
      status: "connected",
      models: [
        { id: "codex-model", name: "Codex Model" },
        { id: "codex-model-2", name: "Codex Model 2" },
      ],
    },
  ],
};

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  setThemeMock.mockReset();
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/settings" && init?.method === "PUT")
      return Promise.resolve({ saved: true });
    if (path === "/settings") return Promise.resolve(settingsResponse);
    return Promise.resolve({ providers: [] });
  });
});

afterEach(cleanup);

describe("SettingsForm", () => {
  it("renders the four sections with role names, profiles and read-only paths", async () => {
    renderForm();

    expect(
      await screen.findByRole("heading", { name: "Основные" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "AI для обучения" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Подключения" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Для разработчика" }),
    ).toBeInTheDocument();

    for (const label of [
      "Преподаватель",
      "Проверка решения",
      "Интервьюер",
      "Итоги и повторение",
      "Эксперт",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    expect(
      screen.getByRole("radio", { name: /Экономный/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Сбалансированный/u }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Максимальная точность/u }),
    ).toBeInTheDocument();

    expect(screen.getByText("C:/trusted/exercises")).toBeInTheDocument();
    expect(screen.getByText("zed")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Инструменты разработчика" }),
    ).toHaveAttribute("href", "/settings/developer-tools");
    expect(screen.getByRole("link", { name: "Открыть" })).toHaveAttribute(
      "href",
      "/settings/developer-tools",
    );
    expect(screen.getByText("Health check")).toBeInTheDocument();
  });

  it("applies the accuracy profile to reviewer, interviewer, curator and expert", async () => {
    renderForm();

    fireEvent.click(
      await screen.findByRole("radio", { name: /Максимальная точность/u }),
    );
    fireEvent.click(screen.getByText("Расширенные настройки"));

    const reviewer = screen.getByRole("group", { name: "Проверка решения" });
    expect(within(reviewer).getByLabelText("Провайдер")).toHaveValue("codex");
    expect(within(reviewer).getByLabelText("Модель")).toHaveValue(
      "codex-model",
    );
    const interviewer = screen.getByRole("group", { name: "Интервьюер" });
    expect(within(interviewer).getByLabelText("Провайдер")).toHaveValue(
      "codex",
    );
    const expert = screen.getByRole("group", { name: "Эксперт" });
    expect(within(expert).getByLabelText("Провайдер")).toHaveValue("codex");
    expect(within(expert).getByLabelText("Модель")).toHaveValue("codex-model");
    const teacher = screen.getByRole("group", { name: "Преподаватель" });
    expect(within(teacher).getByLabelText("Провайдер")).toHaveValue("opencode");
    expect(within(teacher).getByLabelText("Модель")).toHaveValue("oc-model");

    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить настройки" }),
    );
    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) => path === "/settings" && init?.method === "PUT",
      );
      expect(mutation).toBeDefined();
      const body = JSON.parse(String(mutation?.[1]?.body)) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        teacherProvider: "opencode",
        teacherModel: "oc-model",
        reviewerProvider: "codex",
        reviewerModel: "codex-model",
        interviewerProvider: "codex",
        curatorProvider: "codex",
        codexExpertProvider: "codex",
        codexExpertModel: "codex-model",
      });
    });
  });

  it("keeps roles unchanged and shows a note when the profile provider has no models", async () => {
    apiMock.mockResolvedValue({
      ...settingsResponse,
      providers: [
        {
          id: "mock",
          status: "connected",
          models: [{ id: "mock-deterministic", name: "Mock" }],
        },
        { id: "opencode", status: "connected", models: [] },
        {
          id: "codex",
          status: "connected",
          models: [
            { id: "codex-model", name: "Codex Model", available: false },
          ],
        },
      ],
    });
    renderForm();

    fireEvent.click(await screen.findByRole("radio", { name: /Экономный/u }));

    expect(
      await screen.findByText(/Профиль применён частично/u),
    ).toBeInTheDocument();
    const teacher = screen.getByRole("group", { name: "Преподаватель" });
    expect(within(teacher).getByLabelText("Провайдер")).toHaveValue("mock");
    expect(within(teacher).getByLabelText("Модель")).toHaveValue(
      "mock-deterministic",
    );
    const expert = screen.getByRole("group", { name: "Эксперт" });
    expect(within(expert).getByLabelText("Провайдер")).toHaveValue("codex");
  });
});

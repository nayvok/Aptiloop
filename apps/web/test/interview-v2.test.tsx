import {
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

import { InterviewClient } from "@/components/interview-client";
import {
  PageRouteContextProvider,
  type PageRouteContextRegistration,
} from "@/components/page-route-context";
import { ReviewClient } from "@/components/review-client";
import { LocaleProvider } from "@/lib/i18n";

const { ApiErrorMock, apiMock, pushMock, replaceMock, searchState } =
  vi.hoisted(() => {
    class TestApiError extends Error {
      readonly status: number;

      constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
      }
    }

    return {
      ApiErrorMock: TestApiError,
      apiMock: vi.fn(),
      pushMock: vi.fn(),
      replaceMock: vi.fn(),
      searchState: { value: "" },
    };
  });

vi.mock("@/lib/api", () => ({ ApiError: ApiErrorMock, api: apiMock }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/review",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchState.value),
}));

const now = "2026-08-01T00:00:00.000Z";

function pendingDisclosureFixture(
  continuation:
    | {
        kind: "start";
        learningSessionId: string | null;
        interviewId: string;
        operationId: string;
      }
    | {
        kind: "answer";
        learningSessionId: string | null;
        interviewId: string;
        questionId: string;
        operationId: string;
      },
) {
  return {
    kind: "disclosure" as const,
    required: true as const,
    continuation,
    disclosure: {
      operationId: `disclosure:${continuation.kind}-1`,
      status: "pending" as const,
      createdAt: now,
      expiresAt: "2026-08-01T00:05:00.000Z",
      scope: {
        destination: "External interviewer",
        payloadCategories:
          continuation.kind === "start"
            ? (["course-content"] as const)
            : (["course-content", "learner-message"] as const),
        byteCount: 512,
        exclusions: ["credentials", "absolute local paths"],
      },
    },
  };
}

function disclosureAcknowledgement(
  pending: ReturnType<typeof pendingDisclosureFixture>,
  status: "approved" | "cancelled",
) {
  return {
    disclosure: {
      operationId: pending.disclosure.operationId,
      scope: {
        role: "evaluator" as const,
        connectionId: "conn:external",
        providerType: "openai",
        modelId: "model-exact",
        destination: pending.disclosure.scope.destination,
        payloadCategories: [...pending.disclosure.scope.payloadCategories],
        entityIds: {},
        exclusions: pending.disclosure.scope.exclusions,
        byteCount: pending.disclosure.scope.byteCount,
        payloadSha256: `sha256:${"a".repeat(64)}`,
      },
      status,
      createdAt: pending.disclosure.createdAt,
      approvedAt: status === "approved" ? now : null,
      consumedAt: null,
      expiresAt: pending.disclosure.expiresAt,
    },
  };
}

interface TranscriptMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
}

function interviewFixture({
  learningSessionId = null as string | null,
  status = "in_progress",
  transcript = [
    {
      id: "question-1",
      role: "assistant" as const,
      content:
        "Чем lexical scope отличается от dynamic scope? Ответьте за две минуты.",
      createdAt: now,
    },
  ],
  questionCount = 2,
  report = null as ReturnType<typeof reportFixture> | null,
}: {
  learningSessionId?: string | null;
  status?: string;
  transcript?: TranscriptMessage[];
  questionCount?: number;
  report?: ReturnType<typeof reportFixture> | null;
} = {}) {
  const questionsAsked = transcript.filter(
    (message) => message.role === "assistant",
  ).length;
  const questionsAnswered = transcript.filter(
    (message) => message.role === "user",
  ).length;
  return {
    id: "interview-1",
    learningSessionId,
    resumeOperationId: status === "setup" ? "operation-1" : null,
    status,
    setup: {
      topics: ["JavaScript", "TypeScript"],
      difficulty: "interview-ready" as const,
      questionCount,
    },
    transcript,
    progress: {
      questionsAsked,
      questionsAnswered,
      readyToFinish:
        questionsAsked === questionCount &&
        questionsAnswered === questionsAsked,
    },
    report,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
  };
}

function currentInterviewResponse(
  interview: ReturnType<typeof interviewFixture> | null,
  learningSessionId = interview?.learningSessionId ?? null,
) {
  return { learningSessionId, interview };
}

function reportFixture() {
  return {
    interviewId: "interview-1",
    status: "completed" as const,
    summary:
      "Интервью завершено. Техническая корректность отдельно не оценивалась.",
    topics: ["JavaScript", "TypeScript"],
    metrics: {
      questionsAsked: 2,
      questionsAnswered: 2,
      completionRate: 1,
    },
    strengths: ["Оба ответа содержат рассуждение."],
    growthAreas: ["Добавлять минимальный пример."],
    evidence: [
      {
        questionNumber: 1,
        topic: "JavaScript",
        answerExcerpt: "Lexical scope определяется местом объявления.",
        observation: "Ответ содержит развёрнутое рассуждение.",
      },
      {
        questionNumber: 2,
        topic: "TypeScript",
        answerExcerpt: "Narrowing уточняет тип после проверки.",
        observation: "Ответ содержит развёрнутое рассуждение.",
      },
    ],
  };
}

function transcriptWithFirstAnswer() {
  return [
    {
      id: "question-1",
      role: "assistant" as const,
      content:
        "Чем lexical scope отличается от dynamic scope? Ответьте за две минуты.",
      createdAt: now,
    },
    {
      id: "answer-1",
      role: "user" as const,
      content: "Lexical scope определяется местом объявления функции.",
      createdAt: now,
    },
    {
      id: "question-2",
      role: "assistant" as const,
      content:
        "Как TypeScript narrowing меняет доступный тип? Ответьте за минуту.",
      createdAt: now,
    },
  ];
}

function transcriptComplete() {
  return [
    ...transcriptWithFirstAnswer(),
    {
      id: "answer-2",
      role: "user" as const,
      content: "Narrowing уточняет union после runtime-проверки.",
      createdAt: now,
    },
  ];
}

function learningPathFixture() {
  return {
    curriculum: {
      weeks: [
        {
          order: 1,
          days: [
            {
              status: "in_progress",
              topics: ["JavaScript", "Скоуп"],
              units: [{ status: "completed" }, { status: "in_progress" }],
            },
            {
              status: "available",
              topics: ["TypeScript", "Narrowing"],
              units: [{ status: "ready" }],
            },
          ],
        },
        {
          order: 2,
          days: [
            {
              status: "locked",
              topics: ["Promises"],
              units: [{ status: "locked" }],
            },
          ],
        },
      ],
    },
  };
}

const interviewBudgets = {
  maxInputBytes: 128_000,
  maxOutputBytes: 256_000,
  maxEvents: 1_000,
  maxToolCalls: 4,
  deadlineMs: 120_000,
};

function interviewAiSettings({
  mode = "connection" as "connection" | "no-ai",
  state = "connected",
  modelAvailable = true,
} = {}) {
  return {
    ai: {
      connections: [
        {
          connectionId: "conn:mock",
          adapterId: "mock",
          providerType: "mock",
          displayName: "Deterministic Mock",
          credentialRef: null,
          endpointProfileId: null,
          enabled: true,
          external: false,
          state,
          lastCheckedAt: now,
          observedCapabilities: {
            providerType: "mock",
            adapterVersion: "test",
            observedAt: now,
            connection: {
              authenticated: true,
              streaming: true,
              cancellation: true,
            },
            models: [
              {
                modelId: "mock-deterministic",
                available: modelAvailable,
                contextTokens: 128_000,
                outputTokens: 16_000,
                typedToolCalls: "schema-constrained" as const,
                parallelToolCalls: false,
                attachments: ["text"] as const,
              },
            ],
          },
        },
      ],
      roleProfiles: [
        {
          role: "evaluator",
          mode,
          connectionId: mode === "connection" ? "conn:mock" : null,
          modelId: mode === "connection" ? "mock-deterministic" : null,
          requiredCapabilities:
            mode === "connection"
              ? (["streaming", "models", "cancellation"] as const)
              : [],
          toolPolicyId: "apt.role.evaluator.v1",
          budgets: interviewBudgets,
        },
      ],
    },
  };
}

type ApiRoute = unknown | ((init?: RequestInit) => unknown);

function installApi(routes: Record<string, ApiRoute>) {
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    const route = routes[path];
    if (route === undefined) {
      return Promise.reject(new Error(`Unexpected api call: ${path}`));
    }
    return Promise.resolve(
      typeof route === "function"
        ? (route as (init?: RequestInit) => unknown)(init)
        : route,
    );
  });
}

function interviewRoutes({
  current = currentInterviewResponse(null),
  opened,
  answers,
  finish,
  extra = {},
}: {
  current?: unknown;
  opened?: unknown;
  answers?: ApiRoute;
  finish?: unknown;
  extra?: Record<string, ApiRoute>;
} = {}) {
  return {
    "/settings": interviewAiSettings(),
    "/learning/path": learningPathFixture(),
    "/interviews/v2/current": current,
    "/interviews/v2": opened,
    "/interviews/v2/interview-1/answers": answers,
    "/interviews/v2/interview-1/finish": finish,
    ...extra,
  };
}

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        {children}
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
  replaceMock.mockReset();
  searchState.value = "";
  window.localStorage.clear();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  let id = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => `operation-${++id}`) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("versioned interview workflow", () => {
  it("keeps localized standalone orientation while loading and after failure", async () => {
    apiMock.mockReturnValueOnce(new Promise(() => undefined));
    const loading = renderWithQuery(<InterviewClient />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Техническое интервью",
      }),
    ).toBeVisible();
    expect(screen.getByText("Загружаю интервью…")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    loading.unmount();

    apiMock.mockRejectedValueOnce(new Error("raw interview endpoint failure"));
    renderWithQuery(<InterviewClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить интервью. Повторите попытку.",
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Техническое интервью",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText("raw interview endpoint failure")).toBeNull();
  });

  it("keeps the setup usable when browser draft storage is blocked", async () => {
    const storage = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    installApi(interviewRoutes());

    try {
      renderWithQuery(<InterviewClient />);

      fireEvent.click(
        await screen.findByRole("radio", { name: /Выбрать вручную/u }),
      );
      const topics = screen.getByLabelText("Темы через запятую");
      fireEvent.change(topics, { target: { value: "TypeScript" } });

      expect(topics).toHaveValue("TypeScript");
      expect(
        screen.getByRole("button", { name: "Начать интервью" }),
      ).toBeEnabled();
    } finally {
      cleanup();
      if (storage) Object.defineProperty(window, "localStorage", storage);
    }
  });

  it("registers Course and Lesson breadcrumbs only after validating the linked session", async () => {
    searchState.value = "sessionId=session-1";
    const register = vi.fn<PageRouteContextRegistration>(() => vi.fn());
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(null),
        extra: {
          "/interviews/v2/current?learningSessionId=session-1":
            currentInterviewResponse(null, "session-1"),
          "/learning/sessions/v2/session-1": {
            session: {
              id: "session-1",
              courseContext: {
                courseId: "private-course-id",
                revisionId: "private-revision-id",
              },
              snapshot: {
                curriculumId: "snapshot-course-id",
                curriculumVersionId: "snapshot-revision-id",
                curriculumTitle: "JavaScript Foundations",
                day: { order: 3, title: "Closures and scope" },
              },
            },
          },
        },
      }),
    );

    renderWithQuery(
      <PageRouteContextProvider
        register={register}
        routeKey="/interview?sessionId=session-1"
      >
        <InterviewClient />
      </PageRouteContextProvider>,
    );

    await screen.findByRole("radio", { name: /Только изученные/u });
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    const context = register.mock.calls.at(-1)?.[1];
    expect(context).toMatchObject({
      sectionHref: "/courses",
      breadcrumbs: [
        { href: "/courses", label: "nav.courses" },
        {
          href: "/courses/private-course-id/revisions/private-revision-id",
          text: "JavaScript Foundations",
        },
        {
          href: "/session?id=session-1",
          text: "Урок 3 · Closures and scope",
        },
        { label: "interview.title" },
      ],
    });
    expect(JSON.stringify(context?.breadcrumbs)).not.toContain(
      '"text":"private-',
    );
  });

  it("registers linked Course and Lesson breadcrumbs for an id-only interview URL", async () => {
    searchState.value = "id=interview-1";
    const register = vi.fn<PageRouteContextRegistration>(() => vi.fn());
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/interview-1": interviewFixture({
            learningSessionId: "session-1",
          }),
          "/learning/sessions/v2/session-1": {
            session: {
              id: "session-1",
              courseContext: {
                courseId: "private-course-id",
                revisionId: "private-revision-id",
              },
              snapshot: {
                curriculumId: "snapshot-course-id",
                curriculumVersionId: "snapshot-revision-id",
                curriculumTitle: "JavaScript Foundations",
                day: { order: 3, title: "Closures and scope" },
              },
            },
          },
        },
      }),
    );

    renderWithQuery(
      <PageRouteContextProvider
        register={register}
        routeKey="/interview?id=interview-1"
      >
        <InterviewClient />
      </PageRouteContextProvider>,
    );

    await screen.findByText(/Чем lexical scope отличается/u);
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    const context = register.mock.calls.at(-1)?.[1];
    expect(context).toMatchObject({
      sectionHref: "/courses",
      breadcrumbs: [
        { href: "/courses", label: "nav.courses" },
        {
          href: "/courses/private-course-id/revisions/private-revision-id",
          text: "JavaScript Foundations",
        },
        {
          href: "/session?id=session-1",
          text: "Урок 3 · Closures and scope",
        },
        { label: "interview.title" },
      ],
    });
    expect(apiMock).toHaveBeenCalledWith("/learning/sessions/v2/session-1");
    expect(JSON.stringify(context?.breadcrumbs)).not.toContain(
      '"text":"private-',
    );
  });

  it("treats an empty sessionId as standalone", async () => {
    searchState.value = "sessionId=";
    const register = vi.fn<PageRouteContextRegistration>(() => vi.fn());
    installApi(interviewRoutes());

    renderWithQuery(
      <PageRouteContextProvider
        register={register}
        routeKey="/interview?sessionId="
      >
        <InterviewClient />
      </PageRouteContextProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Техническое интервью",
      }),
    ).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith("/interviews/v2/current");
    expect(apiMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/learning\/sessions\/v2\//u),
    );
    expect(register).not.toHaveBeenCalled();
  });

  it("runs setup, sequential questions, answers, finish and renders the persisted report", async () => {
    const opened = interviewFixture();
    const followedUp = interviewFixture({
      transcript: transcriptWithFirstAnswer(),
    });
    const ready = interviewFixture({ transcript: transcriptComplete() });
    const report = reportFixture();
    const completed = interviewFixture({
      status: "completed",
      transcript: transcriptComplete(),
      report,
    });
    installApi(
      interviewRoutes({
        opened,
        answers: (init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as { answer: string };
          return body.answer.includes("Narrowing") ? ready : followedUp;
        },
        finish: { interview: completed, report },
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("radio", { name: /Только изученные/ }),
    ).toBeChecked();
    expect(
      screen.getByText(/отчёт фиксирует наблюдения об ответах/u),
    ).toHaveTextContent(/не подтверждает техническую корректность/u);
    expect(await screen.findByText("Скоуп")).toBeInTheDocument();
    expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Выбрать вручную/ }));
    fireEvent.change(await screen.findByLabelText("Темы через запятую"), {
      target: { value: "JavaScript, TypeScript" },
    });
    fireEvent.click(screen.getByLabelText("Количество вопросов"));
    fireEvent.click(await screen.findByRole("option", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "Начать интервью" }));

    expect(
      await screen.findByText(/Чем lexical scope отличается/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Чем lexical scope отличается от dynamic scope?",
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "operation-1",
          topics: ["JavaScript", "TypeScript"],
          difficulty: "interview-ready",
          questionCount: 2,
        }),
      }),
    );

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: {
        value: "Lexical scope определяется местом объявления функции.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    expect(
      await screen.findByText(/Как TypeScript narrowing/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Как TypeScript narrowing меняет доступный тип?",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Чем lexical scope отличается от dynamic scope?",
    );

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Narrowing уточняет union после runtime-проверки." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Завершить и открыть отчёт",
      }),
    );

    expect(await screen.findByText("Отчёт по интервью")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Наблюдения об ответах",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Фрагменты ответов и наблюдения",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Подтверждения навыка")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Оценена структура и полнота ответа\. Техническая корректность не проверялась\./u,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Оба ответа содержат рассуждение."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Добавлять минимальный пример."),
    ).toBeInTheDocument();
    const firstEvidence = screen.getByRole("button", {
      name: /Вопрос 1.*JavaScript/u,
    });
    expect(firstEvidence).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(firstEvidence);
    expect(screen.getByText(/Lexical scope определяется/u)).toBeVisible();
    expect(screen.getByText(/100\s%/u)).toBeInTheDocument();
    const reportComposition = document.querySelector(
      '[data-slot="interview-report"] article',
    );
    expect(reportComposition).toBeInTheDocument();
    expect(reportComposition?.querySelector("footer")).toContainElement(
      screen.getByRole("button", { name: "Новое интервью" }),
    );
    expect(apiMock).toHaveBeenLastCalledWith(
      "/interviews/v2/interview-1/finish",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "operation-4" }),
      }),
    );
  }, 10_000);

  it("starts with the topics of studied days in the default scope", async () => {
    installApi(
      interviewRoutes({
        opened: interviewFixture(),
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("radio", { name: /Только изученные/ }),
    ).toBeChecked();
    expect(await screen.findByText("JavaScript")).toBeInTheDocument();
    expect(screen.getByText("Скоуп")).toBeInTheDocument();
    expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();
    expect(screen.queryByText("Promises")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Начать интервью" }));

    expect(
      await screen.findByText(/Чем lexical scope отличается/u),
    ).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "operation-1",
          topics: ["JavaScript", "Скоуп"],
          difficulty: "interview-ready",
          questionCount: 3,
        }),
      }),
    );
  });

  it("shows the manual topics field when the manual scope is selected", async () => {
    installApi(interviewRoutes());

    renderWithQuery(<InterviewClient />);

    expect(
      screen.queryByLabelText("Темы через запятую"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("radio", { name: /Выбрать вручную/ }),
    );
    expect(
      await screen.findByLabelText("Темы через запятую"),
    ).toBeInTheDocument();
  });

  it("restores every unsent setup field after a reload in the same validated scope", async () => {
    installApi(interviewRoutes());

    const firstRender = renderWithQuery(<InterviewClient />);
    fireEvent.click(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    );
    fireEvent.change(screen.getByLabelText("Темы через запятую"), {
      target: { value: "Event loop, Promises" },
    });
    fireEvent.click(screen.getByLabelText("Сложность"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Глубокий разбор" }),
    );
    fireEvent.click(screen.getByLabelText("Количество вопросов"));
    fireEvent.click(await screen.findByRole("option", { name: "5" }));

    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem("dlh-interview-v2-setup-draft") ?? "null",
        ),
      ).toEqual({
        version: 1,
        drafts: [
          {
            learningSessionId: null,
            scopeMode: "manual",
            topicsInput: "Event loop, Promises",
            difficulty: "deep-dive",
            questionCount: 5,
          },
        ],
      });
    });

    firstRender.unmount();
    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    ).toBeChecked();
    expect(screen.getByLabelText("Темы через запятую")).toHaveValue(
      "Event loop, Promises",
    );
    expect(screen.getByLabelText("Сложность")).toHaveTextContent(
      "Глубокий разбор",
    );
    expect(screen.getByLabelText("Количество вопросов")).toHaveTextContent("5");
  });

  it("restores an unsent answer only for the exact interview session and question", async () => {
    searchState.value = "sessionId=session-1";
    const current = currentInterviewResponse(
      interviewFixture({ learningSessionId: "session-1" }),
    );
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-1": current,
        },
      }),
    );

    const firstRender = renderWithQuery(<InterviewClient />);
    fireEvent.change(await screen.findByLabelText("Сообщение"), {
      target: { value: "Черновик ответа до отправки." },
    });
    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem("dlh-interview-v2-answer-draft") ??
            "null",
        ),
      ).toEqual({
        version: 1,
        drafts: [
          {
            learningSessionId: "session-1",
            interviewId: "interview-1",
            questionId: "question-1",
            answer: "Черновик ответа до отправки.",
          },
        ],
      });
    });

    firstRender.unmount();
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByLabelText("Сообщение")).toHaveValue(
      "Черновик ответа до отправки.",
    );
  });

  it("isolates setup and answer drafts while preserving A through an A to B to A transition", async () => {
    searchState.value = "sessionId=session-a";
    window.localStorage.setItem(
      "dlh-interview-v2-setup-draft",
      JSON.stringify({
        version: 1,
        drafts: [
          {
            learningSessionId: "session-a",
            scopeMode: "manual",
            topicsInput: "Session A topic",
            difficulty: "deep-dive",
            questionCount: 12,
          },
        ],
      }),
    );
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-a":
            currentInterviewResponse(null, "session-a"),
        },
      }),
    );

    const setupARender = renderWithQuery(<InterviewClient />);
    expect(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    ).toBeChecked();
    expect(screen.getByLabelText("Темы через запятую")).toHaveValue(
      "Session A topic",
    );
    setupARender.unmount();

    searchState.value = "sessionId=session-b";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-b":
            currentInterviewResponse(null, "session-b"),
        },
      }),
    );
    const setupBRender = renderWithQuery(<InterviewClient />);
    expect(
      await screen.findByRole("radio", { name: /Только изученные/u }),
    ).toBeChecked();
    expect(screen.queryByText("Session A topic")).not.toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(
        window.localStorage.getItem("dlh-interview-v2-setup-draft") ?? "null",
      ) as { drafts?: Array<{ learningSessionId: string }> } | null;
      expect(saved?.drafts?.map((draft) => draft.learningSessionId)).toEqual([
        "session-a",
        "session-b",
      ]);
    });
    setupBRender.unmount();

    searchState.value = "sessionId=session-a";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-a":
            currentInterviewResponse(null, "session-a"),
        },
      }),
    );
    const restoredSetupARender = renderWithQuery(<InterviewClient />);
    expect(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    ).toBeChecked();
    expect(screen.getByLabelText("Темы через запятую")).toHaveValue(
      "Session A topic",
    );
    restoredSetupARender.unmount();

    window.localStorage.setItem(
      "dlh-interview-v2-answer-draft",
      JSON.stringify({
        version: 1,
        drafts: [
          {
            learningSessionId: "session-a",
            interviewId: "interview-1",
            questionId: "question-1",
            answer: "Session A answer",
          },
        ],
      }),
    );
    searchState.value = "sessionId=session-b";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-b":
            currentInterviewResponse(
              interviewFixture({ learningSessionId: "session-b" }),
            ),
        },
      }),
    );
    const answerBRender = renderWithQuery(<InterviewClient />);

    expect(await screen.findByLabelText("Сообщение")).toHaveValue("");
    expect(
      JSON.parse(
        window.localStorage.getItem("dlh-interview-v2-answer-draft") ?? "null",
      ),
    ).toEqual({
      version: 1,
      drafts: [
        {
          learningSessionId: "session-a",
          interviewId: "interview-1",
          questionId: "question-1",
          answer: "Session A answer",
        },
      ],
    });
    answerBRender.unmount();

    searchState.value = "sessionId=session-a";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-a":
            currentInterviewResponse(
              interviewFixture({ learningSessionId: "session-a" }),
            ),
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByLabelText("Сообщение")).toHaveValue(
      "Session A answer",
    );
  });

  it("clears setup and answer records only after their accepted mutations", async () => {
    installApi(
      interviewRoutes({
        opened: interviewFixture(),
        answers: interviewFixture({ transcript: transcriptWithFirstAnswer() }),
      }),
    );
    renderWithQuery(<InterviewClient />);

    fireEvent.click(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    );
    fireEvent.change(screen.getByLabelText("Темы через запятую"), {
      target: { value: "JavaScript" },
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem("dlh-interview-v2-setup-draft"),
      ).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Начать интервью" }));

    expect(await screen.findByLabelText("Сообщение")).toBeInTheDocument();
    expect(
      window.localStorage.getItem("dlh-interview-v2-setup-draft"),
    ).toBeNull();
    expect(window.localStorage.getItem("dlh-interview-v2-start")).toBeNull();

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Lexical scope определяется местом объявления." },
    });
    expect(
      window.localStorage.getItem("dlh-interview-v2-answer-draft"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));

    expect(await screen.findByText(/Как TypeScript narrowing/u)).toBeVisible();
    expect(
      window.localStorage.getItem("dlh-interview-v2-answer-draft"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("dlh-interview-v2-pending-answer"),
    ).toBeNull();
  });

  it.each([
    [
      "AI Off",
      interviewAiSettings({ mode: "no-ai" }),
      "AI выключен",
      "/settings?section=ai",
    ],
    [
      "unavailable connection",
      interviewAiSettings({ state: "unavailable" }),
      "AI требует внимания",
      "/settings?section=connections",
    ],
  ])(
    "blocks setup with an honest %s recovery state",
    async (_case, settings, status, href) => {
      installApi({ ...interviewRoutes(), "/settings": settings });
      renderWithQuery(<InterviewClient />);

      expect(await screen.findByText(status)).toBeInTheDocument();
      const recovery = document.querySelector(
        '[data-slot="interview-ai-recovery"]',
      );
      expect(recovery).toHaveAttribute("data-variant", "warning");
      expect(recovery).toHaveClass("rounded-panel", "px-4", "py-4");
      const start = screen.getByRole("button", { name: "Начать интервью" });
      expect(start).toBeDisabled();
      expect(
        screen.getByRole("link", { name: "Настроить AI" }),
      ).toHaveAttribute("href", href);
      fireEvent.click(start);
      expect(apiMock).not.toHaveBeenCalledWith(
        "/interviews/v2",
        expect.anything(),
      );
    },
  );

  it("keeps a configured, not-yet-tested evaluator usable when its exact model and capabilities are available", async () => {
    installApi({
      ...interviewRoutes(),
      "/settings": interviewAiSettings({ state: "degraded" }),
    });
    renderWithQuery(<InterviewClient />);

    const start = await screen.findByRole("button", {
      name: "Начать интервью",
    });
    await waitFor(() => expect(start).toBeEnabled());
    expect(
      document.querySelector('[data-slot="interview-ai-recovery"]'),
    ).toBeNull();
  });

  it("explains an empty studied scope and offers manual topics", async () => {
    const path = learningPathFixture();
    const firstDay = path.curriculum.weeks[0]?.days[0];
    if (firstDay) {
      firstDay.units = [{ status: "ready" }, { status: "ready" }];
    }
    installApi({
      ...interviewRoutes(),
      "/learning/path": path,
    });

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByText(/Пока нет изученных тем/u),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Выбрать вручную" }));
    expect(
      await screen.findByLabelText("Темы через запятую"),
    ).toBeInTheDocument();
  });

  it("announces a failed topic-scope load and keeps recovery actions available", async () => {
    installApi({
      ...interviewRoutes(),
      "/learning/path": () => {
        throw new Error("offline-path-secret");
      },
    });

    renderWithQuery(<InterviewClient />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось загрузить темы маршрута");
    expect(alert).not.toHaveTextContent("offline-path-secret");
    expect(
      within(alert).getByRole("button", { name: "Повторить" }),
    ).toBeEnabled();
    expect(
      within(alert).getByRole("button", { name: "Выбрать вручную" }),
    ).toBeEnabled();
  });

  it("restores the current interview and its pending question after remount", async () => {
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(
          interviewFixture({
            transcript: transcriptWithFirstAnswer(),
          }),
        ),
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByText(/Как TypeScript narrowing/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Вопрос 2 из 2")).toBeVisible();
    expect(screen.getByText("Отвечено: 1 из 2")).toBeVisible();
    expect(
      document.querySelectorAll('[data-slot="interview-question-progress"]'),
    ).toHaveLength(1);
    const answeredProgress = screen.getByRole("progressbar", {
      name: "Отвечено: 1 из 2",
    });
    expect(answeredProgress).toHaveAttribute("aria-valuenow", "1");
    expect(answeredProgress).toHaveAttribute("aria-valuemax", "2");
    expect(screen.getByLabelText("Сообщение")).toHaveValue("");
    expect(apiMock).toHaveBeenCalledWith("/interviews/v2/current");
  });

  it("restores a staged start disclosure after remount and approves the exact retry", async () => {
    const pending = pendingDisclosureFixture({
      kind: "start",
      learningSessionId: null,
      interviewId: "interview-1",
      operationId: "operation-1",
    });
    const opened = interviewFixture({ questionCount: 3 });
    installApi(
      interviewRoutes({
        opened: (init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            disclosureOperationId?: string;
          };
          return body.disclosureOperationId ? opened : pending;
        },
        extra: {
          "/ai/disclosures/disclosure%3Astart-1/approve":
            disclosureAcknowledgement(pending, "approved"),
        },
      }),
    );
    const first = renderWithQuery(<InterviewClient />);

    fireEvent.click(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    );
    fireEvent.change(screen.getByLabelText("Темы через запятую"), {
      target: { value: "JavaScript, TypeScript" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Начать интервью" }));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(window.localStorage.getItem("dlh-interview-v2-start")).not.toContain(
      "disclosure:",
    );
    first.unmount();

    apiMock.mockClear();
    const recoveryPath =
      "/interviews/v2/interview-1/disclosures/pending?kind=start&operationId=operation-1";
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(
          interviewFixture({
            status: "setup",
            transcript: [],
            questionCount: 3,
          }),
        ),
        opened: (init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as {
            disclosureOperationId?: string;
          };
          return body.disclosureOperationId ? opened : pending;
        },
        extra: {
          [recoveryPath]: pending,
          "/ai/disclosures/disclosure%3Astart-1/approve":
            disclosureAcknowledgement(pending, "approved"),
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith(recoveryPath);
    fireEvent.click(screen.getByRole("button", { name: "Разрешить один раз" }));
    expect(
      await screen.findByText(/Чем lexical scope отличается/u),
    ).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          topics: ["JavaScript", "TypeScript"],
          difficulty: "interview-ready",
          questionCount: 3,
          operationId: "operation-1",
          disclosureOperationId: "disclosure:start-1",
        }),
      }),
    );
    expect(window.localStorage.getItem("dlh-interview-v2-start")).toBeNull();
  });

  it("restores an answer disclosure and the exact saved retry after remount", async () => {
    const pending = pendingDisclosureFixture({
      kind: "answer",
      learningSessionId: null,
      interviewId: "interview-1",
      questionId: "question-1",
      operationId: "operation-1",
    });
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
        answers: pending,
      }),
    );
    const first = renderWithQuery(<InterviewClient />);
    const savedAnswer = "Lexical scope определяется местом объявления функции.";
    fireEvent.change(await screen.findByLabelText("Сообщение"), {
      target: { value: savedAnswer },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    first.unmount();

    apiMock.mockClear();
    const recoveryPath =
      "/interviews/v2/interview-1/disclosures/pending?kind=answer&operationId=operation-1&questionId=question-1";
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(
          interviewFixture({
            transcript: transcriptWithFirstAnswer().slice(0, 2),
          }),
        ),
        answers: interviewFixture({ transcript: transcriptWithFirstAnswer() }),
        extra: {
          [recoveryPath]: pending,
          "/ai/disclosures/disclosure%3Aanswer-1/approve":
            disclosureAcknowledgement(pending, "approved"),
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alertdialog")).toBeVisible();
    expect(screen.getByLabelText("Сообщение")).toHaveValue(savedAnswer);
    expect(apiMock).toHaveBeenCalledWith(recoveryPath);
    fireEvent.click(screen.getByRole("button", { name: "Разрешить один раз" }));
    expect(await screen.findByText(/Как TypeScript narrowing/u)).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2/interview-1/answers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "operation-1",
          answer: savedAnswer,
          disclosureOperationId: "disclosure:answer-1",
        }),
      }),
    );
    expect(
      window.localStorage.getItem("dlh-interview-v2-pending-answer"),
    ).toBeNull();
  });

  it("keeps the disclosure open until cancellation is confirmed", async () => {
    let resolveCancel!: (value: unknown) => void;
    const cancel = new Promise((resolve) => {
      resolveCancel = resolve;
    });
    const pending = pendingDisclosureFixture({
      kind: "start",
      learningSessionId: null,
      interviewId: "interview-1",
      operationId: "operation-1",
    });
    installApi(
      interviewRoutes({
        opened: pending,
        extra: {
          "/ai/disclosures/disclosure%3Astart-1/cancel": () => cancel,
          "/interviews/v2/interview-1/abandon": {
            abandoned: {
              interviewId: "interview-1",
              operationId: "operation-1",
            },
          },
        },
      }),
    );
    renderWithQuery(<InterviewClient />);
    const start = await screen.findByRole("button", {
      name: "Начать интервью",
    });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await screen.findByRole("alertdialog")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Не отправлять" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith(
      "/ai/disclosures/disclosure%3Astart-1/cancel",
      { method: "POST", body: "{}" },
    );
    resolveCancel(disclosureAcknowledgement(pending, "cancelled"));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem("dlh-interview-v2-start"),
    ).not.toBeNull();
  });

  it("rejects a recovered disclosure whose continuation crosses session scope", async () => {
    searchState.value = "sessionId=session-a";
    const interview = interviewFixture({
      learningSessionId: "session-a",
      transcript: transcriptWithFirstAnswer().slice(0, 2),
    });
    window.localStorage.setItem(
      "dlh-interview-v2-pending-answer",
      JSON.stringify({
        version: 1,
        drafts: [
          {
            learningSessionId: "session-a",
            interviewId: "interview-1",
            questionId: "question-1",
            operationId: "operation-1",
            answer: "Сохранённый ответ.",
          },
        ],
      }),
    );
    const recoveryPath =
      "/interviews/v2/interview-1/disclosures/pending?kind=answer&operationId=operation-1&questionId=question-1&learningSessionId=session-a";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-a":
            currentInterviewResponse(interview, "session-a"),
          [recoveryPath]: pendingDisclosureFixture({
            kind: "answer",
            learningSessionId: "session-b",
            interviewId: "interview-1",
            questionId: "question-1",
            operationId: "operation-1",
          }),
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Следующий вопрос не получен",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([path]) => String(path).includes("/approve")),
    ).toBe(false);
    expect(
      window.localStorage.getItem("dlh-interview-v2-pending-answer"),
    ).not.toBeNull();
  });

  it("keeps the standalone H1 and suppresses the duplicate embedded header", async () => {
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Техническое интервью",
      }),
    ).toBeInTheDocument();

    cleanup();
    searchState.value = "view=interviews";
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
      }),
    );
    renderWithQuery(<ReviewClient />);

    await screen.findByText(/Чем lexical scope отличается/u);
    expect(
      screen.queryByRole("heading", { name: "Техническое интервью" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Повторение" }),
    ).toBeInTheDocument();

    const destinationSurface = document.querySelector(
      '[data-slot="review-destination-navigation"]',
    );
    expect(destinationSurface).toHaveClass(
      "gap-3",
      "rounded-panel",
      "bg-surface-soft/45",
    );
    expect(destinationSurface).not.toHaveClass("border");
    const destinationNav = within(destinationSurface as HTMLElement);
    const desktopNav = destinationSurface?.querySelector(
      '[data-slot="review-desktop-nav"]',
    );
    const mobileNav = destinationSurface?.querySelector(
      '[data-slot="review-mobile-nav"]',
    );
    expect(desktopNav).toHaveClass("hidden", "grid-cols-4", "xl:grid");
    expect(desktopNav).toHaveClass("bg-transparent", "p-0");
    expect(desktopNav).not.toHaveClass("shadow-sm");
    expect(desktopNav).toHaveAttribute("data-variant", "segmented");
    expect(mobileNav).toHaveClass("xl:hidden");
    expect(within(desktopNav as HTMLElement).getAllByRole("tab")).toHaveLength(
      4,
    );

    const activeDestination = within(desktopNav as HTMLElement).getByRole(
      "tab",
      { name: "Интервью" },
    );
    expect(activeDestination).toHaveClass(
      "min-h-11",
      "text-[0.9375rem]",
      "shadow-none",
    );
    expect(activeDestination).toHaveAttribute("aria-current", "page");
    expect(activeDestination).toHaveAttribute("data-active", "true");
    expect(activeDestination).toHaveAttribute("role", "tab");
    expect(activeDestination.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(desktopNav as HTMLElement).getByRole("tab", {
        name: "К повторению",
      }),
    ).toHaveAttribute("data-active", "false");

    const mobileDestination = destinationNav.getByRole("combobox", {
      name: "Повторение",
    });
    expect(mobileDestination).toHaveTextContent("Интервью");

    activeDestination.focus();
    fireEvent.keyDown(activeDestination, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/review?view=cards", {
        scroll: false,
      });
    });
  });

  it("preserves unrelated Review parameters and canonicalizes an invalid view", async () => {
    searchState.value = "view=interviews&source=home";
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
      }),
    );
    const view = renderWithQuery(<ReviewClient />);

    await screen.findByText(/Чем lexical scope отличается/u);
    fireEvent.mouseDown(
      screen.getByRole("tab", { name: "Очередь повторения" }),
      { button: 0 },
    );
    expect(pushMock).toHaveBeenLastCalledWith(
      "/review?view=cards&source=home",
      { scroll: false },
    );

    view.unmount();
    searchState.value = "view=unknown&source=home";
    installApi(interviewRoutes());
    renderWithQuery(<ReviewClient />);
    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith("/review?source=home", {
        scroll: false,
      });
    });
  });

  it("keeps the answer and operation id available when the provider fails", async () => {
    let answerAttempts = 0;
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
        answers: () => {
          answerAttempts += 1;
          if (answerAttempts === 1) {
            throw new Error(
              "Interviewer provider failed. Your transcript was preserved.",
            );
          }
          return interviewFixture({
            transcript: [
              {
                id: "question-1",
                role: "assistant" as const,
                content: "Чем lexical scope отличается?",
                createdAt: now,
              },
              {
                id: "answer-1",
                role: "user" as const,
                content: "Ответ, который нельзя потерять.",
                createdAt: now,
              },
            ],
          });
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    fireEvent.change(await screen.findByLabelText("Сообщение"), {
      target: { value: "Ответ, который нельзя потерять." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ответ сохранён в форме");
    expect(alert).not.toHaveTextContent("Interviewer provider failed");
    expect(screen.getByLabelText("Сообщение")).toHaveValue(
      "Ответ, который нельзя потерять.",
    );
    const persisted = JSON.parse(
      window.localStorage.getItem("dlh-interview-v2-pending-answer") ?? "null",
    ) as { drafts: Array<{ operationId: string; answer: string }> };
    expect(persisted.drafts[0]).toEqual(
      expect.objectContaining({
        operationId: "operation-1",
        answer: "Ответ, который нельзя потерять.",
      }),
    );
  });

  it("rejects protected fields recursively before leaked interview content is rendered", async () => {
    const leaked = interviewFixture() as ReturnType<typeof interviewFixture> & {
      nested?: { referenceAnswer: string };
    };
    leaked.nested = { referenceAnswer: "Скрытый эталон" };
    installApi(interviewRoutes({ current: currentInterviewResponse(leaked) }));

    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сохранённые данные интервью не прошли проверку",
    );
    expect(screen.queryByText("Скрытый эталон")).not.toBeInTheDocument();
  });

  it("renders chat bubbles, typing state and a single live pending question", async () => {
    let resolveAnswer!: (value: ReturnType<typeof interviewFixture>) => void;
    const nextQuestion = new Promise<ReturnType<typeof interviewFixture>>(
      (resolve) => {
        resolveAnswer = resolve;
      },
    );
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
        answers: () => nextQuestion,
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByText(/Чем lexical scope отличается/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Вопрос 1 из 2")).toBeVisible();
    expect(screen.getByText("Интервьюер")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Чем lexical scope отличается от dynamic scope?",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: {
        value: "Lexical scope определяется местом объявления функции.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    expect(await screen.findByText("Интервьюер печатает…")).toBeInTheDocument();
    resolveAnswer(
      interviewFixture({ transcript: transcriptWithFirstAnswer() }),
    );
    expect(
      await screen.findByText(/Как TypeScript narrowing/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Вопрос 2 из 2")).toBeVisible();
    expect(screen.getByText("Вы")).toBeInTheDocument();
    expect(screen.queryByText("Интервьюер печатает…")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Как TypeScript narrowing меняет доступный тип?",
    );
  });

  it("nests interview transcript Markdown headings below the page heading", async () => {
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(
          interviewFixture({
            transcript: [
              {
                id: "question-1",
                role: "assistant",
                content: "# First\n## Second\n### Third",
                createdAt: now,
              },
            ],
          }),
        ),
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "First" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Second" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 4, name: "Third" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 1, name: "First" }),
    ).not.toBeInTheDocument();
  });

  it("nests report Markdown headings below report section headings", async () => {
    const report = reportFixture();
    report.summary = "# First\n## Second\n### Third";
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(
          interviewFixture({
            status: "completed",
            transcript: transcriptComplete(),
            report,
          }),
        ),
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("heading", { level: 3, name: "First" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 4, name: "Second" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 5, name: "Third" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 1, name: "First" }),
    ).not.toBeInTheDocument();
  });

  it("sends with Enter and keeps Shift+Enter as a newline", async () => {
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(interviewFixture()),
        answers: () => interviewFixture(),
      }),
    );
    renderWithQuery(<InterviewClient />);
    const composer = await screen.findByLabelText("Сообщение");
    fireEvent.change(composer, { target: { value: "Мой ответ" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(apiMock).not.toHaveBeenCalledWith(
      "/interviews/v2/interview-1/answers",
      expect.anything(),
    );
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2/interview-1/answers",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a retry control when a saved answer awaits the next question", async () => {
    installApi(
      interviewRoutes({
        current: currentInterviewResponse(
          interviewFixture({
            transcript: transcriptWithFirstAnswer().slice(0, 2),
          }),
        ),
      }),
    );
    window.localStorage.setItem(
      "dlh-interview-v2-pending-answer",
      JSON.stringify({
        version: 1,
        drafts: [
          {
            learningSessionId: null,
            interviewId: "interview-1",
            questionId: "question-1",
            operationId: "operation-1",
            answer: "Lexical scope определяется местом объявления функции.",
          },
        ],
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("button", { name: "Повторить запрос" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Сообщение")).toHaveValue(
      "Lexical scope определяется местом объявления функции.",
    );
  });

  it.each([
    [
      "opening retry",
      currentInterviewResponse(
        interviewFixture({
          learningSessionId: "session-1",
          status: "setup",
          transcript: [],
        }),
      ),
    ],
    [
      "session",
      currentInterviewResponse(
        interviewFixture({ learningSessionId: "session-1" }),
      ),
    ],
    [
      "report",
      currentInterviewResponse(
        interviewFixture({
          learningSessionId: "session-1",
          status: "completed",
          transcript: transcriptComplete(),
          report: reportFixture(),
        }),
      ),
    ],
  ])("returns to the learning session from %s", async (_state, response) => {
    searchState.value = "sessionId=session-1";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-1": response,
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("link", { name: "Вернуться к занятию" }),
    ).toHaveAttribute("href", "/session?id=session-1");
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2/current?learningSessionId=session-1",
    );
  });

  it("does not derive a Return link from a validated query scope without an Interview association", async () => {
    searchState.value = "sessionId=session-1";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-1":
            currentInterviewResponse(null, "session-1"),
        },
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("radio", { name: /Только изученные/u }),
    ).toBeChecked();
    expect(
      screen.queryByRole("link", { name: "Вернуться к занятию" }),
    ).not.toBeInTheDocument();
  });

  it("uses the validated scope for creation and the persisted response association for Return", async () => {
    searchState.value = "sessionId=session-1";
    installApi(
      interviewRoutes({
        opened: interviewFixture({ learningSessionId: "session-1" }),
        extra: {
          "/interviews/v2/current?learningSessionId=session-1":
            currentInterviewResponse(null, "session-1"),
        },
      }),
    );

    renderWithQuery(<InterviewClient />);

    fireEvent.click(
      await screen.findByRole("radio", { name: /Выбрать вручную/u }),
    );
    fireEvent.change(screen.getByLabelText("Темы через запятую"), {
      target: { value: "JavaScript" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Начать интервью" }));

    expect(
      await screen.findByRole("link", { name: "Вернуться к занятию" }),
    ).toHaveAttribute("href", "/session?id=session-1");
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "operation-1",
          topics: ["JavaScript"],
          difficulty: "interview-ready",
          questionCount: 3,
          learningSessionId: "session-1",
        }),
      }),
    );
  });

  it("masks a latest report associated with another learning session", async () => {
    searchState.value = "sessionId=session-1";
    window.localStorage.setItem(
      "dlh-interview-v2-latest-id",
      JSON.stringify("interview-other"),
    );
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/current?learningSessionId=session-1":
            currentInterviewResponse(null, "session-1"),
          "/interviews/v2/interview-other?learningSessionId=session-1": () => {
            throw new ApiErrorMock("Interview not found.", 404);
          },
        },
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("radio", { name: /Только изученные/u }),
    ).toBeChecked();
    expect(screen.queryByText("Отчёт по интервью")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Вернуться к занятию" }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem("dlh-interview-v2-latest-id")).toBe(
      JSON.stringify("interview-other"),
    );
  });

  it("rejects a requested report whose server association mismatches the URL scope", async () => {
    searchState.value = "id=interview-9&sessionId=session-1";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/interview-9?learningSessionId=session-1":
            interviewFixture({
              learningSessionId: "session-other",
              status: "completed",
              transcript: transcriptComplete(),
              report: reportFixture(),
            }),
        },
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Это интервью не относится к запрошенной сессии занятия.",
    );
    expect(screen.queryByText("Отчёт по интервью")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Вернуться к занятию" }),
    ).not.toBeInTheDocument();
  });

  it("loads a requested saved interview and renders its report", async () => {
    searchState.value = "id=interview-9";
    installApi(
      interviewRoutes({
        extra: {
          "/interviews/v2/interview-9": interviewFixture({
            status: "completed",
            transcript: transcriptComplete(),
            report: { ...reportFixture(), interviewId: "interview-9" },
          }),
        },
      }),
    );
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByText("Отчёт по интервью")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/interviews/v2/interview-9");
  });

  it("shows a retryable error for an invalid requested interview id", async () => {
    searchState.value = "id=missing-interview";
    apiMock.mockImplementation((path: string) =>
      path === "/learning/path"
        ? Promise.resolve(learningPathFixture())
        : Promise.reject(new Error("Interview not found")),
    );
    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить интервью. Повторите попытку.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await vi.waitFor(() =>
      expect(
        apiMock.mock.calls.filter(
          ([path]) => path === "/interviews/v2/missing-interview",
        ),
      ).toHaveLength(2),
    );
  });
});

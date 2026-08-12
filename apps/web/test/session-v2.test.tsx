import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionClient } from "@/components/session-client";
import { LocaleProvider } from "@/lib/i18n";
import { lessonActivityDraftStorageKey } from "@/lib/lesson-activity-drafts";

const { apiMock, pushMock, searchState, streamAgentMock, toastErrorMock } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    pushMock: vi.fn(),
    searchState: { value: "id=session-v2" },
    streamAgentMock: vi.fn(async function* (): AsyncGenerator<
      Record<string, unknown>
    > {
      yield {
        type: "message.delta",
        turnId: "turn-1",
        content: "Уточняющий вопрос Teacher",
      };
      yield {
        type: "session.completed",
        turnId: "turn-1",
        reason: "completed",
      };
    }),
    toastErrorMock: vi.fn(),
  }));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  streamAgent: streamAgentMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(searchState.value),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

const now = "2026-08-01T00:00:00.000Z";
type UnitType =
  | "briefing"
  | "study"
  | "recall"
  | "teacher-dialogue"
  | "quiz"
  | "code-reading"
  | "exercise"
  | "review"
  | "interview"
  | "summary"
  | "checkpoint"
  | "spaced-review";
type UnitStatus = "locked" | "ready" | "in_progress" | "completed" | "skipped";

type ProgressPayloadFixture =
  | { type: "briefing"; acknowledged: boolean; checkedItemIds: string[] }
  | { type: "study"; checkedItemIds: string[]; notes: string }
  | {
      type: "recall";
      answers: Array<{
        questionId: string;
        draft: string;
        firstAttemptId: string;
      }>;
      draft: string;
      firstAttemptId: string | null;
    }
  | {
      type: "teacher-dialogue";
      conversationId: string | null;
      turnCount: number;
      revisionAttemptIds: string[];
    }
  | {
      type: "quiz";
      attemptedQuestionIds: string[];
      correctQuestionIds?: string[];
      score: number | null;
    }
  | {
      type: "code-reading";
      prediction: string;
      explanation: string;
      verbalFix: string;
    }
  | {
      type: "exercise";
      attemptId: string | null;
      latestTestRunId: string | null;
      latestReviewId: string | null;
    }
  | {
      type: "review";
      reviewId: string | null;
      reviewStatus: "pending" | "accepted" | "changes_requested" | null;
      reviewedDiffHash: string | null;
    }
  | {
      type: "interview";
      interviewSessionId: string | null;
      reportId: string | null;
    }
  | { type: "summary"; summaryId: string | null }
  | { type: "checkpoint"; acknowledged: boolean }
  | { type: "spaced-review"; reviewedTopicIds: string[] };

function unitPayload(type: UnitType) {
  switch (type) {
    case "briefing":
      return { type, scope: ["Без оптимизаций движка"] };
    case "study":
      return { type, body: "Прочитайте источник и повторите пример." };
    case "recall":
      return { type, prompt: "Объясните механизм по памяти." };
    case "teacher-dialogue":
      return {
        type,
        openingPrompt: "Найдите слабое место исходного объяснения.",
        minimumTurns: 1,
        requiresRevision: true,
      };
    case "quiz":
      return {
        type,
        questionIds: ["quiz-q1", "quiz-q2"],
        minimumScore: 0.5,
      };
    case "code-reading":
      return {
        type,
        snippet: "const next = { ...original };",
      };
    case "exercise":
      return {
        type,
        exerciseId: "exercise-1",
        acceptanceCriteria: ["Не мутировать input"],
        constraints: ["Без any"],
        template: "export function solve() {}",
        testCommandId: "test:exercise-1",
        hintPolicy: "progressive-0-to-5",
        reviewPolicy: "diff-and-tests-read-only",
      };
    case "review":
      return { type, exerciseUnitId: "exercise-unit" };
    case "interview":
      return { type, topics: ["scope"] };
    case "summary":
      return { type, prompts: ["Что изменилось в модели?"] };
    case "checkpoint":
      return { type, label: "Подтвердите checkpoint" };
    case "spaced-review":
      return { type, topicIds: ["scope"] };
  }
}

function progressPayload(type: UnitType): ProgressPayloadFixture {
  switch (type) {
    case "briefing":
      return { type, acknowledged: false, checkedItemIds: [] };
    case "study":
      return { type, checkedItemIds: [], notes: "" };
    case "recall":
      return { type, answers: [], draft: "", firstAttemptId: null };
    case "teacher-dialogue":
      return {
        type,
        conversationId: null,
        turnCount: 0,
        revisionAttemptIds: [],
      };
    case "quiz":
      return {
        type,
        attemptedQuestionIds: [],
        correctQuestionIds: [],
        score: null,
      };
    case "code-reading":
      return { type, prediction: "", explanation: "", verbalFix: "" };
    case "exercise":
      return {
        type,
        attemptId: null,
        latestTestRunId: null,
        latestReviewId: null,
      };
    case "review":
      return {
        type,
        reviewId: null,
        reviewStatus: null,
        reviewedDiffHash: null,
      };
    case "interview":
      return { type, interviewSessionId: null, reportId: null };
    case "summary":
      return { type, summaryId: null };
    case "checkpoint":
      return { type, acknowledged: false };
    case "spaced-review":
      return { type, reviewedTopicIds: [] };
  }
}

function questions(type: UnitType) {
  if (type === "quiz") {
    return [
      {
        id: "quiz-q1",
        kind: "multiple-choice",
        prompt: "Что является примитивом?",
        options: [
          { id: "q1-a", label: "string" },
          { id: "q1-b", label: "object" },
        ],
      },
      {
        id: "quiz-q2",
        kind: "multiple-choice",
        prompt: "Что делает spread объекта?",
        options: [
          { id: "q2-a", label: "Shallow copy" },
          { id: "q2-b", label: "Deep copy" },
        ],
      },
    ];
  }
  if (type === "recall") {
    return [
      {
        id: "recall-q1",
        kind: "explain",
        prompt: "Чем binding отличается от значения?",
        options: [],
      },
      {
        id: "recall-q2",
        kind: "explain",
        prompt: "Почему присваивание не меняет исходный binding?",
        options: [],
      },
    ];
  }
  if (type === "code-reading") {
    return [
      {
        id: "code-q1",
        kind: "predict-output",
        prompt: "Что изменится в original и почему?",
        options: [],
      },
    ];
  }
  return [];
}

function makeUnit(type: UnitType) {
  return {
    id: `unit-${type}`,
    stableId: `day-1-${type}`,
    type,
    title: `Юнит ${type}`,
    description: `Описание ${type}`,
    order: 1,
    estimatedMinutes: 10,
    objectives: ["Объяснить механизм"],
    checklist:
      type === "briefing" || type === "study"
        ? [
            {
              id: `${type}-required`,
              label: "Обязательный пункт",
              required: true,
            },
            {
              id: `${type}-optional`,
              label: "Дополнительный пункт",
              required: false,
            },
          ]
        : [],
    sources:
      type === "study"
        ? [
            {
              id: "source-mdn",
              title: "MDN: JavaScript data types",
              url: "https://developer.mozilla.org/docs/Web/JavaScript/Data_structures",
              kind: "documentation",
              required: true,
              estimatedMinutes: 12,
              learningGoal: "Разделить binding и value",
            },
          ]
        : [],
    questions: questions(type),
    completionCriteria:
      type === "briefing"
        ? [
            { type: "acknowledgement" },
            { type: "checklist", requiredItemIds: [`${type}-required`] },
          ]
        : type === "study"
          ? [{ type: "checklist", requiredItemIds: [`${type}-required`] }]
          : type === "quiz"
            ? [{ type: "score", minimum: 0.5, minimumAttempts: 2 }]
            : [{ type: "attempts", minimum: 1 }],
    unlockRules: [],
    optional: false,
    depthLevel: "foundation",
    payload: unitPayload(type),
  };
}

function makeSession(
  type: UnitType,
  status: UnitStatus = "in_progress",
  payload: ProgressPayloadFixture = progressPayload(type),
) {
  return {
    id: "session-v2",
    status: status === "completed" ? "completed" : "active",
    currentStep: status === "completed" ? "complete" : `day-1-${type}`,
    snapshot: {
      schemaVersion: 2,
      contentHash: "sha256-session",
      curriculumId: "curriculum-1",
      curriculumVersionId: "curriculum-version-2",
      curriculumRevision: 2,
      curriculumTitle: "JavaScript foundations",
      week: {
        id: "week-id",
        stableId: "week-1",
        order: 1,
        title: "Фундамент языка",
        description: "Первая неделя",
      },
      day: {
        id: "day-id",
        stableId: "day-1",
        order: 1,
        title: "Значения, типы и объекты",
        description: "Описание дня",
        goal: "Построить точную причинную модель",
        estimatedMinutes: 180,
        prerequisites: [],
        expectedOutcomes: ["Объяснить механизм"],
        depthLevel: "foundation",
        outOfScope: ["Оптимизация движка"],
        topics: ["JavaScript"],
      },
      units: [makeUnit(type)],
      capturedAt: now,
    },
    unitProgress: [
      {
        unitId: `unit-${type}`,
        unitType: type,
        status,
        payload,
        startedAt: status === "ready" ? null : now,
        completedAt: status === "completed" ? now : null,
        skippedAt: null,
        updatedAt: now,
      },
    ],
  };
}

type SessionFixture = ReturnType<typeof makeSession>;

function activityDraftKey(session: SessionFixture) {
  const unit = session.snapshot.units[0];
  if (!unit) throw new Error("Draft fixture is incomplete");
  return lessonActivityDraftStorageKey({
    learningSessionId: session.id,
    currentStep: session.currentStep,
    revisionId: session.snapshot.curriculumVersionId,
    snapshotId: session.snapshot.contentHash,
    snapshotHash: session.snapshot.contentHash,
    activityId: unit.id,
    activityStableId: unit.stableId,
    activityType: unit.type,
  });
}

function replaceProgress(
  session: SessionFixture,
  status: UnitStatus,
  payload: ProgressPayloadFixture,
): SessionFixture {
  const currentProgress = session.unitProgress[0];
  if (!currentProgress) throw new Error("Fixture progress is missing");
  return {
    ...session,
    status: status === "completed" ? "completed" : "active",
    currentStep: status === "completed" ? "complete" : session.currentStep,
    unitProgress: [
      {
        ...currentProgress,
        status,
        payload,
        startedAt: status === "ready" ? null : now,
        completedAt: status === "completed" ? now : null,
      },
    ],
  };
}

function makeSummaryResponse(
  session: SessionFixture,
  evidenceId = "summary-1",
) {
  return {
    summary: {
      sessionId: session.id,
      occurredAt: now,
      masteryEvidence: [],
      strengths: ["Тесты и проверка решения пройдены"],
      gaps: ["Точнее объяснять shallow copy"],
      mistakeCandidates: [
        {
          fingerprint: "mistake-shallow-copy",
          summary: "Смешаны shallow и deep copy",
          correction: "Spread копирует только верхний уровень",
          sourceId: "quiz-q2",
        },
      ],
      flashcardCandidates: [
        {
          front: "Что копирует object spread?",
          back: "Только верхний уровень объекта.",
          sourceFingerprint: "mistake-shallow-copy",
        },
      ],
      narrative: "День завершён на основе сохранённых подтверждений навыка.",
      metrics: {
        topicCount: 1,
        evidenceCount: 6,
        correctEvidenceCount: 3,
        partialEvidenceCount: 2,
        incorrectEvidenceCount: 1,
        attemptedActivityCount: 5,
        quizScore: 0.5,
        maxHintLevel: 2,
        exerciseTestsPassed: true,
        reviewStatus: "passed",
        correctionCycleCount: 1,
      },
    },
    evidence: { id: evidenceId },
    session,
  };
}

function makeMultiSession(
  entries: Array<{ type: UnitType; status: UnitStatus }>,
): SessionFixture {
  const first = entries[0];
  if (!first) throw new Error("Multi-session fixture needs at least one unit");
  const base = makeSession(first.type, first.status);
  const current =
    entries.find((entry) => entry.status === "in_progress") ??
    entries.find((entry) => entry.status === "ready");
  return {
    ...base,
    status: current ? "active" : "completed",
    currentStep: current ? `day-1-${current.type}` : "complete",
    snapshot: {
      ...base.snapshot,
      units: entries.map((entry) => makeUnit(entry.type)),
    },
    unitProgress: entries.map((entry) => ({
      unitId: `unit-${entry.type}`,
      unitType: entry.type,
      status: entry.status,
      payload: progressPayload(entry.type),
      startedAt: entry.status === "ready" ? null : now,
      completedAt: entry.status === "completed" ? now : null,
      skippedAt: null,
      updatedAt: now,
    })),
  };
}

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
          {children}
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  };
}

function mockTeacherDialogueApi() {
  const session = makeSession("teacher-dialogue");
  const revised = replaceProgress(session, "in_progress", {
    type: "teacher-dialogue",
    conversationId: null,
    turnCount: 1,
    revisionAttemptIds: ["operation-1"],
  });
  apiMock.mockImplementation((path: string) => {
    if (path === "/learning/sessions/v2/session-v2") {
      return Promise.resolve({ session });
    }
    if (path === "/learning/sessions/v2/session-v2/teacher-transcript") {
      return Promise.resolve({ messages: [] });
    }
    if (
      path === "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue"
    ) {
      return Promise.resolve({ session: revised });
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
  streamAgentMock.mockClear();
  toastErrorMock.mockReset();
  window.localStorage.clear();
  searchState.value = "id=session-v2";
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

describe("guided versioned session", () => {
  it("keeps the active unit in focus with a responsive lesson plan", async () => {
    apiMock.mockResolvedValue({ session: makeSession("briefing") });
    renderWithQuery(<SessionClient />);

    const trigger = await screen.findByRole("button", { name: /Шаги урока/u });
    expect(trigger).toBeVisible();
    expect(trigger).toHaveClass("@min-[72rem]/lesson:hidden");
    // The plan stays beside the work when the lesson container is wide enough
    // and moves into a sheet below that available-width threshold.
    expect(document.querySelector('[data-slot="day-plan-sheet"]')).toBeNull();
    const focus = document.querySelector('[data-slot="lesson-focus"]');
    const rail = document.querySelector('[data-slot="day-plan-rail"]');
    expect(within(focus as HTMLElement).getByText("Брифинг")).toBeVisible();
    expect(within(focus as HTMLElement).queryByText("Цель")).toBeNull();
    expect(rail).toHaveClass(
      "hidden",
      "@min-[72rem]/lesson:block",
      "sticky",
      "h-[calc(100dvh-var(--shell-bar-size,4.5rem))]",
      "overflow-y-auto",
      "overscroll-contain",
      "[scrollbar-gutter:stable]",
    );
    expect(rail).toHaveAccessibleName("Шаги урока");
    expect(rail).toHaveTextContent("Урок 1 · Значения, типы и объекты");

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    const plan = document.querySelector('[data-slot="day-plan-sheet"]');
    const summary = plan?.querySelector('[data-slot="day-plan-summary"]');
    const stepper = plan?.querySelector('[data-slot="day-plan-stepper"]');
    const activeBlock = plan?.querySelector(
      '[data-slot="plan-block"][data-status="in_progress"]',
    );
    const activeStep = plan?.querySelector(
      '[data-slot="plan-step"][data-status="in_progress"]',
    );
    expect(plan).toHaveTextContent("Этапы обучения");
    expect(summary).toHaveTextContent("0 / 1");
    expect(stepper).toContainElement(activeBlock as HTMLElement);
    expect(activeBlock).toHaveAttribute("aria-current", "step");
    expect(activeStep).toHaveAttribute("aria-current", "step");
    expect(plan).toHaveTextContent("Построить точную причинную модель");
    expect(plan).toHaveTextContent("Темы");
    expect(plan).toHaveTextContent("Ожидаемые результаты");
    expect(plan).toHaveTextContent("Вне занятия");
    expect(plan).toHaveTextContent("Брифинг");
    expect(
      plan?.querySelector('[data-slot="day-plan-goal"]'),
    ).not.toHaveAttribute("open");
    expect(
      plan?.querySelector('[data-slot="day-plan-topics"]'),
    ).not.toHaveAttribute("open");
  });

  it("shows completed, active, and locked phases as one vertical plan", async () => {
    const session = {
      ...makeMultiSession([
        { type: "briefing", status: "completed" },
        { type: "study", status: "completed" },
        { type: "quiz", status: "in_progress" },
        { type: "exercise", status: "locked" },
      ]),
      status: "active" as const,
      currentStep: "day-1-quiz",
    };
    apiMock.mockResolvedValue({ session });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Этап 2 из 3 · Подтвердить · Активность 1 из 1"),
    ).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: /Шаги урока/u }));
    await screen.findByRole("dialog");

    expect(
      document.querySelector('[data-slot="plan-block"][data-block="study"]'),
    ).toHaveAttribute("data-status", "completed");
    expect(
      document.querySelector('[data-slot="plan-block"][data-block="check"]'),
    ).toHaveAttribute("aria-current", "step");
    expect(
      document.querySelector('[data-slot="plan-block"][data-block="practice"]'),
    ).toHaveAttribute("data-status", "locked");
    expect(
      document.querySelector(
        '[data-slot="plan-step"][data-status="in_progress"]',
      ),
    ).toHaveAttribute("aria-current", "step");
    expect(
      document.querySelector('[data-slot="plan-step"][data-status="locked"]'),
    ).not.toHaveAttribute("aria-current");
  });

  it("counts skipped progress as terminal in both orientation and lesson plan", async () => {
    const session = makeMultiSession([
      { type: "briefing", status: "skipped" },
      { type: "study", status: "ready" },
    ]);
    apiMock.mockResolvedValue({ session });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByRole("button", { name: /Шаги урока/u }),
    ).toBeVisible();
    const header = document.querySelector(
      '[data-slot="session-progress-header"]',
    );
    expect(within(header as HTMLElement).getByText("1 / 2")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Шаги урока/u }));
    await screen.findByRole("dialog");
    const summary = document.querySelector('[data-slot="day-plan-summary"]');
    const skippedStep = document.querySelector(
      '[data-slot="plan-step"][data-status="skipped"]',
    );
    expect(summary).toHaveTextContent("1 / 2");
    expect(skippedStep).toHaveTextContent("Пропущено");
    expect(skippedStep).not.toHaveAttribute("aria-current");
  });

  it("renders an open lesson orientation with one connected activity focus", async () => {
    apiMock.mockResolvedValue({ session: makeSession("briefing", "ready") });
    renderWithQuery(<SessionClient />);

    await screen.findByRole("button", { name: /Начать активность/u });
    const guided = document.querySelector('[data-slot="guided-session"]');
    expect(guided).toBeInTheDocument();
    expect(guided).not.toHaveClass("mx-auto", "max-w-[56rem]");
    const header = document.querySelector(
      '[data-slot="session-progress-header"]',
    );
    const orientation = document.querySelector(
      '[data-slot="session-orientation"]',
    );
    expect(header).toHaveClass("sticky", "top-[var(--shell-bar-size,4.5rem)]");
    expect(header).not.toHaveClass(
      "border-b",
      "rounded-focus",
      "bg-card",
      "shadow-sm",
    );
    expect(orientation).toHaveClass("w-full", "min-w-0");
    expect(header).toHaveTextContent("Значения, типы и объекты");
    expect(
      within(header as HTMLElement).getByText(
        "Этап 1 из 1 · Понять · Активность 1 из 1",
      ),
    ).toHaveAttribute("data-slot", "phase-activity-line");
    expect(header).toHaveTextContent("Осталось на этапе:");
    expect(
      within(header as HTMLElement).getAllByRole("progressbar"),
    ).toHaveLength(1);
    expect(
      within(header as HTMLElement).getByRole("heading", { level: 1 }),
    ).toHaveClass("text-lg");
    expect(
      within(header as HTMLElement).getByRole("heading", { level: 1 }),
    ).toHaveAccessibleName("Урок 1 · Значения, типы и объекты");
    expect(
      within(header as HTMLElement).getByRole("button", {
        name: "Шаги урока",
      }),
    ).toHaveAttribute("data-variant", "outline");
    expect(
      within(header as HTMLElement).getByRole("button", {
        name: "Продолжить позже",
      }),
    ).toHaveAttribute("data-variant", "ghost");

    const focus = document.querySelector('[data-slot="lesson-focus"]');
    const ready = document.querySelector('[data-slot="unit-ready"]');
    const learningBrief = document.querySelector(
      '[data-slot="unit-learning-brief"]',
    );
    expect(focus).toContainElement(ready as HTMLElement);
    expect(focus).toHaveClass("w-full", "min-w-0");
    expect(focus).toHaveAttribute("tabindex", "-1");
    expect(focus).toHaveAccessibleName("Юнит briefing");
    expect(
      document.querySelector('[data-slot="lesson-workspace"]'),
    ).toHaveClass(
      "min-h-[calc(100dvh-var(--shell-bar-size,4.5rem))]",
      "@min-[72rem]/lesson:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]",
    );
    expect(ready).toHaveClass("w-full");
    expect(ready).not.toHaveClass(
      "rounded-focus",
      "rounded-control",
      "border",
      "bg-card",
    );
    expect(ready).toContainElement(learningBrief as HTMLElement);
    expect(learningBrief).toHaveTextContent("Описание briefing");
    expect(learningBrief).toHaveTextContent("Объяснить механизм");
    expect(learningBrief).toHaveTextContent("JavaScript");
    expect(learningBrief).toHaveTextContent("Подтверждения завершения");
    expect(learningBrief).toHaveTextContent("Отметить обязательные пункты: 1");
    expect(learningBrief).toHaveTextContent(
      "Для этой активности источник ещё не назначен.",
    );
    expect(within(ready as HTMLElement).queryByText("Доступно")).toBeNull();
    expect(
      within(learningBrief as HTMLElement).getByRole("link", {
        name: "Открыть редактор курса",
      }),
    ).toHaveClass("text-xs", "text-muted-foreground");

    fireEvent.click(screen.getByRole("button", { name: "Продолжить позже" }));
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("uses persisted currentStep instead of inferring focus from statuses", async () => {
    const session = {
      ...makeMultiSession([
        { type: "briefing", status: "ready" },
        { type: "study", status: "in_progress" },
      ]),
      currentStep: "day-1-briefing",
    };
    apiMock.mockResolvedValue({ session });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Юнит briefing" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Юнит study" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Начать активность" }),
    ).toBeEnabled();
  });

  it("resets renderer state when currentStep moves between same-type activities", async () => {
    const firstUnit = makeUnit("study");
    const secondUnit = {
      ...makeUnit("study"),
      id: "unit-study-2",
      stableId: "day-1-study-2",
      order: 2,
      title: "Юнит study 2",
      checklist: [
        {
          id: "study-2-required",
          label: "Второй обязательный пункт",
          required: true,
        },
      ],
      completionCriteria: [
        { type: "checklist" as const, requiredItemIds: ["study-2-required"] },
      ],
    };
    const initial = makeSession("study");
    initial.snapshot.units = [firstUnit, secondUnit];
    initial.unitProgress = [
      initial.unitProgress[0]!,
      {
        ...initial.unitProgress[0]!,
        unitId: secondUnit.id,
        status: "ready",
        payload: progressPayload("study"),
        startedAt: null,
      },
    ];
    const next = {
      ...initial,
      currentStep: secondUnit.stableId,
      unitProgress: [
        {
          ...initial.unitProgress[0]!,
          status: "completed" as const,
          payload: {
            type: "study" as const,
            checkedItemIds: ["study-required"],
            notes: "Черновик первой активности",
          },
          completedAt: now,
        },
        {
          ...initial.unitProgress[1]!,
          status: "in_progress" as const,
          startedAt: now,
        },
      ],
    };
    apiMock.mockResolvedValue({ session: initial });
    const { client } = renderWithQuery(<SessionClient />);

    fireEvent.click(await screen.findByLabelText(/^Обязательный пункт/u));
    fireEvent.change(screen.getByLabelText("Заметки"), {
      target: { value: "Черновик первой активности" },
    });

    act(() => {
      client.setQueryData(["learning-session-v2", "session-v2"], {
        session: next,
      });
    });

    expect(
      await screen.findByRole("heading", { level: 2, name: secondUnit.title }),
    ).toBeVisible();
    expect(screen.getByLabelText("Заметки")).toHaveValue("");
    expect(
      screen.getByLabelText(/^Второй обязательный пункт/u),
    ).not.toBeChecked();
  });

  it("restores a bounded Study draft after remount", async () => {
    const session = makeSession("study");
    const storageKey = activityDraftKey(session);
    apiMock.mockResolvedValue({ session });
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.click(await screen.findByLabelText(/^Обязательный пункт/u));
    fireEvent.change(screen.getByLabelText("Заметки"), {
      target: { value: "Неподтверждённая заметка для продолжения" },
    });
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toContain(
        "Неподтверждённая заметка для продолжения",
      );
    });

    firstRender.unmount();
    renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("Заметки")).toHaveValue(
      "Неподтверждённая заметка для продолжения",
    );
    expect(screen.getByLabelText(/^Обязательный пункт/u)).toBeChecked();
  });

  it("restores unsent Recall answers without storing server evidence", async () => {
    const session = makeSession("recall");
    const storageKey = activityDraftKey(session);
    apiMock.mockResolvedValue({ session });
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.change(
      await screen.findByRole("textbox", { name: /Чем binding отличается/u }),
      {
        target: { value: "Binding хранит связь, а значение является данными." },
      },
    );
    await vi.waitFor(() => {
      const stored = window.localStorage.getItem(storageKey);
      expect(stored).toContain("Binding хранит связь");
      expect(stored).not.toContain("firstAttemptId");
      expect(stored).not.toContain("correctness");
    });

    firstRender.unmount();
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByRole("textbox", { name: /Чем binding отличается/u }),
    ).toHaveValue("Binding хранит связь, а значение является данными.");
  });

  it("restores only the unsent Teacher revision, not provider output", async () => {
    const session = makeSession("teacher-dialogue");
    const storageKey = activityDraftKey(session);
    mockTeacherDialogueApi();
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Уточнённое объяснение"), {
      target: { value: "Черновик уточнения механизма без отправки Teacher." },
    });
    await vi.waitFor(() => {
      const stored = window.localStorage.getItem(storageKey);
      expect(stored).toContain("Черновик уточнения механизма");
      expect(stored).not.toContain("messages");
      expect(stored).not.toContain("assistant");
    });

    firstRender.unmount();
    renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("Уточнённое объяснение")).toHaveValue(
      "Черновик уточнения механизма без отправки Teacher.",
    );
  });

  it("restores unsent Quiz selections without persisting an answer key", async () => {
    const session = makeSession("quiz");
    const storageKey = activityDraftKey(session);
    apiMock.mockResolvedValue({ session });
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.click(await screen.findByLabelText("string"));
    fireEvent.click(screen.getByLabelText("Deep copy"));
    await vi.waitFor(() => {
      const stored = window.localStorage.getItem(storageKey);
      expect(stored).toContain("q1-a");
      expect(stored).toContain("q2-b");
      expect(stored).not.toContain("correctOptionIds");
      expect(stored).not.toContain("referenceAnswer");
    });

    firstRender.unmount();
    renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("string")).toBeChecked();
    expect(screen.getByLabelText("Deep copy")).toBeChecked();
  });

  it("restores all unsent Code reading fields", async () => {
    const session = makeSession("code-reading");
    apiMock.mockResolvedValue({ session });
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Предсказание"), {
      target: { value: "Изменится только внешняя ссылка" },
    });
    fireEvent.change(screen.getByLabelText("Объяснение механизма"), {
      target: { value: "Spread создаёт поверхностную копию" },
    });
    fireEvent.change(screen.getByLabelText("Исправление словами"), {
      target: { value: "Скопировать вложенное значение отдельно" },
    });
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(activityDraftKey(session))).toContain(
        "Скопировать вложенное значение отдельно",
      );
    });

    firstRender.unmount();
    renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("Предсказание")).toHaveValue(
      "Изменится только внешняя ссылка",
    );
    expect(screen.getByLabelText("Объяснение механизма")).toHaveValue(
      "Spread создаёт поверхностную копию",
    );
    expect(screen.getByLabelText("Исправление словами")).toHaveValue(
      "Скопировать вложенное значение отдельно",
    );
  });

  it("isolates activity drafts by exact learning session", async () => {
    const firstSession = makeSession("study");
    apiMock.mockResolvedValue({ session: firstSession });
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Заметки"), {
      target: { value: "Только для первой сессии" },
    });
    await vi.waitFor(() => {
      expect(
        window.localStorage.getItem(activityDraftKey(firstSession)),
      ).not.toBeNull();
    });
    firstRender.unmount();

    const secondSession = { ...makeSession("study"), id: "session-other" };
    searchState.value = "id=session-other";
    apiMock.mockResolvedValue({ session: secondSession });
    renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("Заметки")).toHaveValue("");
    expect(activityDraftKey(secondSession)).not.toBe(
      activityDraftKey(firstSession),
    );
  });

  it("fails closed and removes malformed activity draft storage", async () => {
    const session = makeSession("study");
    const storageKey = activityDraftKey(session);
    window.localStorage.setItem(storageKey, "{malformed");
    apiMock.mockResolvedValue({ session });

    renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("Заметки")).toHaveValue("");
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
  });

  it("clears a Study draft only after the server accepts it", async () => {
    const session = makeSession("study");
    const saved = replaceProgress(session, "in_progress", {
      type: "study",
      checkedItemIds: [],
      notes: "Принятая сервером заметка",
    });
    const storageKey = activityDraftKey(session);
    apiMock
      .mockResolvedValueOnce({ session })
      .mockRejectedValueOnce(new Error("Temporary write failure"))
      .mockResolvedValueOnce({ session: saved });
    renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Заметки"), {
      target: { value: "Принятая сервером заметка" },
    });
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Сохранить заметки" }));
    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Temporary write failure");
    });
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Сохранить заметки" }));
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
    expect(screen.getByLabelText("Заметки")).toHaveValue(
      "Принятая сервером заметка",
    );
  });

  it("fails closed when currentStep does not identify a snapshot activity", async () => {
    apiMock.mockResolvedValue({
      session: {
        ...makeSession("study", "in_progress"),
        currentStep: "missing-stable-step",
      },
    });
    renderWithQuery(<SessionClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Прогресс текущей активности отсутствует.",
    );
    expect(
      screen.queryByRole("heading", { level: 2, name: "Юнит study" }),
    ).not.toBeInTheDocument();
  });

  it("routes pending spaced review to Review instead of showing a disabled action", async () => {
    apiMock.mockResolvedValue({ session: makeSession("spaced-review") });
    renderWithQuery(<SessionClient />);

    const reviewLink = await screen.findByRole("link", { name: "Повторение" });
    expect(reviewLink).toHaveAttribute("href", "/review");
    expect(
      screen.queryByRole("button", { name: "Начать серверное повторение" }),
    ).not.toBeInTheDocument();
  });

  it("reports a transient activity mutation failure with a toast", async () => {
    apiMock
      .mockResolvedValueOnce({ session: makeSession("briefing", "ready") })
      .mockRejectedValueOnce(new Error("Activity start unavailable"));
    renderWithQuery(<SessionClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Начать активность" }),
    );

    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Activity start unavailable");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Начать активность" }),
    ).toBeEnabled();
  });

  it("opens a new interview from its unit with a return session id", async () => {
    apiMock.mockResolvedValue({ session: makeSession("interview") });
    renderWithQuery(<SessionClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Открыть интервью" }),
    );

    expect(pushMock).toHaveBeenCalledWith("/interview?sessionId=session-v2");
  });

  it("opens a saved interview report and completes its unit", async () => {
    const reportProgress = {
      type: "interview" as const,
      interviewSessionId: "interview-1",
      reportId: "report-1",
    };
    const active = makeSession("interview", "in_progress", reportProgress);
    const completed = replaceProgress(active, "completed", reportProgress);
    apiMock
      .mockResolvedValueOnce({ session: active })
      .mockResolvedValueOnce({ session: completed });
    renderWithQuery(<SessionClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Открыть отчёт" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/interview?id=interview-1");

    fireEvent.click(
      screen.getByRole("button", { name: "Завершить активность" }),
    );
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-interview",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            payload: reportProgress,
            operationId: "operation-1",
          }),
        }),
      );
    });
    expect(
      await screen.findByText("Активность завершена и сохранена"),
    ).toBeInTheDocument();
  });

  it("resolves the current session when the URL has no id and shows Path when it is null", async () => {
    searchState.value = "";
    apiMock.mockResolvedValue({ session: null });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Активного занятия нет"),
    ).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/learning/sessions/current");
    fireEvent.click(screen.getByRole("button", { name: "Открыть Главную" }));
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("completes briefing with one click, without mandatory checkboxes", async () => {
    const ready = makeSession("briefing", "ready");
    const active = replaceProgress(
      ready,
      "in_progress",
      progressPayload("briefing"),
    );
    const completePayload = {
      type: "briefing" as const,
      acknowledged: true,
      checkedItemIds: ["briefing-required", "briefing-optional"],
    };
    const completed = replaceProgress(active, "completed", completePayload);
    apiMock
      .mockResolvedValueOnce({ session: ready })
      .mockResolvedValueOnce({ session: active })
      .mockResolvedValueOnce({ session: completed });
    renderWithQuery(<SessionClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Начать активность" }),
    );
    expect(await screen.findByText("Сегодня разберём")).toBeInTheDocument();
    expect(screen.getByText("После занятия сможете")).toBeInTheDocument();
    expect(screen.getByText("Глубина")).toBeInTheDocument();
    expect(screen.getByText("Не рассматриваем")).toBeInTheDocument();
    expect(screen.getByText("План")).toBeInTheDocument();
    const activity = document.querySelector('[data-slot="activity-frame"]');
    const briefing = document.querySelector('[data-slot="briefing"]');
    const overview = document.querySelector('[data-slot="briefing-overview"]');
    const plan = document.querySelector('[data-slot="briefing-plan"]');
    const sources = document.querySelector('[data-slot="unit-sources"]');
    const actions = document.querySelector('[data-slot="briefing-actions"]');
    expect(
      document.querySelectorAll('[data-slot="activity-frame"]'),
    ).toHaveLength(1);
    expect(activity).toContainElement(briefing as HTMLElement);
    expect(overview).not.toHaveClass("border-y");
    expect(overview?.querySelector("section")).toHaveClass(
      "rounded-focus",
      "bg-surface-soft/45",
    );
    expect(plan).toHaveClass("rounded-focus", "bg-surface-soft/45");
    expect(sources).toHaveClass("rounded-focus", "bg-surface-soft/40");
    expect(actions).not.toHaveClass("border-t");
    expect(document.querySelector('[data-slot="lesson-focus"]')).toHaveFocus();
    expect(
      screen.queryByLabelText("Подтверждаю: цели и границы дня понятны"),
    ).not.toBeInTheDocument();
    const finish = screen.getByRole("button", {
      name: "Перейти к изучению",
    });
    expect(finish).toBeEnabled();
    fireEvent.click(finish);

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-briefing",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            payload: completePayload,
            operationId: "operation-2",
          }),
        }),
      );
    });
    expect(
      await screen.findByText("Активность завершена и сохранена"),
    ).toBeInTheDocument();
  });

  it("shows a block transition after finishing the previous block", async () => {
    const session = makeMultiSession([
      { type: "study", status: "completed" },
      { type: "recall", status: "ready" },
    ]);
    apiMock.mockResolvedValue({ session });
    renderWithQuery(<SessionClient />);

    expect(await screen.findByText("Этап 1 из 2 завершён")).toBeVisible();
    expect(screen.getByText("Далее: Подтвердить")).toBeVisible();
    expect(screen.getByText("Вы разобрали:")).toBeVisible();
    const transition = document.querySelector('[data-slot="block-transition"]');
    expect(
      within(transition as HTMLElement).getByText("Юнит study"),
    ).toBeVisible();
    expect(screen.getByText(/Подтвердить · Активностей: 1/u)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Продолжить сейчас" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Вернуться позже" }));
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("starts the next block from the transition screen", async () => {
    const session = makeMultiSession([
      { type: "study", status: "completed" },
      { type: "recall", status: "ready" },
    ]);
    const active = {
      ...session,
      unitProgress: session.unitProgress.map((item) =>
        item.unitId === "unit-recall"
          ? { ...item, status: "in_progress" as const, startedAt: now }
          : item,
      ),
    };
    apiMock
      .mockResolvedValueOnce({ session })
      .mockResolvedValueOnce({ session: active });
    renderWithQuery(<SessionClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Продолжить сейчас" }),
    );

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-recall",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "in_progress",
            payload: progressPayload("recall"),
            operationId: "operation-1",
          }),
        }),
      );
    });
    expect(await screen.findByText(/Чем binding отличается/u)).toBeVisible();
  });

  it("renders study source cards with kind, time and learning goal", async () => {
    apiMock.mockResolvedValue({ session: makeSession("study") });
    renderWithQuery(<SessionClient />);

    const cards = await vi.waitFor(() => {
      const found = document.querySelectorAll('[data-slot="source-card"]');
      expect(found).toHaveLength(1);
      return found;
    });
    expect(cards[0]).toHaveTextContent("MDN: JavaScript data types");
    expect(cards[0]).toHaveTextContent("Документация · 12 мин");
    expect(cards[0]).toHaveTextContent("Основной");
    expect(cards[0]).toHaveTextContent("Разделить binding и value");
    const link = cards[0]!.querySelector("a");
    expect(link!).not.toBeNull();
    expect(link!).toHaveAttribute(
      "href",
      "https://developer.mozilla.org/docs/Web/JavaScript/Data_structures",
    );
    expect(link!).toHaveTextContent("Открыть материал");
  });

  it("shows an honest empty source state with next actions", async () => {
    const session = makeSession("study");
    session.snapshot.units[0]!.sources = [];
    apiMock.mockResolvedValue({ session });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Для этой активности источник ещё не назначен."),
    ).toBeVisible();
    expect(screen.getByText(/Используйте свой источник/u)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Открыть редактор курса" }),
    ).toHaveAttribute("href", "/courses/studio?version=curriculum-version-2");
  });

  it("persists study notes with same-status PATCH and gates completion on required checklist", async () => {
    const session = makeSession("study");
    const savedPayload = {
      type: "study" as const,
      checkedItemIds: ["study-required"],
      notes: "Binding хранит связь с value",
    };
    const saved = replaceProgress(session, "in_progress", savedPayload);
    apiMock
      .mockResolvedValueOnce({ session })
      .mockResolvedValueOnce({ session: saved });
    renderWithQuery(<SessionClient />);

    const complete = await screen.findByRole("button", {
      name: /Завершить изучение/u,
    });
    expect(complete).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Обязательный пункт/u));
    fireEvent.change(screen.getByLabelText("Заметки"), {
      target: { value: savedPayload.notes },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить заметки" }));

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-study",
        expect.objectContaining({
          body: JSON.stringify({
            status: "in_progress",
            payload: savedPayload,
            operationId: "operation-1",
          }),
        }),
      );
    });
  });

  it("persists a distinct immutable first attempt for every recall question", async () => {
    const session = makeSession("recall");
    const firstDraft =
      "Binding — это имя, связанное со значением, а не само значение.";
    const secondDraft =
      "Присваивание связывает имя с другим значением, не изменяя прежнее имя.";
    const firstPayload: ProgressPayloadFixture = {
      type: "recall" as const,
      answers: [
        {
          questionId: "recall-q1",
          draft: firstDraft,
          firstAttemptId: "recall-evidence-1",
        },
      ],
      draft: firstDraft,
      firstAttemptId: "recall-evidence-1",
    };
    const completePayload: ProgressPayloadFixture = {
      ...firstPayload,
      answers: [
        ...firstPayload.answers,
        {
          questionId: "recall-q2",
          draft: secondDraft,
          firstAttemptId: "recall-evidence-2",
        },
      ],
    };
    const firstSaved = replaceProgress(session, "in_progress", firstPayload);
    const bothSaved = replaceProgress(session, "in_progress", completePayload);
    apiMock
      .mockResolvedValueOnce({ session })
      .mockResolvedValueOnce({
        evidence: {
          id: "recall-evidence-1",
          isFirstAttempt: true,
          questionId: "recall-q1",
        },
        session: firstSaved,
      })
      .mockResolvedValueOnce({
        evidence: {
          id: "recall-evidence-2",
          isFirstAttempt: true,
          questionId: "recall-q2",
        },
        session: bothSaved,
      });
    renderWithQuery(<SessionClient />);

    fireEvent.change(
      await screen.findByLabelText(/Чем binding отличается от значения/u),
      { target: { value: firstDraft } },
    );
    fireEvent.change(
      screen.getByLabelText(/Почему присваивание не меняет исходный binding/u),
      { target: { value: secondDraft } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить ответ 1" }));

    await vi.waitFor(() =>
      expect(
        screen.getByLabelText(/Чем binding отличается от значения/u),
      ).toBeDisabled(),
    );
    expect(
      screen.queryByRole("button", { name: /Завершить воспроизведение/u }),
    ).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Сохранить ответ 2" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Сохранить ответ 2" }));

    await vi.waitFor(() => {
      const recallCalls = apiMock.mock.calls.filter(([path]) =>
        String(path).endsWith("/recall-attempts"),
      );
      expect(recallCalls).toHaveLength(2);
      expect(recallCalls.map(([, init]) => JSON.parse(init.body))).toEqual([
        {
          operationId: "operation-1",
          questionId: "recall-q1",
          answer: firstDraft,
        },
        {
          operationId: "operation-2",
          questionId: "recall-q2",
          answer: secondDraft,
        },
      ]);
    });
    expect(
      await screen.findByRole("button", { name: /Завершить воспроизведение/u }),
    ).toBeEnabled();
  });

  it("keeps the second Recall draft when the first answer changes server progress", async () => {
    const session = makeSession("recall");
    const firstDraft =
      "Binding — это имя, связанное со значением, а не само значение.";
    const secondDraft =
      "Присваивание меняет связь имени, не мутируя прежнее значение.";
    const firstSaved = replaceProgress(session, "in_progress", {
      type: "recall",
      answers: [
        {
          questionId: "recall-q1",
          draft: firstDraft,
          firstAttemptId: "recall-evidence-1",
        },
      ],
      draft: firstDraft,
      firstAttemptId: "recall-evidence-1",
    });
    firstSaved.unitProgress[0]!.updatedAt = "2026-08-01T00:01:00.000Z";
    let currentSession = session;
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/sessions/v2/session-v2") {
        return Promise.resolve({ session: currentSession });
      }
      if (path.endsWith("/recall-attempts")) {
        currentSession = firstSaved;
        return Promise.resolve({
          evidence: {
            id: "recall-evidence-1",
            isFirstAttempt: true,
            questionId: "recall-q1",
          },
          session: firstSaved,
        });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    const firstRender = renderWithQuery(<SessionClient />);

    fireEvent.change(
      await screen.findByLabelText(/Чем binding отличается от значения/u),
      { target: { value: firstDraft } },
    );
    fireEvent.change(
      screen.getByLabelText(/Почему присваивание не меняет исходный binding/u),
      { target: { value: secondDraft } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Сохранить ответ 1" }));

    await vi.waitFor(() => {
      expect(
        screen.getByLabelText(
          /Почему присваивание не меняет исходный binding/u,
        ),
      ).toHaveValue(secondDraft);
      expect(
        window.localStorage.getItem(activityDraftKey(firstSaved)),
      ).toContain(secondDraft);
    });

    firstRender.unmount();
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByLabelText(
        /Почему присваивание не меняет исходный binding/u,
      ),
    ).toHaveValue(secondDraft);
    expect(
      screen.getByLabelText(/Чем binding отличается от значения/u),
    ).toBeDisabled();
  });

  it("restores question-scoped recall answers after reload and keeps unfinished recall open", async () => {
    const firstDraft =
      "Binding — это имя, связанное со значением, а не само значение.";
    const saved = makeSession("recall", "in_progress", {
      type: "recall",
      answers: [
        {
          questionId: "recall-q1",
          draft: firstDraft,
          firstAttemptId: "recall-evidence-1",
        },
      ],
      draft: firstDraft,
      firstAttemptId: "recall-evidence-1",
    });
    apiMock.mockResolvedValue({ session: saved });

    renderWithQuery(<SessionClient />);

    const restored = await screen.findByLabelText(
      /Чем binding отличается от значения/u,
    );
    expect(restored).toHaveValue(firstDraft);
    expect(restored).toBeDisabled();
    expect(
      screen.getByLabelText(/Почему присваивание не меняет исходный binding/u),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Завершить воспроизведение/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Сохранено ответов: 1 из 2/u)).toBeInTheDocument();
  });

  it("restores Teacher history by session and persists a learner revision after the real stream", async () => {
    const session = makeSession("teacher-dialogue");
    const firstRevisionPayload = {
      type: "teacher-dialogue" as const,
      conversationId: null,
      turnCount: 1,
      revisionAttemptIds: ["operation-1"],
    };
    const followUpPayload = {
      ...firstRevisionPayload,
      turnCount: 2,
      revisionAttemptIds: ["operation-1", "operation-4"],
    };
    const firstRevised = replaceProgress(
      session,
      "in_progress",
      firstRevisionPayload,
    );
    const followedUp = replaceProgress(session, "in_progress", followUpPayload);
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/learning/sessions/v2/session-v2") {
        return Promise.resolve({ session });
      }
      if (path === "/learning/sessions/v2/session-v2/teacher-transcript") {
        return Promise.resolve({
          messages: [
            {
              id: "history-1",
              role: "assistant",
              content: "Что значит общая ссылка?",
            },
          ],
        });
      }
      if (
        path === "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue"
      ) {
        const body = JSON.parse(String(init?.body)) as {
          payload: { turnCount: number };
        };
        return Promise.resolve({
          session: body.payload.turnCount === 1 ? firstRevised : followedUp,
        });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Что значит общая ссылка?"),
    ).toBeInTheDocument();
    const revision =
      "Общая ссылка означает, что оба binding указывают на один объект.";
    fireEvent.change(screen.getByLabelText("Уточнённое объяснение"), {
      target: { value: revision },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить объяснение" }),
    );

    await vi.waitFor(() => expect(streamAgentMock).toHaveBeenCalledTimes(1));
    expect(streamAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "teacher",
        sessionId: "session-v2",
        message: expect.stringContaining(revision),
      }),
      expect.any(AbortSignal),
    );
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue",
        expect.objectContaining({
          body: JSON.stringify({
            status: "in_progress",
            payload: firstRevisionPayload,
            operationId: "operation-3",
          }),
        }),
      );
    });
    expect(
      screen.queryByRole("button", { name: /Завершить диалог/u }),
    ).not.toBeInTheDocument();

    const followUp =
      "Потому что оба binding хранят одну и ту же ссылку на объект.";
    fireEvent.change(
      await screen.findByLabelText("Ответ на уточнение преподавателя"),
      { target: { value: followUp } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ответить на уточнение" }),
    );

    await vi.waitFor(() => expect(streamAgentMock).toHaveBeenCalledTimes(2));
    expect(streamAgentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          `Learner response to Tutor follow-up:\n${followUp}`,
        ),
      }),
      expect.any(AbortSignal),
    );
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue",
        expect.objectContaining({
          body: JSON.stringify({
            status: "in_progress",
            payload: followUpPayload,
            operationId: "operation-6",
          }),
        }),
      );
    });
    expect(
      await screen.findByRole("button", { name: /Завершить диалог/u }),
    ).toBeEnabled();
  });

  it.each([
    {
      name: "completion-only content",
      events: [
        {
          type: "message.completed",
          turnId: "turn-1",
          content: "Финальный вопрос без дельт",
        },
        {
          type: "session.completed",
          turnId: "turn-1",
          reason: "completed",
        },
      ],
      expected: "Финальный вопрос без дельт",
      replaced: null,
    },
    {
      name: "authoritative completed content",
      events: [
        {
          type: "message.delta",
          turnId: "turn-1",
          content: "Черновой вопрос",
        },
        {
          type: "message.completed",
          turnId: "turn-1",
          content: "Авторитетный финальный вопрос",
        },
        {
          type: "session.completed",
          turnId: "turn-1",
          reason: "completed",
        },
      ],
      expected: "Авторитетный финальный вопрос",
      replaced: "Черновой вопрос",
    },
  ])("uses Teacher $name", async ({ events, expected, replaced }) => {
    mockTeacherDialogueApi();
    streamAgentMock.mockImplementationOnce(async function* () {
      for (const event of events) yield event;
    });
    renderWithQuery(<SessionClient />);

    const revision = await screen.findByLabelText("Уточнённое объяснение");
    fireEvent.change(revision, {
      target: {
        value: "Подробное самостоятельное объяснение механизма учеником.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить объяснение" }),
    );

    expect(await screen.findByText(expected)).toBeVisible();
    if (replaced) expect(screen.queryByText(replaced)).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue",
        expect.anything(),
      ),
    );
  });

  it.each([
    {
      reason: "failed",
      events: [
        {
          type: "error",
          turnId: "turn-1",
          message: "untrusted provider failure",
        },
        {
          type: "session.completed",
          turnId: "turn-1",
          reason: "failed",
        },
      ],
      expected: "Преподаватель недоступен",
    },
    {
      reason: "cancelled",
      events: [
        {
          type: "session.completed",
          turnId: "turn-1",
          reason: "cancelled",
        },
      ],
      expected: "Ответ преподавателя остановлен",
    },
  ])(
    "does not persist a Teacher turn that ends $reason",
    async ({ events, expected }) => {
      mockTeacherDialogueApi();
      streamAgentMock.mockImplementationOnce(async function* () {
        for (const event of events) yield event;
      });
      renderWithQuery(<SessionClient />);

      const revision = await screen.findByLabelText("Уточнённое объяснение");
      fireEvent.change(revision, {
        target: {
          value: "Подробное самостоятельное объяснение механизма учеником.",
        },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Отправить объяснение" }),
      );

      expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
      await vi.waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Отправить объяснение" }),
        ).toBeEnabled(),
      );
      expect(apiMock).not.toHaveBeenCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue",
        expect.anything(),
      );
      expect(
        screen.queryByText("untrusted provider failure"),
      ).not.toBeInTheDocument();
    },
  );

  it("renders every public quiz option and trusts the server score without exposing an answer key", async () => {
    const session = makeSession("quiz");
    const scoredPayload = {
      type: "quiz" as const,
      attemptedQuestionIds: ["quiz-q1", "quiz-q2"],
      score: 0.5,
    };
    const scored = replaceProgress(session, "in_progress", scoredPayload);
    apiMock.mockResolvedValueOnce({ session }).mockResolvedValueOnce({
      attempt: {
        operationId: "operation-1",
        score: 0.5,
        results: [
          { questionId: "quiz-q1", correct: true },
          { questionId: "quiz-q2", correct: false },
        ],
      },
      session: scored,
    });
    const { container } = renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("string")).toBeInTheDocument();
    expect(screen.getByLabelText("object")).toBeInTheDocument();
    expect(screen.getByLabelText("Shallow copy")).toBeInTheDocument();
    expect(screen.getByLabelText("Deep copy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("string"));
    fireEvent.click(screen.getByLabelText("Deep copy"));
    fireEvent.click(screen.getByRole("button", { name: "Проверить ответы" }));

    expect(
      await screen.findByText("Серверная оценка: 50%. Порог: 50%."),
    ).toBeInTheDocument();
    expect(screen.getByText("Верно")).toBeInTheDocument();
    expect(screen.getByText("Нужно повторить")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /correctOptionIds|referenceAnswer/u,
    );
    expect(apiMock).toHaveBeenLastCalledWith(
      "/learning/sessions/v2/session-v2/units/unit-quiz/quiz-attempts",
      expect.objectContaining({
        body: JSON.stringify({
          operationId: "operation-1",
          answers: [
            { questionId: "quiz-q1", selectedOptionId: "q1-a" },
            { questionId: "quiz-q2", selectedOptionId: "q2-b" },
          ],
        }),
      }),
    );
  });

  it("keeps the first quiz score and allows a failed quiz to be retried after reload", async () => {
    const failedPayload = {
      type: "quiz" as const,
      attemptedQuestionIds: ["quiz-q1", "quiz-q2"],
      correctQuestionIds: ["quiz-q1"],
      score: 0.5,
    };
    const failed = makeSession("quiz", "in_progress", failedPayload);
    const quizUnit = failed.snapshot.units[0];
    if (!quizUnit || quizUnit.payload.type !== "quiz") {
      throw new Error("Quiz fixture is missing");
    }
    quizUnit.payload.minimumScore = 0.75;

    const passedPayload = {
      ...failedPayload,
      correctQuestionIds: ["quiz-q1", "quiz-q2"],
      score: 1,
    };
    const passed = replaceProgress(failed, "in_progress", passedPayload);
    apiMock.mockResolvedValueOnce({ session: failed }).mockResolvedValueOnce({
      attempt: {
        operationId: "operation-1",
        score: 1,
        results: [
          { questionId: "quiz-q1", correct: true },
          { questionId: "quiz-q2", correct: true },
        ],
      },
      session: passed,
    });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Серверная оценка: 50%. Порог: 75%."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("string")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Пересдать квиз" }));
    expect(screen.getByLabelText("string")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("string"));
    fireEvent.click(screen.getByLabelText("Shallow copy"));
    fireEvent.click(screen.getByRole("button", { name: "Проверить повторно" }));

    expect(
      await screen.findByText("Серверная оценка: 100%. Порог: 75%."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Завершить проверку" }),
    ).toBeEnabled();
    expect(apiMock).toHaveBeenLastCalledWith(
      "/learning/sessions/v2/session-v2/units/unit-quiz/quiz-attempts",
      expect.objectContaining({
        body: JSON.stringify({
          operationId: "operation-1",
          answers: [
            { questionId: "quiz-q1", selectedOptionId: "q1-a" },
            { questionId: "quiz-q2", selectedOptionId: "q2-a" },
          ],
        }),
      }),
    );
  });

  it("persists all three code-reading fields through its evidence endpoint", async () => {
    const session = makeSession("code-reading");
    const savedPayload = {
      type: "code-reading" as const,
      prediction: "original изменится",
      explanation: "spread копирует только внешний объект",
      verbalFix: "скопировать вложенный profile",
    };
    const saved = replaceProgress(session, "in_progress", savedPayload);
    apiMock.mockResolvedValueOnce({ session }).mockResolvedValueOnce({
      evidence: {
        id: "code-evidence-1",
        operationId: "operation-1",
        payload: savedPayload,
        createdAt: now,
      },
      session: saved,
    });
    renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Предсказание"), {
      target: { value: savedPayload.prediction },
    });
    fireEvent.change(screen.getByLabelText("Объяснение механизма"), {
      target: { value: savedPayload.explanation },
    });
    fireEvent.change(screen.getByLabelText("Исправление словами"), {
      target: { value: savedPayload.verbalFix },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить разбор" }));

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-code-reading/code-reading-attempts",
        expect.objectContaining({
          body: JSON.stringify({
            operationId: "operation-1",
            ...savedPayload,
            type: undefined,
          }),
        }),
      );
    });
  });

  it("rejects protected fields recursively before rendering leaked content", async () => {
    const leaked = makeSession("briefing");
    Object.assign(leaked.snapshot.units[0]?.payload ?? {}, {
      nested: { protectedEvaluation: "server-only rubric" },
    });
    apiMock.mockResolvedValue({ session: leaked });
    renderWithQuery(<SessionClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Protected curriculum field received",
    );
    expect(screen.queryByText("server-only rubric")).not.toBeInTheDocument();
  });

  it("hands exercise and review units off to Practice with the session entity id", async () => {
    apiMock.mockResolvedValue({ session: makeSession("exercise") });
    renderWithQuery(<SessionClient />);

    const shell = await screen.findByText("Критерии приёмки");
    expect(
      within(shell.parentElement!).getByText("Не мутировать input"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть практику" }));
    expect(pushMock).toHaveBeenCalledWith("/exercise?sessionId=session-v2");
  });

  it("creates the server-derived summary and completes the day with its persisted evidence id", async () => {
    const initial = makeSession("summary");
    const summarized = replaceProgress(initial, "in_progress", {
      type: "summary",
      summaryId: "summary-1",
    });
    const completed = replaceProgress(summarized, "completed", {
      type: "summary",
      summaryId: "summary-1",
    });
    apiMock
      .mockResolvedValueOnce({ session: initial })
      .mockResolvedValueOnce(makeSummaryResponse(summarized))
      .mockResolvedValueOnce({ session: completed });
    renderWithQuery(<SessionClient />);

    const generateButton = await screen.findByRole("button", {
      name: "Сформировать итог",
    });
    const activity = document.querySelector('[data-slot="activity-frame"]');
    const generate = document.querySelector('[data-slot="summary-generate"]');
    expect(
      document.querySelectorAll('[data-slot="activity-frame"]'),
    ).toHaveLength(1);
    expect(activity).toContainElement(generate as HTMLElement);
    expect(generate).toHaveClass("border-y");
    expect(generate).not.toHaveClass("bg-surface-soft", "rounded-xl");
    fireEvent.click(generateButton);
    expect(
      await screen.findByText(
        "День завершён на основе сохранённых подтверждений навыка.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/Добавлено исправлений: 1/u)).toBeInTheDocument();
    const summary = document.querySelector('[data-slot="day-summary"]');
    const narrative = document.querySelector('[data-slot="summary-narrative"]');
    const metrics = document.querySelector('[data-slot="summary-metrics"]');
    const insights = document.querySelector('[data-slot="summary-insights"]');
    const actions = document.querySelector('[data-slot="summary-actions"]');
    expect(summary).toHaveClass("divide-y", "border-y");
    expect(metrics?.tagName).toBe("DL");
    for (const section of [narrative, metrics, insights, actions]) {
      expect(section).not.toHaveClass(
        "bg-surface-soft",
        "rounded-xl",
        "rounded-panel",
      );
    }
    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      "/learning/sessions/v2/session-v2/units/unit-summary/summary",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "operation-1" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Завершить урок" }));
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-summary",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            payload: { type: "summary", summaryId: "summary-1" },
            operationId: "operation-2",
          }),
        }),
      );
    });
  });

  it("restores a persisted summary after restart without generating it again", async () => {
    const summarized = makeSession("summary", "in_progress", {
      type: "summary",
      summaryId: "summary-restored",
    });
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/sessions/v2/session-v2") {
        return Promise.resolve({ session: summarized });
      }
      if (
        path === "/learning/sessions/v2/session-v2/units/unit-summary/summary"
      ) {
        return Promise.resolve(
          makeSummaryResponse(summarized, "summary-restored"),
        );
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    const { container } = renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText(
        "День завершён на основе сохранённых подтверждений навыка.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Сформировать итог" }),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /correctOptionIds|referenceAnswer/u,
    );
  });

  it("announces loading and renders a retryable contract or network error", async () => {
    apiMock.mockReturnValueOnce(new Promise(() => undefined));
    const loading = renderWithQuery(<SessionClient />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Загружаю занятие…",
    );
    loading.unmount();

    apiMock.mockRejectedValueOnce(new Error("Session endpoint unavailable"));
    renderWithQuery(<SessionClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session endpoint unavailable",
    );
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});

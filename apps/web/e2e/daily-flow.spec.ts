import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

const runRoot = path.resolve(requiredEnvironment("E2E_RUN_ROOT"));
const attemptsRoot = path.resolve(requiredEnvironment("E2E_ATTEMPTS_ROOT"));
const orchestratorOrigin = requiredEnvironment("E2E_ORCHESTRATOR_ORIGIN");
const webOrigin = requiredEnvironment("E2E_WEB_ORIGIN");

test.afterAll(async () => {
  const relative = path.relative(runRoot, attemptsRoot);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("E2E cleanup escaped its launcher-owned run root");
  }
  await rm(attemptsRoot, { recursive: true, force: true });
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be provided by scripts/test-e2e.mjs`);
  }
  return value;
}

test("hydrates stored light and dark themes without an icon mismatch", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      (message.text().includes("hydrated but some attributes") ||
        message
          .text()
          .includes(
            "Can't perform a React state update on a component that hasn't mounted yet",
          ))
    ) {
      browserErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

  const response = await page.goto("/");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(
    page.getByRole("heading", { name: "Choose interface language" }),
  ).toBeVisible();
  await page
    .getByRole("alertdialog", { name: "Choose interface language" })
    .getByLabel("Interface language", { exact: true })
    .selectOption("ru-RU");
  await page.getByRole("button", { name: "Использовать этот язык" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru-RU");
  await expect(
    page.getByRole("button", { name: "Включить тему: системная" }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("completes restart-safe Day 1 through correction, summary, mastery and review", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "JavaScript, TypeScript и React: восстановление фундамента",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Активностей: 0 из 5")).toBeVisible();
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page).toHaveURL(/\/session\?id=/u);
  const sessionId = new URL(page.url()).searchParams.get("id");
  if (!sessionId) throw new Error("Session ID is missing from the guided flow");

  // The active Activity stays in focus while desktop keeps lesson context visible.
  const lessonSteps = page.getByRole("complementary", {
    name: "Шаги урока",
  });
  await expect(lessonSteps).toBeVisible();
  await expect(lessonSteps.getByText("Этапы обучения")).toBeVisible();
  await lessonSteps.getByText("Цель", { exact: true }).click();
  await expect(
    lessonSteps.getByText("Ожидаемые результаты", { exact: true }),
  ).toBeVisible();
  await lessonSteps.getByText("Темы", { exact: true }).click();
  await expect(
    lessonSteps.getByText("Вне занятия", { exact: true }),
  ).toBeVisible();

  await startUnit(page);
  await expect(page.getByText("Сегодня разберём")).toBeVisible();
  await expect(page.getByText("После занятия сможете")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Глубина", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Перейти к изучению" }).click();

  for (const [note, checklistCount] of [
    ["Примитив — значение, binding — связь имени со значением.", 3],
    [
      "null и undefined — разные nullish values; typeof null исторический edge case.",
      4,
    ],
    ["Объекты сравниваются и мутируют через ссылки.", 3],
    ["Spread копирует верхний уровень; structuredClone имеет ограничения.", 4],
  ] as const) {
    await startUnit(page);
    await checkChecklist(page, checklistCount);
    await page.getByLabel("Заметки").fill(note);
    const finishStudy = page.getByRole("button", {
      name: "Завершить изучение",
    });
    await expect(finishStudy).toBeEnabled();
    await finishStudy.click();
  }

  // Phase transition: Understand completed → Demonstrate.
  await expect(page.getByText("Этап 1 из 3 завершён")).toBeVisible();
  await expect(page.getByText("Далее: Подтвердить")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить сейчас" }).click();

  const recallAnswers = [
    "Значение — данные, binding связывает имя со значением, а объект имеет собственную identity и передаётся через ссылку.",
    "null задан явно, undefined означает отсутствие значения, а отсутствующее свойство проверяется через hasOwn или оператор in.",
    "Spread копирует только внешний уровень; structuredClone не подходит для функций и некоторых специальных значений.",
  ];
  const recallTextareas = page
    .getByRole("region", {
      name: "Воспроизведение по памяти без подсказок",
    })
    .getByRole("textbox");
  await expect(recallTextareas).toHaveCount(recallAnswers.length);
  for (const [index, answer] of recallAnswers.entries()) {
    await recallTextareas.nth(index).fill(answer);
    await page
      .getByRole("button", { name: `Сохранить ответ ${index + 1}` })
      .click();
  }
  await page.getByRole("button", { name: "Завершить воспроизведение" }).click();

  await startUnit(page);
  await page
    .getByLabel("Уточнённое объяснение")
    .fill(
      "При shallow copy меняется identity внешнего объекта, но вложенный profile остаётся общей ссылкой, поэтому его мутация видна через обе структуры.",
    );
  await page.getByRole("button", { name: "Отправить объяснение" }).click();
  await expect(
    page.getByText(
      "В чём одно конкретное отличие поверхностного копирования (shallow copy) от глубокого (deep copy)?",
    ),
  ).toBeVisible();
  await page
    .getByLabel("Ответ на уточнение преподавателя")
    .fill(
      "Shallow copy сохраняет общую ссылку на вложенный объект, а deep copy создаёт независимый вложенный объект.",
    );
  await page.getByRole("button", { name: "Ответить на уточнение" }).click();
  await expect(
    page.getByRole("button", { name: "Завершить диалог" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Завершить диалог" }).click();

  await startUnit(page);
  await page.getByLabel("object", { exact: true }).check();
  await page.getByLabel("Object.is(NaN, NaN)").check();
  await page.getByLabel("Изменится общий profile").check();
  await page.getByLabel("if (!value)").check();
  await page.getByRole("button", { name: "Проверить ответы" }).click();
  await expect(
    page.getByText("Серверная оценка: 75%. Порог: 75%."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Завершить проверку" }).click();

  await startUnit(page);
  await page.getByLabel("Предсказание").fill("Изменятся next и state.");
  await page
    .getByLabel("Объяснение механизма")
    .fill("Оба внешних объекта сохраняют одну ссылку на вложенный profile.");
  await page
    .getByLabel("Исправление словами")
    .fill("Скопировать profile отдельно перед изменением name.");
  await page.getByRole("button", { name: "Сохранить разбор" }).click();
  await page.getByRole("button", { name: "Завершить чтение кода" }).click();

  // Phase transition: Demonstrate completed → Practice and review.
  await expect(page.getByText("Этап 2 из 3 завершён")).toBeVisible();
  await expect(page.getByText("Далее: Практика и повторение")).toBeVisible();
  await page.getByRole("button", { name: "Продолжить сейчас" }).click();
  await page.getByRole("button", { name: "Открыть практику" }).click();
  await expect(page).toHaveURL(/\/exercise\?sessionId=/u, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Создать попытку" }).click();
  await expect(
    page.getByRole("button", { name: "Открыть в Zed" }),
  ).toBeVisible();

  const exerciseResponse = await request.get(
    `${orchestratorOrigin}/api/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
    {
      headers: { "X-Aptiloop-Client": "web", Origin: webOrigin },
    },
  );
  expect(exerciseResponse.ok()).toBe(true);
  const exercise = (await exerciseResponse.json()) as {
    attempt: { id: string };
    workspace: { id: string; generation: number };
  };
  expect(exercise).not.toHaveProperty("workspacePath");
  expect(exercise.workspace).toMatchObject({
    id: expect.any(String),
    generation: 1,
  });
  const attemptWorkspace = path.join(attemptsRoot, exercise.attempt.id);
  const attemptRelativePath = path.relative(attemptsRoot, attemptWorkspace);
  expect(
    attemptRelativePath !== "" &&
      !attemptRelativePath.startsWith("..") &&
      !path.isAbsolute(attemptRelativePath),
  ).toBe(true);
  const learnerFile = path.join(
    attemptWorkspace,
    "src",
    "normalize-profile.ts",
  );
  await writeFile(learnerFile, passingImplementation, "utf8");

  await page.getByRole("button", { name: "Обновить Git diff" }).click();
  await expectExerciseDiff(page, "normalizeProfile(input");
  await page.getByRole("button", { name: "Запустить тесты" }).click();
  await expect(
    page.getByText("Тесты прошли на текущем diff").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Запросить проверку" }).click();
  await expectReviewerSummary(
    page,
    "Решение близко, но один краевой случай требует ещё одной попытки.",
  );
  await expect(
    page.getByRole("button", { name: "Принять проверку и продолжить" }),
  ).toHaveCount(0);

  await writeFile(
    learnerFile,
    `${passingImplementation}\n// correction cycle: empty input reviewed\n`,
    "utf8",
  );
  await page.getByRole("button", { name: "Запустить тесты" }).click();
  await expectExerciseDiff(page, "correction cycle");
  await page.getByRole("button", { name: "Запросить проверку" }).click();
  await expectReviewerSummary(
    page,
    "Цикл исправлений завершён: протестированное изменение теперь соответствует контракту упражнения.",
  );
  await page
    .getByRole("button", { name: "Принять проверку и продолжить" })
    .click();
  await expect(page).toHaveURL(/\/session\?id=/u);

  await startUnit(page);
  await page.getByRole("button", { name: "Сформировать итог" }).click();
  await expect(
    page.getByRole("button", { name: "Завершить урок" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Завершить урок" }).click();
  await expect(page.getByText("Урок завершён")).toBeVisible();

  await page.getByRole("link", { name: "Навыки" }).click();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "primitive values",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Повторение" }).click();
  await page.getByRole("tab", { name: "Исправления" }).click();
  const primitiveCorrection = page
    .getByRole("article")
    .filter({ hasText: "primitive values" });
  await expect(primitiveCorrection).toContainText("legacy-quiz-answer");
  await expect(primitiveCorrection).toContainText(
    "Выполните назначенную активность исправления",
  );
  await page.getByRole("tab", { name: "Очередь повторения" }).click();
  const primitiveReview = page
    .getByRole("article")
    .filter({ hasText: "primitive values" })
    .first();
  await expect(primitiveReview).toContainText("Измерение: Понимание");
  await expect(primitiveReview).toContainText(
    "Существующие подтверждения ниже детерминированного порога повторения.",
  );

  await page.goto("/");
  await expect(
    page.getByText(/Урок 2 · Scope, функции и замыкания/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Начать занятие" }),
  ).toBeVisible();
});

test("publishes a curriculum graph and keeps an active session on its original revision", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto("/courses/new");
  await page.getByRole("link", { name: "Создать пустой черновик" }).click();
  await expect(page).toHaveURL(/\/courses\/new\/manual$/u, {
    timeout: 15_000,
  });
  await page.getByLabel("Название программы").fill("E2E Curriculum");
  await page.getByLabel("Основная локаль курса").fill("ru-RU");
  await page.getByRole("button", { name: "Создать черновик" }).click();
  await expect(page).toHaveURL(/\/courses\/studio\?version=/u, {
    timeout: 15_000,
  });

  await expect(page.getByText("В черновике пока нет недель")).toBeVisible();
  await page.getByRole("button", { name: "Добавить неделю" }).click();
  const weekForm = page.getByRole("form", { name: "Добавить неделю" });
  await weekForm.getByLabel("Стабильный ID").fill("e2e-week");
  await weekForm.getByLabel("Название").fill("E2E Week");
  await weekForm.getByRole("button", { name: "Добавить неделю" }).click();
  await expect(page.getByText("E2E Week")).toBeVisible();

  await page.getByRole("button", { name: "Добавить день" }).click();
  const dayForm = page.getByRole("form", { name: "Добавить день" });
  await dayForm.getByLabel("Стабильный ID").fill("e2e-day");
  await dayForm.getByLabel("Название").fill("E2E Day");
  await dayForm.getByLabel("Цель").fill("Проверить authoring snapshot");
  await dayForm.getByRole("button", { name: "Добавить день" }).click();
  await expect(page.getByText("E2E Day")).toBeVisible();

  await addEditorUnit(page, "Первый E2E unit", "e2e-unit-first");
  await addEditorUnit(page, "Второй E2E unit", "e2e-unit-second");
  await page
    .getByRole("button", { name: "Поднять юнит Второй E2E unit" })
    .click();

  const releaseTab = page.getByRole("tab", {
    name: "Выпуск",
    exact: true,
  });
  await releaseTab.click();
  await expect(releaseTab).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Запустить проверку" }).click();
  await expect(page.getByText("Проверка пройдена")).toBeVisible();
  await page.getByRole("button", { name: "Открыть предпросмотр" }).click();
  await page
    .getByRole("button", { name: "E2E Curriculum", exact: true })
    .click();
  await expect(page.getByText("Дней: 1")).toBeVisible();
  await page.getByRole("button", { name: "Проверить изменения" }).click();
  await expect(page.getByText(/Добавлено: \d+/u)).toBeVisible();
  const publish = page.getByRole("button", {
    name: "Опубликовать неизменяемую ревизию",
  });
  await page
    .getByLabel("Я понимаю, что опубликованную ревизию нельзя редактировать.")
    .check();
  await publish.click();
  await expect(
    page.getByText("Опубликована · только чтение").first(),
  ).toBeVisible();

  const versionsResponse = await request.get(
    `${orchestratorOrigin}/api/curriculum-editor/versions`,
    { headers: { "X-Aptiloop-Client": "web", Origin: webOrigin } },
  );
  expect(versionsResponse.ok()).toBe(true);
  const versionsBody = (await versionsResponse.json()) as {
    versions: Array<{
      id: string;
      curriculumId: string;
      status: "draft" | "published" | "archived";
      title: string;
    }>;
  };
  const publishedVersion = versionsBody.versions.find(
    (version) =>
      version.title === "E2E Curriculum" && version.status === "published",
  );
  if (!publishedVersion) throw new Error("Published E2E revision is missing");

  await page.goto(
    `/courses/${encodeURIComponent(publishedVersion.curriculumId)}/revisions/${encodeURIComponent(publishedVersion.id)}`,
  );
  await expect(
    page.getByRole("heading", { name: "E2E Curriculum", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Урок 1 · E2E Day/u)).toBeVisible();
  await page.getByRole("button", { name: "Выбрать курс" }).click();
  await expect(
    page.getByRole("button", { name: "Начать занятие" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page).toHaveURL(/\/session\?id=/u);

  const currentBefore = await currentLearningSession(request);
  expect(currentBefore.snapshot.curriculumTitle).toBe("E2E Curriculum");
  const capturedVersionId = currentBefore.snapshot.curriculumVersionId;

  await page.goto(
    `/courses/studio?version=${encodeURIComponent(publishedVersion.id)}`,
  );
  await page.getByRole("button", { name: "Клонировать в черновик" }).click();
  await expect(
    page.getByRole("heading", {
      name: "E2E Curriculum",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Граф выбранной ревизии" })
      .getByText("Черновик", { exact: true }),
  ).toBeVisible();

  const currentAfter = await currentLearningSession(request);
  expect(currentAfter.snapshot.curriculumVersionId).toBe(capturedVersionId);
  expect(currentAfter.snapshot.curriculumTitle).toBe("E2E Curriculum");
});

test("runs and restores the dedicated interview workflow", async ({ page }) => {
  await page.goto("/interview");
  await expect(
    page.getByRole("radio", { name: /Только изученные/u }),
  ).toBeChecked();
  await expect(page.getByText("Темы для интервью")).toBeVisible();
  await page.getByRole("radio", { name: /Выбрать вручную/u }).check();
  await page
    .getByRole("textbox", { name: "Темы через запятую" })
    .fill("JavaScript, TypeScript");
  await page.getByRole("combobox", { name: "Количество вопросов" }).click();
  await page.getByRole("option", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "Начать интервью" }).click();

  await expect(
    page.locator('[role="status"][aria-live="polite"]'),
  ).toBeVisible();
  await page
    .getByLabel("Сообщение")
    .fill(
      "Microtasks выполняются после текущего стека до следующей macrotask; примером служит Promise callback.",
    );
  await page.getByRole("button", { name: "Отправить ответ" }).click();
  const answeredProgress = page.getByRole("progressbar", {
    name: "Отвечено: 1 из 2",
  });
  await expect(answeredProgress).toHaveAttribute("aria-valuenow", "1");
  await expect(answeredProgress).toHaveAttribute("aria-valuemax", "2");

  await page
    .getByLabel("Сообщение")
    .fill(
      "Второй ответ уточняет порядок очередей и объясняет, почему таймер выполняется после накопленных microtasks.",
    );
  await page.getByRole("button", { name: "Отправить ответ" }).click();
  await page.getByRole("button", { name: "Завершить и открыть отчёт" }).click();
  await expect(page.getByText("Отчёт по интервью")).toBeVisible();
  await expect(page.getByText("100 %", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Отчёт по интервью")).toBeVisible();
  await expect(page.getByText("100 %", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Вернуться к занятию" }),
  ).toHaveCount(0);

  await page.goto("/interview?sessionId=demo-session");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Не удалось загрузить интервью. Повторите попытку.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Вернуться к занятию" }),
  ).toHaveCount(0);
});

async function startUnit(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Начать активность" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toBeHidden();
}

async function expectExerciseDiff(page: Page, expected: string): Promise<void> {
  const diff = page.getByTestId("exercise-diff");
  if (!(await diff.isVisible())) {
    await page.getByRole("button", { name: /Diff от baseline/u }).click();
  }
  await expect(diff).toContainText(expected);
}

async function expectReviewerSummary(
  page: Page,
  expected: string,
): Promise<void> {
  const disclosure = page
    .locator('[data-slot="exercise-review-disclosure"]')
    .getByRole("button");
  await expect(disclosure).toBeVisible({ timeout: 15_000 });
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") {
    await disclosure.click();
  }
  await expect(page.getByText(expected)).toBeVisible();
}

async function checkChecklist(
  page: Page,
  expectedCount: number,
): Promise<void> {
  const checkboxes = page
    .getByRole("group", { name: "Что нужно сделать" })
    .getByRole("checkbox");
  await expect(checkboxes).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    await checkboxes.nth(index).check();
  }
}

async function addEditorUnit(
  page: Page,
  title: string,
  stableId: string,
): Promise<void> {
  await page.getByRole("button", { name: "Добавить юнит" }).click();
  const form = page.getByRole("form", { name: "Добавить юнит" });
  await form.getByLabel("Стабильный ID").fill(stableId);
  await form.getByLabel("Название").fill(title);
  await form.getByRole("button", { name: "Добавить юнит" }).click();
  await expect(page.getByText(title)).toBeVisible();
}

async function currentLearningSession(request: APIRequestContext): Promise<{
  snapshot: { curriculumTitle: string; curriculumVersionId: string };
}> {
  const response = await request.get(
    `${orchestratorOrigin}/api/learning/sessions/current`,
    { headers: { "X-Aptiloop-Client": "web", Origin: webOrigin } },
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    session: {
      snapshot: { curriculumTitle: string; curriculumVersionId: string };
    } | null;
  };
  if (!body.session) throw new Error("Expected an active learning session");
  return body.session;
}

const passingImplementation = `export interface NormalizedProfile {
  readonly id: string;
  readonly displayName: string;
  readonly age?: number;
  readonly tags: readonly string[];
}

export interface ProfileValidationIssue {
  readonly field: "profile" | "id" | "displayName" | "age" | "tags";
  readonly message: string;
}

export type NormalizeProfileResult =
  | { readonly ok: true; readonly profile: NormalizedProfile }
  | { readonly ok: false; readonly issues: readonly ProfileValidationIssue[] };

export function normalizeProfile(input: unknown): NormalizeProfileResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: [{ field: "profile", message: "Ожидался объект" }] };
  }
  const value = input as Record<string, unknown>;
  const issues: ProfileValidationIssue[] = [];
  if (typeof value.id !== "string" || value.id.trim() === "")
    issues.push({ field: "id", message: "Нужна непустая строка" });
  if (!("displayName" in value))
    issues.push({ field: "displayName", message: "Поле обязательно" });
  else if (typeof value.displayName !== "string")
    issues.push({ field: "displayName", message: "Ожидалась строка" });
  if ("age" in value && (!Number.isInteger(value.age) || (value.age as number) < 0))
    issues.push({ field: "age", message: "Нужно целое неотрицательное число" });
  if ("tags" in value && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")))
    issues.push({ field: "tags", message: "Ожидался массив строк" });
  if (issues.length > 0) return { ok: false, issues };
  const profile: { id: string; displayName: string; age?: number; tags: string[] } = {
    id: (value.id as string).trim(),
    displayName: (value.displayName as string).trim(),
    tags: Array.isArray(value.tags) ? value.tags.map((tag) => (tag as string).trim()) : [],
  };
  if ("age" in value) profile.age = value.age as number;
  return { ok: true, profile };
}
`;

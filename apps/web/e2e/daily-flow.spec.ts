import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const attemptsRoot = path.join(root, ".data", "e2e-exercise-attempts");
const orchestratorOrigin = "http://127.0.0.1:8887";
const webOrigin = "http://127.0.0.1:3100";

test.afterAll(async () => {
  const relative = path.relative(path.join(root, ".data"), attemptsRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("E2E cleanup escaped the project .data directory");
  }
  await rm(attemptsRoot, { recursive: true, force: true });
});

test("hydrates stored light and dark themes without an icon mismatch", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("hydrated but some attributes")
    ) {
      hydrationErrors.push(message.text());
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
    page.getByRole("button", { name: "Включить системную тему" }),
  ).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("completes restart-safe Day 1 through correction, summary, mastery and cards", async ({
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
  await expect(page.getByText("0 из 81 юнитов завершено")).toBeVisible();
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page).toHaveURL(/\/session\?id=/u);
  const sessionId = new URL(page.url()).searchParams.get("id");
  if (!sessionId) throw new Error("Session ID is missing from the guided flow");

  await expect(page.getByText("План дня", { exact: true })).toBeVisible();
  await expect(page.getByText("Темы", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Ожидаемые результаты", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Вне дня", { exact: true })).toBeVisible();
  await expect(page.getByText("Юниты", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Брифинг · 6 мин", { exact: true }),
  ).toBeVisible();

  await startUnit(page);
  await checkChecklist(page, 3);
  await page.getByLabel("Подтверждаю: цели и границы дня понятны").check();
  const finishBriefing = page.getByRole("button", {
    name: "Завершить briefing",
  });
  await expect(finishBriefing).toBeEnabled();
  await finishBriefing.click();

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
    const finishStudy = page.getByRole("button", { name: "Завершить study" });
    await expect(finishStudy).toBeEnabled();
    await finishStudy.click();
  }

  await startUnit(page);
  const recallAnswers = [
    "Значение — данные, binding связывает имя со значением, а объект имеет собственную identity и передаётся через ссылку.",
    "null задан явно, undefined означает отсутствие значения, а отсутствующее свойство проверяется через hasOwn или оператор in.",
    "Spread копирует только внешний уровень; structuredClone не подходит для функций и некоторых специальных значений.",
  ];
  const recallTextareas = page.locator(
    '[data-slot="unit-shell-content"] textarea',
  );
  await expect(recallTextareas).toHaveCount(recallAnswers.length);
  for (const [index, answer] of recallAnswers.entries()) {
    await recallTextareas.nth(index).fill(answer);
    await page
      .getByRole("button", { name: `Сохранить ответ ${index + 1}` })
      .click();
  }
  await page.getByRole("button", { name: "Завершить recall" }).click();

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
    .getByLabel("Ответ на уточнение Teacher")
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
  await page.getByRole("button", { name: "Завершить квиз" }).click();

  await startUnit(page);
  await page.getByLabel("Предсказание").fill("Изменятся next и state.");
  await page
    .getByLabel("Объяснение механизма")
    .fill("Оба внешних объекта сохраняют одну ссылку на вложенный profile.");
  await page
    .getByLabel("Исправление словами")
    .fill("Скопировать profile отдельно перед изменением name.");
  await page.getByRole("button", { name: "Сохранить разбор" }).click();
  await page.getByRole("button", { name: "Завершить code reading" }).click();

  await startUnit(page);
  await page.getByRole("button", { name: "Открыть практику" }).click();
  await expect(page).toHaveURL(/\/exercise\?sessionId=/u);
  await page.getByRole("button", { name: "Создать попытку" }).click();
  await expect(
    page.getByRole("button", { name: "Открыть в Zed" }),
  ).toBeVisible();

  const exerciseResponse = await request.get(
    `${orchestratorOrigin}/api/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
    {
      headers: { "X-DLH-Client": "web", Origin: webOrigin },
    },
  );
  expect(exerciseResponse.ok()).toBe(true);
  const exercise = (await exerciseResponse.json()) as {
    workspacePath: string;
  };
  const attemptRelativePath = path.relative(
    attemptsRoot,
    path.resolve(exercise.workspacePath),
  );
  expect(
    attemptRelativePath !== "" &&
      !attemptRelativePath.startsWith("..") &&
      !path.isAbsolute(attemptRelativePath),
  ).toBe(true);
  const learnerFile = path.join(
    exercise.workspacePath,
    "src",
    "normalize-profile.ts",
  );
  await writeFile(learnerFile, passingImplementation, "utf8");

  await page.getByRole("button", { name: "Обновить Git diff" }).click();
  await expect(page.getByTestId("exercise-diff")).toContainText(
    "normalizeProfile(input",
  );
  await page.getByRole("button", { name: "Запустить тесты" }).click();
  await expect(page.getByText("Тесты прошли на текущем diff")).toBeVisible();
  await page.getByRole("button", { name: "Запросить review" }).click();
  await expect(
    page.getByText(
      "Решение близко, но один краевой случай требует ещё одной попытки.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Принять review и продолжить" }),
  ).toHaveCount(0);

  await writeFile(
    learnerFile,
    `${passingImplementation}\n// correction cycle: empty input reviewed\n`,
    "utf8",
  );
  await page.getByRole("button", { name: "Запустить тесты" }).click();
  await expect(page.getByTestId("exercise-diff")).toContainText(
    "correction cycle",
  );
  await page.getByRole("button", { name: "Запросить review" }).click();
  await expect(
    page.getByText(
      "Цикл исправлений завершён: протестированное изменение теперь соответствует контракту упражнения.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Принять review и продолжить" })
    .click();
  await expect(page).toHaveURL(/\/session\?id=/u);

  await startUnit(page);
  await page.getByRole("button", { name: "Сформировать итог" }).click();
  await expect(
    page.getByRole("button", { name: "Завершить день" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Завершить день" }).click();
  await expect(page.getByText("Юнит завершён и сохранён")).toBeVisible();

  await page.getByRole("link", { name: "Карта знаний" }).click();
  await expect(page.getByText("primitive values")).toBeVisible();
  await page.getByRole("link", { name: "Ошибки" }).click();
  await expect(
    page.getByText("В квизе выбран неверный или неполный ответ."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Карточки" }).click();
  await expect(
    page.getByText("Восстановите правило, проверенное вопросом квиза."),
  ).toBeVisible();

  await page.goto("/");
  const dayTwo = page.getByRole("article", {
    name: "Scope, функции и замыкания",
  });
  await expect(
    dayTwo.getByRole("button", { name: "Начать занятие" }),
  ).toBeVisible();
});

test("publishes a curriculum graph and keeps an active session on its original revision", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto("/settings/curriculum");
  await page.getByText("Новая отдельная программа").click();
  await page.getByLabel("ID программы").fill("e2e-curriculum");
  await page.getByLabel("Slug").fill("a-e2e-curriculum");
  await page.getByLabel("Название программы").fill("E2E Curriculum");
  await page.getByLabel("Название ревизии").fill("E2E Revision");
  await page.getByRole("button", { name: "Создать черновик" }).click();

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

  const publish = page.getByRole("button", {
    name: "Опубликовать неизменяемую ревизию",
  });
  await page
    .getByLabel("Я понимаю, что опубликованную ревизию нельзя редактировать.")
    .check();
  await publish.click();
  await expect(page.getByText("Опубликована · read-only")).toBeVisible();

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "E2E Curriculum", exact: true }),
  ).toBeVisible();
  const e2eDay = page.getByRole("article", { name: "E2E Day" });
  await e2eDay.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page).toHaveURL(/\/session\?id=/u);

  const currentBefore = await currentLearningSession(request);
  expect(currentBefore.snapshot.curriculumTitle).toBe("E2E Curriculum");
  const capturedVersionId = currentBefore.snapshot.curriculumVersionId;

  await page.goto("/settings/curriculum");
  const publishedRevision = page.getByRole("button", {
    name: /r1 · E2E Revision/u,
  });
  await publishedRevision.click();
  await publishedRevision
    .locator("..")
    .getByRole("button", { name: "Клонировать в черновик" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "E2E Revision — новая редакция",
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
  await page.getByLabel("Темы через запятую").fill("JavaScript, TypeScript");
  await page.getByLabel("Количество вопросов").selectOption("2");
  await page.getByRole("button", { name: "Начать интервью" }).click();

  await expect(
    page.locator('li[role="status"][aria-live="polite"]'),
  ).toBeVisible();
  await page
    .getByLabel("Сообщение")
    .fill(
      "Microtasks выполняются после текущего стека до следующей macrotask; примером служит Promise callback.",
    );
  await page.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(page.getByText("1 / 2")).toBeVisible();

  await page
    .getByLabel("Сообщение")
    .fill(
      "Второй ответ уточняет порядок очередей и объясняет, почему таймер выполняется после накопленных microtasks.",
    );
  await page.getByRole("button", { name: "Отправить ответ" }).click();
  await page.getByRole("button", { name: "Завершить и открыть отчёт" }).click();
  await expect(page.getByText("Отчёт по интервью")).toBeVisible();
  await expect(page.getByText("100%")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Отчёт по интервью")).toBeVisible();
  await expect(page.getByText("100%")).toBeVisible();

  await page.goto("/interview?sessionId=demo-session");
  await page.getByRole("button", { name: "Вернуться к занятию" }).click();
  await expect(page).toHaveURL(/\/session\?id=demo-session/u);
});

async function startUnit(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Начать юнит" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toBeHidden();
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
    { headers: { "X-DLH-Client": "web", Origin: webOrigin } },
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

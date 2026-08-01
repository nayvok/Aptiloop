import { expect, test, type Page } from "@playwright/test";
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

  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(
    page.getByRole("button", { name: "Переключить тему" }),
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

  await startUnit(page);
  await checkChecklist(page, 3);
  await page.getByLabel("Цель и границы дня понятны").check();
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
    [
      "Spread копирует верхний уровень; structuredClone имеет ограничения.",
      4,
    ],
  ] as const) {
    await startUnit(page);
    await checkChecklist(page, checklistCount);
    await page.getByLabel("Заметки").fill(note);
    const finishStudy = page.getByRole("button", { name: "Завершить study" });
    await expect(finishStudy).toBeEnabled();
    await finishStudy.click();
  }

  await startUnit(page);
  await page
    .getByLabel("Объяснение по памяти")
    .fill(
      "Binding связывает имя со значением, объект имеет identity и передаётся через ссылку; shallow copy создаёт новый внешний объект, но сохраняет вложенные ссылки.",
    );
  await page.getByRole("button", { name: "Сохранить первую попытку" }).click();
  await page.getByRole("button", { name: "Завершить recall" }).click();

  await startUnit(page);
  await page
    .getByLabel("Уточнённое объяснение")
    .fill(
      "При shallow copy меняется identity внешнего объекта, но вложенный profile остаётся общей ссылкой, поэтому его мутация видна через обе структуры.",
    );
  await page.getByRole("button", { name: "Отправить revision" }).click();
  await expect(
    page.getByText(
      "What is one concrete difference between a shallow copy and a deep copy?",
    ),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Завершить quiz" }).click();

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
      "The solution is close, but one edge case needs another attempt.",
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
      "The correction cycle is complete and the tested learner change now meets the exercise contract.",
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

async function startUnit(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Начать юнит" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toBeHidden();
}

async function checkChecklist(page: Page, expectedCount: number): Promise<void> {
  const checkboxes = page
    .getByRole("group", { name: "Checklist" })
    .getByRole("checkbox");
  await expect(checkboxes).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    await checkboxes.nth(index).check();
  }
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

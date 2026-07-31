import { expect, test } from "@playwright/test";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const exerciseRoot = path.resolve(
  import.meta.dirname,
  "../../../workspaces/exercises/week-01/day-01/normalize-profile",
);
const exerciseFile = path.join(exerciseRoot, "src", "normalize-profile.ts");
let originalExercise: string;

test.beforeEach(async () => {
  originalExercise = await readFile(exerciseFile, "utf8");
});

test.afterEach(async () => {
  await writeFile(exerciseFile, originalExercise, "utf8");
  await rm(path.join(exerciseRoot, ".git"), { recursive: true, force: true });
});

test("completes a learning day through diff, review, mastery, and cards", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Неделя 1/u })).toBeVisible();
  await page.getByRole("button", { name: "Начать занятие" }).click();
  await expect(page).toHaveURL(/\/session\?id=/u);

  await page
    .getByLabel("Твоё объяснение")
    .fill(
      "Значение хранит данные, а переменная связывает имя со значением в конкретной лексической области видимости.",
    );
  await page.getByRole("button", { name: "Сохранить ответ" }).click();

  await expect(page.getByText("Teacher", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/What is one concrete difference/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Перейти к практике/u }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Перейти к практике/u }).click();
  await expect(page).toHaveURL(/\/exercise\?sessionId=/u);
  await page.getByRole("button", { name: "Создать попытку" }).click();
  await expect(
    page.getByRole("button", { name: "Открыть в Zed" }),
  ).toBeVisible();

  await writeFile(
    exerciseFile,
    `${originalExercise}\n// E2E: самостоятельная правка пользователя\n`,
    "utf8",
  );
  await page.getByRole("button", { name: "Показать Git diff" }).click();
  await expect(page.getByTestId("exercise-diff")).toContainText(
    "самостоятельная правка пользователя",
  );

  await page.getByRole("button", { name: "Запустить тесты" }).click();
  await expect(page.getByText(/exit code:/u)).toBeVisible();
  await page.getByRole("button", { name: "Запросить review" }).click();
  await expect(page.getByText(/The solution is close/u)).toBeVisible();

  await page.getByRole("button", { name: "Завершить учебный день" }).click();
  await expect(page).toHaveURL(/\/knowledge\?completed=1/u);
  await expect(page.getByText("Control-flow analysis и unknown")).toBeVisible();

  await page.getByRole("link", { name: "Карточки" }).click();
  await expect(page.getByText(/Как кратко объяснить тему/u)).toBeVisible();
});

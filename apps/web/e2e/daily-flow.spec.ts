import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
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

async function seedRussianInterface(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "aptiloop.ui-locale",
      value: "ru-RU",
      url: webOrigin,
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem("aptiloop:ui-locale", "ru-RU");
  });
}

test("hydrates stored light and dark themes without an icon mismatch", async ({
  context,
  page,
}) => {
  const browserErrors: string[] = [];
  const interfaceMutations: string[] = [];
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
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/settings(?:\/locale)?$/u.test(new URL(request.url()).pathname)
    ) {
      interfaceMutations.push(request.url());
    }
  });
  const response = await page.goto("/");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
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
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("aptiloop:ui-locale"),
    ),
  ).toBe("ru-RU");
  expect(
    (await context.cookies()).find(
      (cookie) => cookie.name === "aptiloop.ui-locale",
    )?.value,
  ).toBe("ru-RU");
  expect(interfaceMutations).toEqual([]);

  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru-RU");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page).toHaveURL(/\/settings$/u, { timeout: 15_000 });
  await expect(page).toHaveTitle("Настройки · Aptiloop", { timeout: 15_000 });
  const themePreference = page.getByLabel("Тема");
  await expect(themePreference).toContainText("Тёмная");

  await themePreference.click();
  await page.getByRole("option", { name: "Светлая" }).click();
  await expect(page.locator("html")).toHaveClass(/light/u);
  expect(await page.evaluate(() => window.localStorage.getItem("theme"))).toBe(
    "light",
  );

  await page.getByRole("button", { name: "Включить тему: Тёмная" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(themePreference).toContainText("Тёмная");

  await page.getByRole("button", { name: "Включить тему: Системная" }).click();
  await expect(themePreference).toContainText("Системная");
  expect(await page.evaluate(() => window.localStorage.getItem("theme"))).toBe(
    "system",
  );

  await page.reload();
  await expect(page.getByLabel("Тема")).toContainText("Системная");
  expect(browserErrors).toEqual([]);
});

test("hydrates a collapsed desktop rail without an expanded-frame flash", async ({
  context,
  page,
}) => {
  await seedRussianInterface(page);
  await context.addCookies([
    {
      name: "aptiloop.sidebar-collapsed",
      value: "true",
      url: webOrigin,
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem("aptiloop:sidebar-collapsed", "true");
    const observedStates: string[] = [];
    Object.defineProperty(window, "__aptiloopSidebarStates", {
      configurable: true,
      value: observedStates,
    });
    const recordSidebarState = () => {
      const state = document
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-state");
      if (state && observedStates.at(-1) !== state) observedStates.push(state);
    };
    new MutationObserver(recordSidebarState).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-state"],
    });
  });

  await page.goto("/");
  const sidebar = page.locator('[data-slot="sidebar"]');
  const sidebarHeader = page.locator('[data-slot="sidebar-header"]');
  const sidebarBrand = page.locator('[data-slot="sidebar-brand"]');
  const utilityHeader = page.locator('[data-slot="utility-header"]');
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0))
    .toBe(72);
  await expect
    .poll(async () =>
      Math.round((await utilityHeader.boundingBox())?.height ?? 0),
    )
    .toBe(72);
  await expect
    .poll(async () => {
      const rail = await sidebar.boundingBox();
      const corner = await sidebarHeader.boundingBox();
      const brand = await sidebarBrand.boundingBox();
      return rail && corner && brand
        ? {
            corner: [Math.round(corner.width), Math.round(corner.height)],
            inset: [
              Math.round(brand.x - corner.x),
              Math.round(brand.y - corner.y),
              Math.round(corner.x + corner.width - brand.x - brand.width),
              Math.round(corner.y + corner.height - brand.y - brand.height),
            ],
            railWidth: Math.round(rail.width),
          }
        : null;
    })
    .toEqual({
      corner: [72, 72],
      inset: [0, 12, 0, 12],
      railWidth: 72,
    });

  const collapsedNavLink = sidebar
    .locator('[data-slot="sidebar-primary-navigation"]')
    .locator('[data-slot="sidebar-link"]')
    .first();
  await expect
    .poll(async () => {
      const box = await collapsedNavLink.boundingBox();
      return box ? [Math.round(box.width), Math.round(box.height)] : [];
    })
    .toEqual([48, 48]);
  await expect(sidebar.getByRole("link", { name: /Aptiloop/u })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-sidebar-collapsed",
    "true",
  );
  const observedStates = await page.evaluate(
    () =>
      (window as typeof window & { __aptiloopSidebarStates?: string[] })
        .__aptiloopSidebarStates ?? [],
  );
  expect(observedStates).toContain("collapsed");
  expect(observedStates).not.toContain("expanded");
});

for (const preference of [
  {
    cookie: "false",
    stored: "true",
    expectedState: "collapsed",
    expectedWidth: 72,
    expectedLabelDisplay: "none",
  },
  {
    cookie: "true",
    stored: "false",
    expectedState: "expanded",
    expectedWidth: 248,
    expectedLabelDisplay: "block",
  },
] as const) {
  test(`keeps the ${preference.expectedState} rail visually stable while local storage overrides its cookie`, async ({
    context,
    page,
  }) => {
    await seedRussianInterface(page);
    await context.addCookies([
      {
        name: "aptiloop.sidebar-collapsed",
        value: preference.cookie,
        url: webOrigin,
      },
    ]);
    await page.addInitScript((stored) => {
      window.localStorage.setItem("aptiloop:sidebar-collapsed", stored);
      const samples: string[] = [];
      Object.defineProperty(window, "__aptiloopSidebarVisualStates", {
        configurable: true,
        value: samples,
      });
      let frames = 0;
      const recordVisualState = () => {
        const sidebar = document.querySelector<HTMLElement>(
          '[data-slot="sidebar"]',
        );
        const label = document.querySelector<HTMLElement>(
          '[data-slot="sidebar-link-label"]',
        );
        if (sidebar && label) {
          const labelStyle = getComputedStyle(label);
          const sample = [
            Math.round(sidebar.getBoundingClientRect().width),
            labelStyle.display,
            labelStyle.visibility,
          ].join(":");
          if (samples.at(-1) !== sample) samples.push(sample);
        }
        frames += 1;
        if (
          frames < 120 &&
          !samples.some((sample) => {
            const [width, , visibility] = sample.split(":");
            return Number(width) > 0 && visibility !== "hidden";
          })
        ) {
          requestAnimationFrame(recordVisualState);
        }
      };
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          requestAnimationFrame(recordVisualState);
        },
        {
          once: true,
        },
      );
    }, preference.stored);

    await page.goto("/");
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar).toHaveAttribute(
      "data-state",
      preference.expectedState,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-sidebar-collapsed",
      preference.stored,
    );
    await expect
      .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0))
      .toBe(preference.expectedWidth);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __aptiloopSidebarVisualStates?: string[];
              }
            ).__aptiloopSidebarVisualStates?.some((sample) => {
              const [width, , visibility] = sample.split(":");
              return Number(width) > 0 && visibility !== "hidden";
            }) ?? false,
        ),
      )
      .toBe(true);

    const samples = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __aptiloopSidebarVisualStates?: string[];
          }
        ).__aptiloopSidebarVisualStates ?? [],
    );
    const visibleSamples = samples.filter((sample) => {
      const [width, , visibility] = sample.split(":");
      return Number(width) > 0 && visibility !== "hidden";
    });
    expect(visibleSamples.length).toBeGreaterThan(0);
    for (const sample of visibleSamples) {
      const [width, display, visibility] = sample.split(":");
      expect(Number(width)).toBe(preference.expectedWidth);
      expect(display).toBe(preference.expectedLabelDisplay);
      expect(visibility).not.toBe("hidden");
    }
  });
}

test("completes restart-safe Day 1 through correction, summary, mastery and review", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedRussianInterface(page);
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
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeVisible();

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
  await page.getByRole("button", { name: "Продолжить" }).click();
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
    page.getByRole("cell", { name: "primitive values", exact: true }),
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
  await seedRussianInterface(page);
  await page.goto("/courses/new");
  await page.getByRole("link", { name: "Создать пустой черновик" }).click();
  await expect(page).toHaveURL(/\/courses\/new\/manual$/u, {
    timeout: 15_000,
  });
  await page.getByLabel("Название программы").fill("E2E Curriculum");
  await page.getByLabel("Основная локаль курса").click();
  await page.getByRole("option", { name: /ru-RU/u }).click();
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
  await seedRussianInterface(page);
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

const responsiveMatrix = [
  {
    label: "1586x992 Home expanded",
    viewport: { width: 1586, height: 992 },
    path: "/",
    locale: "en-US",
    theme: "light",
    collapsed: false,
    ready: '[data-slot="home-primary-action"]',
    primaryAction: '[data-slot="home-primary-action"]',
  },
  {
    label: "1440x900 Courses expanded",
    viewport: { width: 1440, height: 900 },
    path: "/courses",
    locale: "ru-RU",
    theme: "dark",
    collapsed: false,
    ready: '[data-slot="page-header"]',
    primaryAction: '[data-slot="page-header"] [data-slot="button"]',
  },
  {
    label: "1280x800 Review expanded",
    viewport: { width: 1280, height: 800 },
    path: "/review",
    locale: "en-US",
    theme: "light",
    collapsed: false,
    ready: '[data-slot="review-destination-navigation"]',
    primaryAction: '[data-slot="review-destination-navigation"] [role="tab"]',
  },
  {
    label: "1280x800 Skills collapsed",
    viewport: { width: 1280, height: 800 },
    path: "/skills",
    locale: "ru-RU",
    theme: "dark",
    collapsed: true,
    ready: '[data-slot="page-header"]',
    primaryAction: 'main [data-slot="button"]',
  },
  {
    label: "1024x768 Settings expanded",
    viewport: { width: 1024, height: 768 },
    path: "/settings",
    locale: "en-US",
    theme: "dark",
    collapsed: false,
    ready: '[data-slot="settings-form"]',
    primaryAction: '[data-slot="settings-form"] [data-slot="button"]',
  },
  {
    label: "768x1024 Courses collapsed",
    viewport: { width: 768, height: 1024 },
    path: "/courses",
    locale: "ru-RU",
    theme: "light",
    collapsed: true,
    ready: '[data-slot="page-header"]',
    primaryAction: '[data-slot="page-header"] [data-slot="button"]',
  },
  {
    label: "390x844 Review mobile",
    viewport: { width: 390, height: 844 },
    path: "/review",
    locale: "en-US",
    theme: "dark",
    collapsed: false,
    ready: '[data-slot="review-destination-navigation"]',
    primaryAction:
      '[data-slot="review-destination-navigation"] [data-slot="select-trigger"]',
  },
  {
    label: "320x700 Session mobile",
    viewport: { width: 320, height: 700 },
    path: "session",
    locale: "ru-RU",
    theme: "light",
    collapsed: false,
    ready: '[data-slot="session-progress-header"]',
    primaryAction: 'main [data-slot="button"]',
  },
  {
    label: "effective 200% reflow from 1280x800",
    viewport: { width: 640, height: 400 },
    path: "/",
    locale: "en-US",
    theme: "dark",
    collapsed: false,
    reducedMotion: true,
    ready: '[data-slot="home-primary-action"]',
    primaryAction: '[data-slot="home-primary-action"]',
  },
] as const;

test("keeps the seeded daily flow usable across the responsive accessibility matrix", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const sessionId = await ensureSeededResponsiveSession(request);

  for (const scenario of responsiveMatrix) {
    await test.step(scenario.label, async () => {
      const page = await openResponsiveMatrixPage(browser, scenario);
      try {
        const path =
          scenario.path === "session"
            ? `/session?id=${encodeURIComponent(sessionId)}`
            : scenario.path;
        await page.goto(path);
        await expect(page.locator(scenario.ready).first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          scenario.locale,
        );
        await expect(page.locator("html")).toHaveClass(
          new RegExp(`(?:^|\\s)${scenario.theme}(?:\\s|$)`, "u"),
        );

        await expectResponsiveShell(page, scenario.viewport.width);
        await expectNoDocumentOverflow(page);
        await expectPrimaryActionIsUsable(page, scenario.primaryAction);

        if (scenario.viewport.width < 768) {
          await expectMobileTouchTargets(page);
          await expectMobileContentTailAboveNavigation(page);
          if (scenario.path === "session") {
            await expectMobileLessonDurations(page);
          }
        }
        if ("reducedMotion" in scenario && scenario.reducedMotion) {
          await expectReducedMotion(page);
        }
      } finally {
        await page.context().close();
      }
    });
  }
});

async function openResponsiveMatrixPage(
  browser: Browser,
  scenario: (typeof responsiveMatrix)[number],
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: webOrigin,
    colorScheme: scenario.theme,
    reducedMotion:
      "reducedMotion" in scenario && scenario.reducedMotion
        ? "reduce"
        : "no-preference",
    viewport: scenario.viewport,
  });
  await context.addCookies([
    {
      name: "aptiloop.ui-locale",
      value: scenario.locale,
      url: webOrigin,
    },
    {
      name: "aptiloop.sidebar-collapsed",
      value: String(scenario.collapsed),
      url: webOrigin,
    },
  ]);
  const page = await context.newPage();
  await page.addInitScript(
    ({ collapsed, locale, theme }) => {
      window.localStorage.setItem("aptiloop:ui-locale", locale);
      window.localStorage.setItem(
        "aptiloop:sidebar-collapsed",
        String(collapsed),
      );
      window.localStorage.setItem("theme", theme);
    },
    {
      collapsed: scenario.collapsed,
      locale: scenario.locale,
      theme: scenario.theme,
    },
  );
  return page;
}

async function expectResponsiveShell(
  page: Page,
  viewportWidth: number,
): Promise<void> {
  const utilityHeader = page.locator('[data-slot="utility-header"]');
  await expect(utilityHeader).toBeVisible();
  await expect
    .poll(async () =>
      Math.round((await utilityHeader.boundingBox())?.height ?? 0),
    )
    .toBe(72);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--shell-bar-size")
        .trim(),
    ),
  ).toBe("4.5rem");

  const desktopNavigation = page.locator(
    '[data-slot="sidebar"] nav[aria-label]',
  );
  const mobileNavigation = page.locator('[data-slot="mobile-navigation"]');
  if (viewportWidth >= 768) {
    await expect(desktopNavigation).toBeVisible();
    await expect(mobileNavigation).toBeHidden();
    await expect(desktopNavigation.getByRole("link")).toHaveCount(5);
    const sidebar = page.locator('[data-slot="sidebar"]');
    const sidebarHeader = page.locator('[data-slot="sidebar-header"]');
    await expect
      .poll(async () =>
        Math.round((await sidebarHeader.boundingBox())?.height ?? 0),
      )
      .toBe(72);
    if ((await sidebar.getAttribute("data-state")) === "collapsed") {
      await expect
        .poll(async () => {
          const rail = await sidebar.boundingBox();
          const corner = await sidebarHeader.boundingBox();
          return rail && corner
            ? [
                Math.round(rail.width),
                Math.round(corner.width),
                Math.round(corner.height),
              ]
            : [];
        })
        .toEqual([72, 72, 72]);
    }
  } else {
    await expect(desktopNavigation).toBeHidden();
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileNavigation.getByRole("link")).toHaveCount(5);
  }
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        bodyFits: document.body.scrollWidth <= document.body.clientWidth,
        documentFits:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      })),
    )
    .toEqual({
      bodyFits: true,
      documentFits: true,
    });
}

async function expectMobileContentTailAboveNavigation(
  page: Page,
): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight }),
  );
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const main = document.querySelector("main");
        const content = main?.lastElementChild;
        const navigation = document.querySelector(
          '[data-slot="mobile-navigation"]',
        );
        if (!content || !navigation) return null;
        return Math.floor(
          navigation.getBoundingClientRect().top -
            content.getBoundingClientRect().bottom,
        );
      }),
    )
    .toBeGreaterThanOrEqual(8);
}

async function expectMobileLessonDurations(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Шаги урока" }).click();
  const plan = page.getByRole("dialog", { name: "Шаги урока" });
  await expect(plan).toBeVisible();
  const durations = plan.locator('[data-slot="estimated-duration"]');
  expect(await durations.count()).toBeGreaterThan(0);
  for (let index = 0; index < (await durations.count()); index += 1) {
    const duration = durations.nth(index);
    await expect(duration).toContainText("Примерно");
    const layout = await duration.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const parentBox = element.parentElement?.getBoundingClientRect();
      return {
        parentRight: parentBox?.right ?? 0,
        rectCount: element.getClientRects().length,
        right: box.right,
        whiteSpace: getComputedStyle(element).whiteSpace,
      };
    });
    expect(layout.whiteSpace).toBe("nowrap");
    expect(layout.rectCount).toBe(1);
    expect(layout.right).toBeLessThanOrEqual(layout.parentRight + 1);
  }
  await page.keyboard.press("Escape");
  await expect(plan).toBeHidden();
}

async function expectPrimaryActionIsUsable(
  page: Page,
  selector: string,
): Promise<void> {
  const action = await firstVisible(page.locator(selector));
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

async function firstVisible(locator: Locator): Promise<Locator> {
  for (let index = 0; index < (await locator.count()); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  throw new Error("Expected at least one visible primary action");
}

async function expectMobileTouchTargets(page: Page): Promise<void> {
  const targets = page.locator(
    '[data-slot="mobile-navigation"] a, main [data-slot="button"], main [data-slot="select-trigger"], main [role="tab"]',
  );
  let visibleTargets = 0;
  for (let index = 0; index < (await targets.count()); index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    visibleTargets += 1;
    const box = await target.boundingBox();
    expect(box, `touch target ${index} must have a box`).not.toBeNull();
    expect(box!.width, `touch target ${index} width`).toBeGreaterThanOrEqual(
      44,
    );
    expect(box!.height, `touch target ${index} height`).toBeGreaterThanOrEqual(
      44,
    );
  }
  expect(visibleTargets).toBeGreaterThanOrEqual(6);
}

async function expectReducedMotion(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  const durations = await page
    .locator('[data-slot="app-shell"]')
    .evaluate((shell) => {
      const samples = [
        shell,
        ...shell.querySelectorAll('[data-slot="button"]'),
      ];
      return samples.flatMap((element) => {
        const style = getComputedStyle(element);
        return [style.animationDuration, style.transitionDuration];
      });
    });
  for (const duration of durations) {
    for (const value of duration.split(",")) {
      const normalized = value.trim();
      const milliseconds = normalized.endsWith("ms")
        ? Number.parseFloat(normalized)
        : Number.parseFloat(normalized) * 1000;
      expect(milliseconds).toBeLessThanOrEqual(0.01);
    }
  }
}

async function ensureSeededResponsiveSession(
  request: APIRequestContext,
): Promise<string> {
  const headers = { "X-Aptiloop-Client": "web", Origin: webOrigin };
  const currentResponse = await request.get(
    `${orchestratorOrigin}/api/learning/sessions/current`,
    { headers },
  );
  expect(currentResponse.ok()).toBe(true);
  const current = (await currentResponse.json()) as {
    session: { id: string } | null;
  };
  if (current.session) return current.session.id;

  const pathResponse = await request.get(
    `${orchestratorOrigin}/api/learning/path`,
    { headers },
  );
  expect(pathResponse.ok()).toBe(true);
  const learningPath = (await pathResponse.json()) as {
    nextAction: { type: string; lessonId: string } | null;
  };
  if (learningPath.nextAction?.type !== "start") {
    throw new Error("Seeded E2E data has no session or startable lesson");
  }
  const response = await request.post(
    `${orchestratorOrigin}/api/learning/sessions/v2`,
    {
      data: {
        dayId: learningPath.nextAction.lessonId,
        operationId: crypto.randomUUID(),
      },
      headers,
    },
  );
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { session: { id: string } };
  return created.session.id;
}

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

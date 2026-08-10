import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CurriculumEditorClient } from "@/components/curriculum-editor-client";
import { LocaleProvider } from "@/lib/i18n";

const { apiMock, fetchMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  fetchMock: vi.fn(),
}));

const now = 1_722_000_000_000;

function version(
  id: string,
  revision: number,
  status: "draft" | "published",
  parentVersionId: string | null = null,
) {
  return {
    id,
    curriculumId: "curriculum-js",
    revision,
    parentVersionId,
    status,
    title:
      revision === 1
        ? "JavaScript foundation"
        : "JavaScript foundation — редакция",
    description: "Программа",
    contentHash: status === "published" ? `hash-${revision}` : null,
    createdAt: now,
    publishedAt: status === "published" ? now : null,
    archivedAt: null,
    updatedAt: now,
  };
}

function listItem(value: ReturnType<typeof version>) {
  return { ...value, curriculumSlug: "javascript-foundation" };
}

function week(id: string, versionId: string, title = "Неделя 1") {
  return {
    id,
    versionId,
    stableId: "week-1",
    orderIndex: 0,
    title,
    description: "Основы",
    createdAt: now,
    updatedAt: now,
    days: [] as ReturnType<typeof day>[],
  };
}

function day(id: string, versionId: string, weekId: string) {
  return {
    id,
    versionId,
    weekId,
    stableId: "day-1",
    orderIndex: 0,
    title: "День 1",
    description: null,
    goal: "Понять значения",
    estimatedMinutes: 60,
    prerequisites: [],
    expectedOutcomes: [],
    depthLevel: "foundation" as const,
    outOfScope: [],
    topics: [],
    createdAt: now,
    updatedAt: now,
    units: [] as ReturnType<typeof unit>[],
  };
}

function unit(
  id: string,
  versionId: string,
  dayId: string,
  title: string,
  stableId: string,
  orderIndex: number,
) {
  return {
    id,
    versionId,
    dayId,
    stableId,
    type: "briefing" as const,
    orderIndex,
    title,
    description: null,
    estimatedMinutes: 10 as number | null,
    objectives: [],
    checklist: [],
    sources: [],
    questions: [],
    misconceptions: [],
    referenceAnswer: null,
    completionCriteria: [{ type: "acknowledgement" }],
    unlockRules: [],
    optional: false,
    depthLevel: "foundation" as
      "foundation" | "interview-ready" | "deep-dive" | null,
    payload: { type: "briefing", scope: [] },
    createdAt: now,
    updatedAt: now,
  };
}

function renderEditor(children: ReactNode = <CurriculumEditorClient />) {
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
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^\/api/u, "");
      const result: unknown = await apiMock(
        path,
        init?.method ? init : undefined,
      );
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
  });
  let counter = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => `operation-${++counter}`) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CurriculumEditorClient", () => {
  it("creates a draft graph, reorders units, and publishes only after explicit acknowledgement", async () => {
    const versions: ReturnType<typeof listItem>[] = [];
    const graphs = new Map<
      string,
      { version: ReturnType<typeof version>; weeks: ReturnType<typeof week>[] }
    >();
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) return { versions };
      if (path === "/curriculum-editor/versions" && init?.method === "POST") {
        const created = version("draft-1", 1, "draft");
        versions.push(listItem(created));
        graphs.set(created.id, { version: created, weeks: [] });
        return { version: created };
      }
      const graphMatch = path.match(
        /^\/curriculum-editor\/versions\/([^/]+)$/u,
      );
      if (graphMatch && !init)
        return { curriculum: structuredClone(graphs.get(graphMatch[1]!)!) };
      const draftHash = `sha256:${"1".repeat(64)}`;
      if (path.endsWith("/validation") && !init)
        return {
          report: {
            validatorVersion: "m9-v1",
            versionId: "draft-1",
            draftHash,
            validationHash: `sha256:${"2".repeat(64)}`,
            valid: true,
            errors: 0,
            warnings: 0,
            diagnostics: [],
          },
        };
      if (path.endsWith("/preview") && !init) {
        const graph = graphs.get("draft-1")!;
        return {
          preview: {
            versionId: "draft-1",
            title: graph.version.title,
            description: graph.version.description,
            draftHash,
            weeks: graph.weeks.map((item) => ({
              stableId: item.stableId,
              title: item.title,
              description: item.description,
              days: item.days.map((lesson) => ({
                stableId: lesson.stableId,
                title: lesson.title,
                description: lesson.description,
                goal: lesson.goal,
                estimatedMinutes: lesson.estimatedMinutes,
                expectedOutcomes: lesson.expectedOutcomes,
                topics: lesson.topics,
                activities: lesson.units.map((activity) => ({
                  stableId: activity.stableId,
                  type: activity.type,
                  title: activity.title,
                  description: activity.description,
                  estimatedMinutes: activity.estimatedMinutes,
                  objectives: activity.objectives,
                  checklist: activity.checklist,
                  sources: activity.sources,
                  optional: activity.optional,
                })),
              })),
            })),
          },
        };
      }
      if (path.endsWith("/change-review") && !init)
        return {
          review: {
            versionId: "draft-1",
            parentVersionId: null,
            draftHash,
            changeReviewHash: `sha256:${"3".repeat(64)}`,
            added: 4,
            changed: 0,
            removed: 0,
            ready: true,
          },
        };
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path.endsWith("/weeks") && init?.method === "POST") {
        const graph = graphs.get("draft-1")!;
        const created = week("week-id", "draft-1", String(body.title));
        graph.weeks.push(created);
        return { week: created };
      }
      if (path.endsWith("/days") && init?.method === "POST") {
        const graph = graphs.get("draft-1")!;
        const created = day("day-id", "draft-1", "week-id");
        created.title = String(body.title);
        graph.weeks[0]!.days.push(created);
        return { day: created };
      }
      if (path.endsWith("/units") && init?.method === "POST") {
        const graph = graphs.get("draft-1")!;
        const units = graph.weeks[0]!.days[0]!.units;
        const created = unit(
          `unit-${units.length + 1}`,
          "draft-1",
          "day-id",
          String(body.title),
          String(body.stableId),
          units.length,
        );
        units.push(created);
        return { unit: created };
      }
      if (path.endsWith("/units/reorder") && init?.method === "POST") {
        const graph = graphs.get("draft-1")!;
        const units = graph.weeks[0]!.days[0]!.units;
        const byId = new Map(units.map((item) => [item.id, item]));
        graph.weeks[0]!.days[0]!.units = (body.orderedIds as string[]).map(
          (id, index) => ({ ...byId.get(id)!, orderIndex: index }),
        );
        return { curriculum: structuredClone(graph) };
      }
      if (path.endsWith("/publish") && init?.method === "POST") {
        const graph = graphs.get("draft-1")!;
        graph.version = {
          ...graph.version,
          status: "published",
          publishedAt: now,
          contentHash: "hash-1",
        };
        versions[0] = listItem(graph.version);
        return { version: graph.version };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    expect(await screen.findByText("Ревизий пока нет.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Создать новую редакцию"));
    fireEvent.change(screen.getByLabelText("ID программы"), {
      target: { value: "curriculum-js" },
    });
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "javascript-foundation" },
    });
    fireEvent.change(screen.getByLabelText("Название программы"), {
      target: { value: "JavaScript" },
    });
    fireEvent.change(screen.getByLabelText("Название ревизии"), {
      target: { value: "JavaScript foundation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать черновик" }));

    expect(
      await screen.findByText("В черновике пока нет недель"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Добавить неделю" }));
    const weekForm = screen.getByRole("form", { name: "Добавить неделю" });
    fireEvent.change(within(weekForm).getByLabelText("Стабильный ID"), {
      target: { value: "week-1" },
    });
    fireEvent.change(within(weekForm).getByLabelText("Название"), {
      target: { value: "Неделя 1" },
    });
    fireEvent.click(
      within(weekForm).getByRole("button", { name: "Добавить неделю" }),
    );

    expect(await screen.findByText("Неделя 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Добавить день" }));
    const dayForm = screen.getByRole("form", { name: "Добавить день" });
    fireEvent.change(within(dayForm).getByLabelText("Стабильный ID"), {
      target: { value: "day-1" },
    });
    fireEvent.change(within(dayForm).getByLabelText("Название"), {
      target: { value: "День 1" },
    });
    fireEvent.change(within(dayForm).getByLabelText("Цель"), {
      target: { value: "Понять значения" },
    });
    fireEvent.click(
      within(dayForm).getByRole("button", { name: "Добавить день" }),
    );

    expect(await screen.findByText("День 1")).toBeInTheDocument();
    async function addUnit(title: string, stableId: string) {
      fireEvent.click(screen.getByRole("button", { name: "Добавить юнит" }));
      const form = screen.getByRole("form", { name: "Добавить юнит" });
      fireEvent.change(within(form).getByLabelText("Стабильный ID"), {
        target: { value: stableId },
      });
      fireEvent.change(within(form).getByLabelText("Название"), {
        target: { value: title },
      });
      fireEvent.click(
        within(form).getByRole("button", { name: "Добавить юнит" }),
      );
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    await addUnit("Первый юнит", "unit-first");
    await addUnit("Второй юнит", "unit-second");
    fireEvent.click(
      screen.getByRole("button", { name: "Поднять юнит Второй юнит" }),
    );
    await waitFor(() =>
      expect(
        graphs
          .get("draft-1")!
          .weeks[0]!.days[0]!.units.map((item) => item.title),
      ).toEqual(["Второй юнит", "Первый юнит"]),
    );

    const publish = screen.getByRole("button", {
      name: "Опубликовать неизменяемую ревизию",
    });
    expect(publish).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Запустить проверку" }));
    expect(await screen.findByText("Проверка пройдена")).toBeInTheDocument();
    const previewAction = screen.getByRole("button", {
      name: "Открыть предпросмотр",
    });
    await waitFor(() => expect(previewAction).toBeEnabled());
    fireEvent.click(previewAction);
    expect(await screen.findByText(/Дней: 1/u)).toBeInTheDocument();
    const reviewAction = screen.getByRole("button", {
      name: "Проверить изменения",
    });
    await waitFor(() => expect(reviewAction).toBeEnabled());
    fireEvent.click(reviewAction);
    expect(
      await screen.findByText("Добавлено: 4 · Изменено: 0 · Удалено: 0"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText(
        "Я понимаю, что опубликованную ревизию нельзя редактировать.",
      ),
    );
    fireEvent.click(publish);
    expect(
      (await screen.findAllByText("Опубликована · только чтение")).length,
    ).toBeGreaterThan(0);
    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining("/publish"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clones a published revision and edits only the draft DTO", async () => {
    const sourceVersion = version("published-1", 1, "published");
    const sourceWeek = week(
      "source-week",
      sourceVersion.id,
      "Оригинальная неделя",
    );
    const original = { version: sourceVersion, weeks: [sourceWeek] };
    const versions = [listItem(sourceVersion)];
    const graphs = new Map([[sourceVersion.id, structuredClone(original)]]);
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) return { versions };
      if (path === `/curriculum-editor/versions/${sourceVersion.id}` && !init)
        return { curriculum: structuredClone(graphs.get(sourceVersion.id)!) };
      if (path.endsWith("/clone") && init?.method === "POST") {
        const draftVersion = version("draft-2", 2, "draft", sourceVersion.id);
        const draftGraph = structuredClone(original);
        draftGraph.version = draftVersion;
        draftGraph.weeks[0]!.id = "draft-week";
        draftGraph.weeks[0]!.versionId = draftVersion.id;
        graphs.set(draftVersion.id, draftGraph);
        versions.unshift(listItem(draftVersion));
        return { version: draftVersion };
      }
      if (path === "/curriculum-editor/versions/draft-2" && !init)
        return { curriculum: structuredClone(graphs.get("draft-2")!) };
      if (path.endsWith("/weeks/draft-week") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { title: string };
        const draftWeek = graphs.get("draft-2")!.weeks[0]!;
        draftWeek.title = body.title;
        return { week: draftWeek };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    expect(await screen.findByText("Оригинальная неделя")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Клонировать в черновик" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
    const form = screen.getByRole("form", {
      name: "Редактировать неделю Оригинальная неделя",
    });
    fireEvent.change(within(form).getByLabelText("Название"), {
      target: { value: "Изменённая неделя" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Сохранить неделю" }),
    );
    expect(await screen.findByText("Изменённая неделя")).toBeInTheDocument();
    expect(original.weeks[0]!.title).toBe("Оригинальная неделя");
    expect(graphs.get("published-1")!.weeks[0]!.title).toBe(
      "Оригинальная неделя",
    );
  });

  it("rejects an API response carrying a protected runtime field", async () => {
    apiMock.mockResolvedValue({
      versions: [],
      secret: "must-not-reach-browser-state",
    });
    renderEditor();
    expect(
      await screen.findByText("Не удалось получить данные"),
    ).toBeInTheDocument();
    expect(screen.getByText("Список ревизий недоступен.")).toBeInTheDocument();
    expect(
      screen.queryByText("must-not-reach-browser-state"),
    ).not.toBeInTheDocument();
  });

  it("preserves inherited unit fields and requires confirmation before cascade delete", async () => {
    const draftVersion = version("draft-nullable", 2, "draft");
    const draftWeek = week("week-nullable", draftVersion.id);
    const draftDay = day("day-nullable", draftVersion.id, draftWeek.id);
    const inheritedUnit = unit(
      "unit-nullable",
      draftVersion.id,
      draftDay.id,
      "Наследуемый юнит",
      "unit-nullable",
      0,
    );
    inheritedUnit.estimatedMinutes = null;
    inheritedUnit.depthLevel = null;
    draftDay.units.push(inheritedUnit);
    draftWeek.days.push(draftDay);
    const graph = { version: draftVersion, weeks: [draftWeek] };
    const sentBodies: Array<Record<string, unknown>> = [];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init)
        return { versions: [listItem(draftVersion)] };
      if (path === `/curriculum-editor/versions/${draftVersion.id}` && !init)
        return { curriculum: structuredClone(graph) };
      if (path.endsWith("/units/unit-nullable") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        sentBodies.push(body);
        return { unit: inheritedUnit };
      }
      if (path.endsWith("/weeks/week-nullable") && init?.method === "DELETE") {
        sentBodies.push(
          JSON.parse(String(init.body)) as Record<string, unknown>,
        );
        return { deleted: true };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    expect(await screen.findByText("Наследуемый юнит")).toBeInTheDocument();
    const unitCard = screen.getByText("Наследуемый юнит").closest("article")!;
    fireEvent.click(within(unitCard).getByRole("button", { name: "Изменить" }));
    const form = within(unitCard).getByRole("form", {
      name: "Редактировать юнит Наследуемый юнит",
    });
    const minutes = within(form).getByLabelText("Минуты");
    expect(minutes).toHaveValue(null);
    expect(minutes).toHaveAttribute("min", "1");
    expect(within(form).getByLabelText("Глубина")).toHaveValue("");
    fireEvent.click(
      within(form).getByRole("button", { name: "Сохранить юнит" }),
    );
    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(sentBodies[0]).toMatchObject({
      estimatedMinutes: null,
      depthLevel: null,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Удалить неделю Неделя 1" }),
    );
    expect(
      screen.getByText(/вместе со всеми её днями и юнитами/u),
    ).toBeInTheDocument();
    expect(sentBodies).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить удаление" }),
    );
    await waitFor(() => expect(sentBodies).toHaveLength(2));
  });

  it("reuses the operation ID after an uncertain network outcome", async () => {
    const published = version("published-retry", 1, "published");
    const graph = { version: published, weeks: [] };
    const operationIds: unknown[] = [];
    let cloneAttempts = 0;
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init)
        return { versions: [listItem(published)] };
      if (path === `/curriculum-editor/versions/${published.id}` && !init)
        return { curriculum: graph };
      if (path.endsWith("/clone") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        operationIds.push(body.operationId);
        cloneAttempts += 1;
        if (cloneAttempts === 1) throw new TypeError("Network connection lost");
        const draft = version("draft-retry", 2, "draft", published.id);
        return { version: draft };
      }
      if (path === "/curriculum-editor/versions/draft-retry" && !init)
        return {
          curriculum: {
            version: version("draft-retry", 2, "draft", published.id),
            weeks: [],
          },
        };
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    const clone = await screen.findByRole("button", {
      name: "Клонировать в черновик",
    });
    fireEvent.click(clone);
    expect(
      await screen.findByText("Network connection lost"),
    ).toBeInTheDocument();
    fireEvent.click(clone);
    await waitFor(() => expect(operationIds).toHaveLength(2));
    expect(operationIds[0]).toBe(operationIds[1]);
  });

  it("shows the nested backend error message", async () => {
    const published = version("published-error", 1, "published");
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init)
        return { versions: [listItem(published)] };
      if (path === `/curriculum-editor/versions/${published.id}` && !init)
        return { curriculum: { version: published, weeks: [] } };
      if (path.endsWith("/clone") && init?.method === "POST")
        return new Response(
          JSON.stringify({
            error: {
              code: "immutable_version",
              message: "Ревизию уже клонировали в другом окне",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    fireEvent.click(
      await screen.findByRole("button", { name: "Клонировать в черновик" }),
    );
    expect(
      await screen.findByText("Ревизию уже клонировали в другом окне"),
    ).toBeInTheDocument();
  });

  it("creates a draft revision, week and days from the add-week scenario", async () => {
    const published = version("published-add-week", 1, "published");
    const graphs = new Map<
      string,
      {
        version: ReturnType<typeof version>;
        weeks: ReturnType<typeof week>[];
      }
    >();
    graphs.set(published.id, { version: published, weeks: [] });
    const versions = [listItem(published)];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) return { versions };
      if (path === `/curriculum-editor/versions/${published.id}` && !init)
        return { curriculum: structuredClone(graphs.get(published.id)!) };
      if (path === "/curriculum-editor/versions/draft-add-week" && !init)
        return {
          curriculum: structuredClone(graphs.get("draft-add-week")!),
        };
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path === "/curriculum-editor/versions" && init?.method === "POST") {
        const draft = version("draft-add-week", 2, "draft", published.id);
        versions.unshift(listItem(draft));
        graphs.set(draft.id, { version: draft, weeks: [] });
        return { version: draft };
      }
      const weekMatch = path.match(
        /^\/curriculum-editor\/versions\/([^/]+)\/weeks$/u,
      );
      if (weekMatch && init?.method === "POST") {
        const draft = graphs.get("draft-add-week")!;
        const created = week(
          "week-add-week",
          "draft-add-week",
          String(body.title),
        );
        draft.weeks.push(created);
        return { week: created };
      }
      const dayMatch = path.match(
        /^\/curriculum-editor\/versions\/([^/]+)\/weeks\/([^/]+)\/days$/u,
      );
      if (dayMatch && init?.method === "POST") {
        const draft = graphs.get("draft-add-week")!;
        const created = day("day-add-week", "draft-add-week", "week-add-week");
        created.title = String(body.title);
        created.goal = String(body.goal);
        Object.assign(created, {
          topics: body.topics,
          expectedOutcomes: body.expectedOutcomes,
        });
        draft.weeks[0]!.days.push(created);
        return { day: created };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    fireEvent.click(
      await screen.findByRole("button", { name: "Добавить следующую неделю" }),
    );
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Название недели"), {
      target: { value: "Асинхронность" },
    });
    fireEvent.change(screen.getByLabelText("Цель недели"), {
      target: { value: "Понять event loop" },
    });
    fireEvent.change(screen.getByLabelText(/Темы/u), {
      target: { value: "Promise, async/await" },
    });
    fireEvent.change(screen.getByLabelText(/Ожидаемые результаты/u), {
      target: { value: "Объяснить Event Loop" },
    });
    fireEvent.change(screen.getByLabelText("Количество дней"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Создать неделю и дни" }),
    );

    await waitFor(() => {
      const create = apiMock.mock.calls.find(
        ([path, init]) =>
          path === "/curriculum-editor/versions" && init?.method === "POST",
      );
      expect(create).toBeDefined();
      const body = JSON.parse(String(create?.[1]?.body)) as Record<
        string,
        unknown
      >;
      expect(body.curriculum).toMatchObject({
        id: "curriculum-js",
        slug: "javascript-foundation",
      });
    });
    await waitFor(() =>
      expect(graphs.get("draft-add-week")!.weeks[0]!.days).toHaveLength(2),
    );
    const dayPosts = apiMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith("/days") && init?.method === "POST",
    );
    expect(dayPosts).toHaveLength(2);
    const firstDay = JSON.parse(String(dayPosts[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(firstDay).toMatchObject({
      title: "Day 1",
      goal: "Понять event loop",
      topics: ["Promise", "async/await"],
      expectedOutcomes: ["Объяснить Event Loop"],
      estimatedMinutes: 60,
      depthLevel: "foundation",
    });
    const secondDay = JSON.parse(String(dayPosts[1]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(secondDay).toMatchObject({ title: "Day 2" });
    expect(await screen.findByText("Асинхронность")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reuses an existing draft instead of creating another revision", async () => {
    const published = version("published-reuse", 1, "published");
    const draft = version("draft-reuse", 2, "draft", published.id);
    const graphs = new Map<
      string,
      {
        version: ReturnType<typeof version>;
        weeks: ReturnType<typeof week>[];
      }
    >();
    graphs.set(published.id, { version: published, weeks: [] });
    graphs.set(draft.id, { version: draft, weeks: [] });
    const versions = [listItem(draft), listItem(published)];
    const versionPosts: string[] = [];
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) return { versions };
      if (path === "/curriculum-editor/versions/draft-reuse" && !init)
        return { curriculum: structuredClone(graphs.get(draft.id)!) };
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path === "/curriculum-editor/versions" && init?.method === "POST") {
        versionPosts.push("unexpected");
        return { version: version("unexpected", 3, "draft") };
      }
      const weekMatch = path.match(
        /^\/curriculum-editor\/versions\/([^/]+)\/weeks$/u,
      );
      if (weekMatch && init?.method === "POST") {
        const target = graphs.get(weekMatch[1]!)!;
        const created = week("week-reuse", weekMatch[1]!, String(body.title));
        target.weeks.push(created);
        return { week: created };
      }
      const dayMatch = path.match(
        /^\/curriculum-editor\/versions\/([^/]+)\/weeks\/([^/]+)\/days$/u,
      );
      if (dayMatch && init?.method === "POST") {
        const created = day("day-reuse", dayMatch[1]!, dayMatch[2]!);
        created.title = String(body.title);
        graphs.get(dayMatch[1]!)!.weeks[0]!.days.push(created);
        return { day: created };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    fireEvent.click(
      await screen.findByRole("button", { name: "Добавить следующую неделю" }),
    );
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Название недели"), {
      target: { value: "Новая неделя" },
    });
    fireEvent.change(screen.getByLabelText("Цель недели"), {
      target: { value: "Цель" },
    });
    fireEvent.change(screen.getByLabelText("Количество дней"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Создать неделю и дни" }),
    );

    await waitFor(() =>
      expect(graphs.get("draft-reuse")!.weeks[0]!.days).toHaveLength(1),
    );
    expect(versionPosts).toHaveLength(0);
    const weekPosts = apiMock.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith("/weeks") && init?.method === "POST",
    );
    expect(weekPosts).toHaveLength(1);
    expect(String(weekPosts[0]?.[0])).toContain("/draft-reuse/weeks");
    expect(await screen.findByText("Новая неделя")).toBeInTheDocument();
  });

  it("guides a disclosed Course Designer workflow through explicit review", async () => {
    const draft = version("draft-designer", 1, "draft");
    const graph = { version: draft, weeks: [] as ReturnType<typeof week>[] };
    const draftHash = `sha256:${"a".repeat(64)}`;
    const workflow = {
      id: "course-designer-workflow:test",
      versionId: draft.id,
      state: "DRAFT_REQUEST",
      recoveryState: null,
      request: {
        goal: "Создать вводный модуль",
        targetOutcome: "Объяснить основы без подсказок",
        currentLevel: "Начальный",
        constraints: ["Одна сессия"],
        sources: [
          {
            id: "source:1",
            title: "Provided text 1",
            kind: "provided-text",
            locator: "Основы из заметок автора",
            approved: true,
          },
        ],
        activityPreferences: [],
        runtimeRequirements: [],
      },
      diagnostic: { questions: [], answers: {}, skipped: false },
      revisionRequests: [],
      activeProposalId: null as string | null,
      authoringOperationId: "workflow:create",
      failureCode: null,
      failureMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    const disclosure = {
      operationId: "disclosure:designer-test",
      scope: {
        role: "course-designer",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        modelId: "gpt-5.2",
        destination:
          "OpenAI via Pi: optional Course draft authoring assistance",
        payloadCategories: ["course-content", "learner-message"],
        entityIds: { "course-revision": draft.id },
        exclusions: ["credentials", "environment variables"],
        byteCount: 1_024,
        payloadSha256: draftHash,
      },
      status: "pending",
      createdAt: "2026-08-10T00:00:00.000Z",
      approvedAt: null,
      consumedAt: null,
      expiresAt: "2026-08-10T00:05:00.000Z",
    };
    const proposal = {
      id: "course-proposal:designer-test",
      versionId: draft.id,
      baseDraftHash: draftHash,
      prompt: "Создать вводный модуль",
      proposal: {
        summary: "Добавить вводную неделю",
        changes: [
          {
            kind: "add-week",
            stableId: "week-foundations",
            title: "Вводная неделя",
            description: "Основы курса",
          },
        ],
      },
      status: "proposed" as "proposed" | "applied",
      authoringOperationId: "operation-designer",
      providerOperationId: "provider-operation-designer",
      createdAt: now,
      reviewedAt: null as number | null,
      attribution: {
        workflowId: "course-designer-workflow:test",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        modelId: "gpt-5.2",
        promptTemplateId: "course-designer-workflow",
        promptTemplateVersion: "v1.1.0",
        disclosureOperationId: "disclosure:designer-test",
        diffs: [
          {
            kind: "add-week",
            targetStableId: "week-foundations",
            before: null,
            after: {
              stableId: "week-foundations",
              title: "Вводная неделя",
              description: "Основы курса",
            },
          },
        ],
        provenance: {
          sourceIds: ["source:1"],
          sources: [
            {
              id: "source:1",
              title: "Provided text 1",
              kind: "provided-text",
              locator: "Основы из заметок автора",
              approved: true,
            },
          ],
          authoringRequestOperationId: "workflow:create",
          providerOperationId: "provider-operation-designer",
        },
        validation: { valid: true, errors: 0, warnings: 0, diagnostics: [] },
      },
    };
    let generated = false;
    let created = false;
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) {
        return { versions: [listItem(draft)] };
      }
      if (path === `/curriculum-editor/versions/${draft.id}` && !init) {
        return { curriculum: structuredClone(graph) };
      }
      if (path.endsWith("/designer/workflows") && !init) {
        return { workflows: created ? [structuredClone(workflow)] : [] };
      }
      if (path.endsWith("/designer/proposals") && !init) {
        return { proposals: generated ? [structuredClone(proposal)] : [] };
      }
      if (path.endsWith("/designer/workflows") && init?.method === "POST") {
        created = true;
        return { workflow: structuredClone(workflow) };
      }
      if (path.endsWith("/advance") && init?.method === "POST") {
        const input = JSON.parse(String(init.body)) as {
          action: string;
        };
        workflow.state =
          input.action === "submit-request"
            ? "DISCOVERY"
            : input.action === "complete-discovery"
              ? "DIAGNOSTIC"
              : input.action === "skip-diagnostic"
                ? "CURRICULUM_PROPOSAL"
                : "COMPILATION";
        return { workflow: structuredClone(workflow) };
      }
      if (path.endsWith("/disclosures") && init?.method === "POST") {
        return { required: true, disclosure };
      }
      if (
        path === "/ai/disclosures/disclosure%3Adesigner-test/approve" &&
        init?.method === "POST"
      ) {
        return {
          disclosure: {
            ...disclosure,
            status: "approved",
            approvedAt: "2026-08-10T00:01:00.000Z",
          },
        };
      }
      if (path.endsWith("/generate") && init?.method === "POST") {
        generated = true;
        workflow.state = "USER_REVIEW";
        workflow.activeProposalId = proposal.id;
        return {
          workflow: structuredClone(workflow),
          proposal: structuredClone(proposal),
        };
      }
      if (path.endsWith("/apply") && init?.method === "POST") {
        proposal.status = "applied";
        proposal.reviewedAt = now + 1;
        workflow.state = "VALIDATION";
        graph.weeks.push(week("week-generated", draft.id, "Вводная неделя"));
        return {
          workflow: structuredClone(workflow),
          proposal: structuredClone(proposal),
          curriculum: structuredClone(graph),
          validation: {
            validatorVersion: "m9-v1",
            versionId: draft.id,
            draftHash,
            validationHash: `sha256:${"2".repeat(64)}`,
            valid: true,
            errors: 0,
            warnings: 0,
            diagnostics: [],
          },
        };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    fireEvent.change(await screen.findByLabelText("Учебная цель"), {
      target: { value: "Создать вводный модуль" },
    });
    fireEvent.change(screen.getByLabelText("Целевой результат"), {
      target: { value: "Объяснить основы без подсказок" },
    });
    fireEvent.change(screen.getByLabelText("Текущий уровень"), {
      target: { value: "Начальный" },
    });
    fireEvent.change(screen.getByLabelText("Ограничения"), {
      target: { value: "Одна сессия" },
    });
    fireEvent.change(screen.getByLabelText("Одобренные источники"), {
      target: { value: "Основы из заметок автора" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Начать пошаговое проектирование" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Отправить запрос" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Завершить уточнение" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Пропустить диагностику" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Сгенерировать предложение",
      }),
    );

    expect(
      await screen.findByText("Передача внешнему провайдеру"),
    ).toBeInTheDocument();
    expect(generated).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Разрешить и сгенерировать" }),
    );

    expect(
      await screen.findByText("Добавить вводную неделю"),
    ).toBeInTheDocument();
    expect(screen.getByText(/openai · gpt-5\.2/u)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отклонить" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить для компиляции" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Применить предложение" }),
    );
    expect(await screen.findByText("Применено")).toBeInTheDocument();
    expect(graph.weeks).toHaveLength(1);
  });

  it("creates a personal adaptation without replacing upstream", async () => {
    const upstream = version("upstream-1", 1, "published");
    const personal = {
      ...version("personal-2", 2, "draft", upstream.id),
      title: "Моя адаптация",
    };
    const versions = [listItem(upstream)];
    const graphs = new Map([
      [
        upstream.id,
        { version: upstream, weeks: [] as ReturnType<typeof week>[] },
      ],
      [
        personal.id,
        { version: personal, weeks: [] as ReturnType<typeof week>[] },
      ],
    ]);
    let branch: Record<string, unknown> | null = null;
    let created = false;
    const revisionDto = (
      value: ReturnType<typeof version>,
      branchKind: "upstream" | "personal",
    ) => ({
      ...value,
      branchKind,
      basedOnContentHash:
        branchKind === "personal" ? upstream.contentHash : null,
      adaptationBranchId: branchKind === "personal" ? "curriculum-js" : null,
    });
    const adaptation = () => ({
      branch,
      revisions: [
        revisionDto(upstream, "upstream"),
        ...(created ? [revisionDto(personal, "personal")] : []),
      ],
      comparison: {
        status: "current" as const,
        baseRevisionId: upstream.id,
        upstreamRevisionId: upstream.id,
        personalVersionId: created ? personal.id : null,
        baseDraftHash: `sha256:${"a".repeat(64)}`,
        upstreamDraftHash: `sha256:${"a".repeat(64)}`,
        personalDraftHash: created ? `sha256:${"b".repeat(64)}` : null,
        conflicts: [],
      },
    });

    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) return { versions };
      if (path.startsWith("/curriculum-editor/versions/") && !init) {
        const id = path.split("/").at(-1)!;
        return { curriculum: structuredClone(graphs.get(id)!) };
      }
      if (
        path === "/curriculum-editor/courses/curriculum-js/adaptation" &&
        !init
      ) {
        return adaptation();
      }
      if (
        path === "/curriculum-editor/versions/upstream-1/adaptation" &&
        init?.method === "POST"
      ) {
        created = true;
        versions.unshift(listItem(personal));
        branch = {
          id: "curriculum-js",
          courseId: "curriculum-js",
          owner: "local",
          baseRevisionId: upstream.id,
          headRevisionId: null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        return {
          version: revisionDto(personal, "personal"),
          branch,
        };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    fireEvent.click(
      await screen.findByRole("button", { name: "Создать личную адаптацию" }),
    );

    expect(await screen.findByText("Моя адаптация")).toBeInTheDocument();
    expect(created).toBe(true);
    expect(
      apiMock.mock.calls.some(
        ([path, init]) =>
          path === "/curriculum-editor/versions/upstream-1/adaptation" &&
          init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("requires review before integrating an upstream conflict", async () => {
    const upstream = {
      ...version("upstream-2", 2, "published", "upstream-1"),
      title: "Исходная ревизия 2",
    };
    const personal = {
      ...version("personal-3", 3, "published", "upstream-1"),
      title: "Личная ревизия",
    };
    const integrated = {
      ...version("personal-4", 4, "draft", upstream.id),
      title: "Интеграция",
    };
    const versions = [listItem(upstream), listItem(personal)];
    const graphs = new Map([
      [
        upstream.id,
        { version: upstream, weeks: [] as ReturnType<typeof week>[] },
      ],
      [
        personal.id,
        { version: personal, weeks: [] as ReturnType<typeof week>[] },
      ],
      [
        integrated.id,
        { version: integrated, weeks: [] as ReturnType<typeof week>[] },
      ],
    ]);
    const branch = {
      id: "curriculum-js",
      courseId: "curriculum-js",
      owner: "local" as const,
      baseRevisionId: "upstream-1",
      headRevisionId: personal.id,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };
    const dto = (
      value: ReturnType<typeof version>,
      branchKind: "upstream" | "personal",
    ) => ({
      ...value,
      branchKind,
      basedOnContentHash: branchKind === "personal" ? "hash-1" : null,
      adaptationBranchId: branchKind === "personal" ? branch.id : null,
    });
    const comparison = {
      status: "conflict" as const,
      baseRevisionId: "upstream-1",
      upstreamRevisionId: upstream.id,
      personalVersionId: personal.id,
      baseDraftHash: `sha256:${"a".repeat(64)}`,
      upstreamDraftHash: `sha256:${"b".repeat(64)}`,
      personalDraftHash: `sha256:${"c".repeat(64)}`,
      conflicts: ["unit:unit-core"],
    };
    const integrationBodies: Array<Record<string, unknown>> = [];

    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/curriculum-editor/versions" && !init) return { versions };
      if (path.startsWith("/curriculum-editor/versions/") && !init) {
        const id = path.split("/").at(-1)!;
        return { curriculum: structuredClone(graphs.get(id)!) };
      }
      if (
        path === "/curriculum-editor/courses/curriculum-js/adaptation" &&
        !init
      ) {
        return {
          branch,
          revisions: [dto(upstream, "upstream"), dto(personal, "personal")],
          comparison,
        };
      }
      if (
        path ===
          "/curriculum-editor/courses/curriculum-js/adaptation/integrate" &&
        init?.method === "POST"
      ) {
        integrationBodies.push(JSON.parse(String(init.body)));
        versions.unshift(listItem(integrated));
        return {
          version: dto(integrated, "personal"),
          strategy: "keep-personal",
          priorConflicts: comparison.conflicts,
        };
      }
      throw new Error(`Unexpected API call ${path}`);
    });

    renderEditor();
    expect(await screen.findByText("unit:unit-core")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Использовать исходную версию" }),
    );
    expect(
      await screen.findByText(
        "Начать следующий личный черновик с материала новой исходной ревизии?",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(integrationBodies).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить личную версию" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Создать черновик интеграции",
      }),
    );
    await waitFor(() => expect(integrationBodies).toHaveLength(1));
    expect(integrationBodies[0]).toMatchObject({
      strategy: "keep-personal",
      baseRevisionId: comparison.baseRevisionId,
      upstreamRevisionId: comparison.upstreamRevisionId,
      personalVersionId: comparison.personalVersionId,
      operationId: expect.any(String),
    });
  });
});

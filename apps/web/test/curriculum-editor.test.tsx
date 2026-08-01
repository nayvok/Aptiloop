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
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
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
    fireEvent.click(screen.getByText("Новая отдельная программа"));
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
    fireEvent.click(
      screen.getByLabelText(
        "Я понимаю, что опубликованную ревизию нельзя редактировать.",
      ),
    );
    fireEvent.click(publish);
    expect(
      await screen.findByText("Опубликована · read-only"),
    ).toBeInTheDocument();
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
});

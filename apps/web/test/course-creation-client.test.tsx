import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/courses/new/external/instructions/route";
import {
  AUTHORING_BRIEF_DESCRIPTION_MAX_LENGTH,
  authoringBriefDescription,
  parseAuthoringBriefDescription,
} from "@/app/courses/new/authoring-brief";
import {
  AUTHORING_BRIEF_STORAGE_KEY,
  CourseCreationClient,
} from "@/components/course-creation-client";
import { LocaleProvider, type UiLocale } from "@/lib/i18n";

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
  writable: true,
});

const { fetchMock, pushMock, toastErrorMock, toastSuccessMock } = vi.hoisted(
  () => ({
    fetchMock: vi.fn(),
    pushMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

const brief = {
  topicGoal: "Practical async JavaScript",
  targetOutcome: "Build and explain an asynchronous workflow",
  currentLevel: "Comfortable with syntax",
  primaryLocale: "en-US",
  pacing: "30 minutes daily for four weeks",
  tools: "Node.js 24",
  accessibility: "Prefer concise text",
  constraints: "No framework",
};

function renderCreation(
  children: ReactNode,
  initialLocale: UiLocale = "en-US",
  configureClient?: (client: QueryClient) => void,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  configureClient?.(client);
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale={initialLocale} syncSettings={false}>
        {children}
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function selectCourseLocale(label: string, localeCode: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const options = await screen.findAllByRole("option");
  const option = options.find((candidate) =>
    candidate.textContent?.includes(localeCode),
  );
  if (!option) throw new Error(`Missing Course locale option: ${localeCode}`);
  fireEvent.click(option);
}

async function selectCustomCourseLocale(
  label: string,
  fieldId: string,
  value: string,
) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(
    await screen.findByRole("option", { name: "Other BCP 47 locale…" }),
  );
  const input = document.getElementById(`${fieldId}-custom`);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing custom Course locale input: ${fieldId}`);
  }
  fireEvent.change(input, { target: { value } });
  return input;
}

async function fillRequiredBrief(
  courseLocale: string | null = brief.primaryLocale,
) {
  fireEvent.change(screen.getByLabelText("Topic or learning goal"), {
    target: { value: brief.topicGoal },
  });
  fireEvent.change(screen.getByLabelText("Target outcome"), {
    target: { value: brief.targetOutcome },
  });
  fireEvent.change(screen.getByLabelText("Current level"), {
    target: { value: brief.currentLevel },
  });
  if (courseLocale) {
    await selectCourseLocale("Primary Course locale", courseLocale);
  }
  fireEvent.change(screen.getByLabelText("Pacing and available time"), {
    target: { value: brief.pacing },
  });
}

function connectedSettings(
  mode: "no-ai" | "connection",
  withObservedCapabilities = true,
) {
  return {
    ai: {
      roleProfiles: [
        {
          role: "course-designer",
          mode,
          connectionId: mode === "connection" ? "connection-1" : null,
          modelId: mode === "connection" ? "capable-model" : null,
          requiredCapabilities:
            mode === "connection"
              ? ["streaming", "models", "cancellation"]
              : [],
        },
      ],
      connections: [
        {
          connectionId: "connection-1",
          displayName: "Local provider",
          state: "connected",
          observedCapabilities: withObservedCapabilities
            ? {
                observedAt: "2026-08-11T10:00:00.000Z",
                connection: {
                  authenticated: true,
                  streaming: true,
                  cancellation: true,
                },
                models: [
                  {
                    modelId: "capable-model",
                    available: true,
                    contextTokens: 128_000,
                    outputTokens: 16_000,
                    typedToolCalls: "schema-constrained",
                  },
                ],
              }
            : null,
        },
      ],
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  pushMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => "operation-course-123456789abc") },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Course creation brief", () => {
  it("restores edits after reload and clears them only on explicit action", async () => {
    window.localStorage.setItem(
      AUTHORING_BRIEF_STORAGE_KEY,
      JSON.stringify(brief),
    );
    const first = renderCreation(<CourseCreationClient mode="external" />);

    expect(await screen.findByLabelText("Topic or learning goal")).toHaveValue(
      brief.topicGoal,
    );
    expect(
      screen.getByRole("combobox", { name: "Primary Course locale" }),
    ).toHaveTextContent("en-US");
    fireEvent.change(screen.getByLabelText("Current level"), {
      target: { value: "Intermediate" },
    });
    first.unmount();

    renderCreation(<CourseCreationClient mode="external" />);
    expect(await screen.findByLabelText("Current level")).toHaveValue(
      "Intermediate",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear brief" }));
    expect(screen.getByLabelText("Topic or learning goal")).toHaveValue("");
    expect(
      screen.getByRole("combobox", { name: "Primary Course locale" }),
    ).toHaveTextContent("Select a Course language");
    expect(window.localStorage.getItem(AUTHORING_BRIEF_STORAGE_KEY)).toBeNull();
  });

  it("does not derive a new Course locale from the interface locale", () => {
    renderCreation(<CourseCreationClient mode="external" />);

    expect(
      screen.getByRole("combobox", { name: "Primary Course locale" }),
    ).toHaveTextContent("Select a Course language");
  });

  it("renders common Course locales with localized display names", async () => {
    renderCreation(<CourseCreationClient mode="external" />, "ru-RU");

    fireEvent.click(
      screen.getByRole("combobox", { name: "Основная локаль курса" }),
    );

    expect(
      await screen.findByRole("option", { name: /русский.*ru-RU/iu }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: /немецкий.*de-DE/iu }),
    ).toBeVisible();
  });

  it("round-trips exact bounded brief fields and retains legacy descriptions", () => {
    const exactBrief = {
      ...brief,
      targetOutcome: "Explain the event loop\nand build one workflow",
      tools: "Not specified",
      accessibility: "Screen reader labels 😀\nReduced motion",
      constraints: "Line one\nLine two: Not specified",
    };
    const description = authoringBriefDescription(exactBrief);

    expect(description.length).toBeLessThanOrEqual(
      AUTHORING_BRIEF_DESCRIPTION_MAX_LENGTH,
    );
    expect(parseAuthoringBriefDescription(description)).toEqual(exactBrief);
    expect(
      parseAuthoringBriefDescription(
        [
          "Authoring brief",
          "Topic / goal: Legacy topic",
          "Target outcome: Legacy outcome",
          "Current level: Beginner",
          "Primary locale: en-US",
          "Pacing: Weekly",
          "Tools and access: Not specified",
          "Accessibility: Not specified",
          "Constraints: Not specified",
        ].join("\n"),
      ),
    ).toEqual({
      topicGoal: "Legacy topic",
      targetOutcome: "Legacy outcome",
      currentLevel: "Beginner",
      primaryLocale: "en-US",
      pacing: "Weekly",
      tools: "",
      accessibility: "",
      constraints: "",
    });
  });

  it("shows inline locale feedback without clearing or submitting an invalid brief", async () => {
    renderCreation(<CourseCreationClient mode="external" />);
    await fillRequiredBrief();
    const customLocale = await selectCustomCourseLocale(
      "Primary Course locale",
      "authoring-primary-locale",
      "not_a_locale",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Download instruction file" }),
    );

    expect(
      await screen.findByText(
        "Enter a valid BCP 47 Course locale, such as en-US or ru-RU.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(customLocale).toHaveAttribute("aria-invalid", "true");
    const localeTrigger = screen.getByRole("combobox", {
      name: "Primary Course locale",
    });
    expect(localeTrigger).toHaveAttribute("aria-invalid", "true");
    expect(localeTrigger).toHaveFocus();
    expect(customLocale).toHaveValue("not_a_locale");
    expect(screen.getByLabelText("Topic or learning goal")).toHaveValue(
      brief.topicGoal,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("replaces native required-locale feedback with the localized inline error", async () => {
    renderCreation(<CourseCreationClient mode="external" />);
    await fillRequiredBrief(null);
    const primaryLocale = screen.getByRole("combobox", {
      name: "Primary Course locale",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Download instruction file" }),
    );

    expect(
      await screen.findByText(
        "Enter a valid BCP 47 Course locale, such as en-US or ru-RU.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(primaryLocale).toHaveTextContent("Select a Course language");
    expect(primaryLocale).toHaveAttribute("aria-invalid", "true");
    expect(primaryLocale).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads instructions containing the brief and exact V1 artifacts", async () => {
    const response = await POST(
      new Request("http://localhost/courses/new/external/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      }),
    );
    const contents = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "aptiloop-course-pack-v1-authoring-skill.md",
    );
    expect(contents).toContain(brief.topicGoal);
    expect(contents).toContain(
      '"$id": "https://aptiloop.local/schema/course-pack-v1.schema.json"',
    );
    expect(contents).toContain('"format": "aptiloop.course-pack"');
    expect(contents).toContain("/courses/import");
    expect(contents).toContain("Return the final Course Pack JSON only");
    expect(contents).toContain("@aptiloop/course-authoring-kit@0.1.0");
  });

  it("rejects non-JSON and oversized instruction requests before parsing", async () => {
    const unsupported = await POST(
      new Request("http://localhost/courses/new/external/instructions", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(brief),
      }),
    );
    expect(unsupported.status).toBe(415);

    const oversized = await POST(
      new Request("http://localhost/courses/new/external/instructions", {
        method: "POST",
        headers: {
          "Content-Length": "65537",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(brief),
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it("creates one explicit Draft and routes a ready connected model to Designer", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") {
        return new Response(JSON.stringify(connectedSettings("connection")), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/curriculum-editor/versions") {
        return new Response(JSON.stringify({ version: { id: "draft-1" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderCreation(<CourseCreationClient mode="guided" />);

    expect(await screen.findByText("Technically ready")).toBeInTheDocument();
    await fillRequiredBrief();
    fireEvent.click(
      screen.getByRole("button", { name: "Create Draft and open Designer" }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/studio?version=draft-1&mode=designer&tab=designer",
      ),
    );
    const createCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/api/curriculum-editor/versions",
    );
    const body = JSON.parse(String(createCall?.[1]?.body)) as {
      curriculum: {
        id: string;
        description: string;
        primaryLocale: string;
      };
      operationId: string;
    };
    expect(body.curriculum.id).toMatch(/^course-practical-async-javascript-/u);
    expect(body.curriculum.description).toContain(brief.targetOutcome);
    expect(body.curriculum.primaryLocale).toBe("en-US");
    expect(body.operationId).toBe("operation-course-123456789abc");
  });

  it("does not reuse LocaleProvider's partial settings cache for Designer readiness", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(connectedSettings("connection")), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    let queryClient: QueryClient | undefined;
    renderCreation(
      <CourseCreationClient mode="guided" />,
      "en-US",
      (client) => {
        queryClient = client;
        client.setQueryData(["settings", "locale"], { uiLocale: "en-US" });
      },
    );

    expect(await screen.findByText("Technically ready")).toBeInTheDocument();
    expect(queryClient?.getQueryData(["settings", "locale"])).toEqual({
      uiLocale: "en-US",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Aptiloop-Client": "web" }),
      }),
    );
  });

  it("keeps connected generation disabled with AI Off and exposes recovery paths", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(connectedSettings("no-ai")), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderCreation(<CourseCreationClient mode="guided" />);

    expect(await screen.findByText("AI Off")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Draft and open Designer" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Use an external model" }),
    ).toHaveAttribute("href", "/courses/new/external");
    expect(
      screen.getByRole("link", { name: "Create manually without AI" }),
    ).toHaveAttribute("href", "/courses/new/manual");
    expect(
      screen.getByRole("link", { name: "Open AI settings" }),
    ).toHaveAttribute("href", "/settings?section=ai");
  });

  it("keeps recovery paths available when the configured connection is unavailable", async () => {
    const settings = connectedSettings("connection");
    settings.ai.connections[0]!.state = "authentication-required";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(settings), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderCreation(<CourseCreationClient mode="guided" />);

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Draft and open Designer" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Use an external model" }),
    ).toHaveAttribute("href", "/courses/new/external");
    expect(
      screen.getByRole("link", { name: "Create manually without AI" }),
    ).toHaveAttribute("href", "/courses/new/manual");
  });

  it("keeps a degraded eligible connection usable while capability evidence is advisory", async () => {
    const settings = connectedSettings("connection", false);
    settings.ai.connections[0]!.state = "degraded";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(settings), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderCreation(<CourseCreationClient mode="guided" />);

    expect(await screen.findByText("Capability unknown")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Draft and open Designer" }),
    ).toBeEnabled();
  });

  it("creates the same explicit Draft contract through the no-AI fallback", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ version: { id: "manual-draft" } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderCreation(<CourseCreationClient mode="manual" />, "ru-RU");

    fireEvent.change(screen.getByLabelText("Название программы"), {
      target: { value: "Manual systems course" },
    });
    await selectCourseLocale("Основная локаль курса", "en-US");
    fireEvent.click(screen.getByRole("button", { name: "Создать черновик" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/studio?version=manual-draft&mode=manual&tab=program",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body)) as {
      curriculum: { primaryLocale: string };
    };
    expect(body.curriculum.primaryLocale).toBe("en-US");
  });

  it("keeps an uncommon valid BCP 47 Course locale through the custom path", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ version: { id: "manual-custom" } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderCreation(<CourseCreationClient mode="manual" />);
    fireEvent.change(screen.getByLabelText("Course title"), {
      target: { value: "Custom locale course" },
    });
    const customLocale = await selectCustomCourseLocale(
      "Primary Course locale",
      "manual-course-primary-locale",
      "sr-Latn-RS",
    );

    expect(customLocale.labels?.[0]).toHaveTextContent("Custom Course locale");
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/studio?version=manual-custom&mode=manual&tab=program",
      ),
    );
    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body)) as {
      curriculum: { primaryLocale: string };
    };
    expect(body.curriculum.primaryLocale).toBe("sr-Latn-RS");
  });

  it("retains and focuses an invalid manual Course locale without a request", async () => {
    renderCreation(<CourseCreationClient mode="manual" />);

    fireEvent.change(screen.getByLabelText("Course title"), {
      target: { value: "Manual systems course" },
    });
    const primaryLocale = await selectCustomCourseLocale(
      "Primary Course locale",
      "manual-course-primary-locale",
      "not_a_locale",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(
      await screen.findByText(
        "Enter a valid BCP 47 Course locale, such as en-US or ru-RU.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(primaryLocale).toHaveValue("not_a_locale");
    expect(primaryLocale).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByRole("combobox", { name: "Primary Course locale" }),
    ).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps long Russian assisted actions wrap-safe in narrow cards", () => {
    renderCreation(<CourseCreationClient mode="external" />, "ru-RU");

    for (const control of [
      screen.getByRole("button", { name: "Скачать файл-инструкцию" }),
      screen.getByRole("link", {
        name: "Загрузить полученный Course Pack",
      }),
    ]) {
      expect(control).toHaveClass(
        "h-auto",
        "min-w-0",
        "w-full",
        "whitespace-normal",
        "[overflow-wrap:anywhere]",
      );
    }
  });

  it("preserves manual input when local Draft creation fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Local storage is unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderCreation(<CourseCreationClient mode="manual" />);

    const title = screen.getByLabelText("Course title");
    fireEvent.change(title, { target: { value: "Retained local title" } });
    await selectCourseLocale("Primary Course locale", "en-US");
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Local storage is unavailable",
      ),
    );
    expect(title).toHaveValue("Retained local title");
    expect(pushMock).not.toHaveBeenCalled();
  });
});

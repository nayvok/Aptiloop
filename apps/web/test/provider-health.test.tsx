import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderHealth } from "@/components/provider-health";
import { LocaleProvider } from "@/lib/i18n";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

function renderProviderHealth() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <ProviderHealth />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

function roleProfile(
  role: "course-designer" | "tutor" | "evaluator" | "reviewer",
  mode: "no-ai" | "connection",
) {
  return {
    role,
    mode,
    connectionId: mode === "connection" ? "conn:ready" : null,
    modelId: mode === "connection" ? "model-ready" : null,
    requiredCapabilities:
      mode === "connection" ? ["streaming", "models", "cancellation"] : [],
  };
}

const roles = ["course-designer", "tutor", "evaluator", "reviewer"] as const;

const readyConnection = {
  connectionId: "conn:ready",
  displayName: "Ready provider",
  enabled: true,
  state: "connected",
  observedCapabilities: {
    connection: {
      authenticated: true,
      streaming: true,
      cancellation: true,
    },
    models: [
      {
        modelId: "model-ready",
        available: true,
        typedToolCalls: "schema-constrained",
      },
    ],
  },
};

beforeEach(() => apiMock.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProviderHealth", () => {
  it("keeps every AI Off role neutral and out of the ready count", async () => {
    apiMock.mockResolvedValue({
      ai: {
        connections: [],
        roleProfiles: roles.map((role) => roleProfile(role, "no-ai")),
      },
    });

    renderProviderHealth();

    const trigger = await screen.findByRole("button", {
      name: /AI status: open details: AI Off/u,
    });
    expect(trigger).toHaveAttribute("data-state", "off");
    expect(trigger).not.toHaveClass("bg-success/10");
    fireEvent.click(trigger);

    const title = await screen.findByText("Optional AI assistance");
    const popover = title.parentElement?.parentElement;
    expect(popover).not.toBeNull();
    expect(
      within(popover as HTMLElement).queryByText(/roles ready/u),
    ).toBeNull();

    const roleRows = (popover as HTMLElement).querySelectorAll(
      '[data-slot="provider-role"]',
    );
    expect(roleRows).toHaveLength(4);
    for (const row of roleRows) {
      expect(row).toHaveAttribute("data-status", "off");
      expect(
        row.querySelector('[data-slot="provider-role-indicator"]'),
      ).toHaveAttribute("data-state", "off");
      expect(
        row.querySelector('[data-slot="provider-role-indicator"]'),
      ).not.toHaveClass("bg-success");
    }
    expect(
      (popover as HTMLElement).querySelector(
        '[data-slot="provider-recovery-link"]',
      ),
    ).toBeNull();
  });

  it("puts configured-provider recovery ahead of developer diagnostics", async () => {
    apiMock.mockResolvedValue({
      ai: {
        connections: [
          {
            ...readyConnection,
            state: "error",
          },
        ],
        roleProfiles: roles.map((role) => roleProfile(role, "connection")),
      },
    });

    renderProviderHealth();

    const trigger = await screen.findByRole("button", {
      name: /AI status: open details: AI needs attention/u,
    });
    expect(trigger).toHaveAttribute("data-state", "problem");
    fireEvent.click(trigger);

    const recovery = await screen.findByRole("link", {
      name: "Review connections",
    });
    expect(recovery).toHaveAttribute(
      "href",
      "/settings?section=connections&source=recovery",
    );
    expect(recovery).toHaveAttribute("data-slot", "provider-recovery-link");
    expect(recovery).toHaveClass("bg-primary");

    const diagnostics = screen.getByRole("link", {
      name: "Open developer diagnostics",
    });
    expect(recovery.compareDocumentPosition(diagnostics)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(diagnostics).not.toHaveClass("bg-primary");
  });

  it("counts only configured ready roles in a mixed profile", async () => {
    apiMock.mockResolvedValue({
      ai: {
        connections: [readyConnection],
        roleProfiles: [
          roleProfile("course-designer", "no-ai"),
          ...roles
            .filter((role) => role !== "course-designer")
            .map((role) => roleProfile(role, "connection")),
        ],
      },
    });

    renderProviderHealth();

    const trigger = await screen.findByRole("button", {
      name: /AI status: open details: AI ready/u,
    });
    fireEvent.click(trigger);

    const title = await screen.findByText("Optional AI assistance");
    const popover = title.parentElement?.parentElement;
    expect(popover).not.toBeNull();
    expect(
      within(popover as HTMLElement).getByText(
        "3 of 3 configured AI roles ready",
      ),
    ).toBeVisible();
    expect(
      (popover as HTMLElement).querySelectorAll(
        '[data-slot="provider-role"][data-status="ready"]',
      ),
    ).toHaveLength(3);
    expect(
      (popover as HTMLElement).querySelector(
        '[data-slot="provider-role"][data-status="off"]',
      ),
    ).not.toBeNull();
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "@/app/chat/page";
import type { ChatRole } from "@/lib/chat-role";
import { LocaleProvider } from "@/lib/i18n";

const { navigationState } = vi.hoisted(() => {
  let entries = ["/chat"];
  let index = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const currentHref = () => entries[index] ?? "/chat";
  const currentSearch = () => new URL(currentHref(), "http://localhost").search;

  return {
    navigationState: {
      getSnapshot: currentSearch,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      push: vi.fn((href: string) => {
        entries = [...entries.slice(0, index + 1), href];
        index += 1;
        notify();
      }),
      replace: vi.fn((href: string) => {
        entries[index] = href;
        notify();
      }),
      reset: (href: string) => {
        entries = [href];
        index = 0;
      },
      back: () => {
        if (index === 0) return;
        index -= 1;
        notify();
      },
      forward: () => {
        if (index >= entries.length - 1) return;
        index += 1;
        notify();
      },
      currentHref,
    },
  };
});

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/chat",
    useRouter: () => ({
      push: navigationState.push,
      replace: navigationState.replace,
    }),
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          navigationState.subscribe,
          navigationState.getSnapshot,
          navigationState.getSnapshot,
        ),
      ),
  };
});

vi.mock("@/components/agent-chat", () => ({
  AgentChat: ({
    role,
    onRoleChange,
  }: {
    role: ChatRole;
    onRoleChange: (role: ChatRole) => void;
  }) => (
    <section>
      <output data-testid="active-chat-role">{role}</output>
      <button type="button" onClick={() => onRoleChange("reviewer")}>
        reviewer
      </button>
      <button type="button" onClick={() => onRoleChange("curator")}>
        curator
      </button>
    </section>
  ),
}));

function renderChatPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <ChatPage />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.reset("/chat?role=teacher");
});

afterEach(cleanup);

describe("Chat page role routing", () => {
  it("restores the selected role from the URL after reload", async () => {
    navigationState.reset("/chat?source=review&role=curator");
    const firstRender = renderChatPage();

    expect(screen.getByTestId("active-chat-role")).toHaveTextContent("curator");
    firstRender.unmount();
    renderChatPage();

    expect(screen.getByTestId("active-chat-role")).toHaveTextContent("curator");
    expect(navigationState.push).not.toHaveBeenCalled();
    expect(navigationState.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", "/chat?source=home"],
    ["invalid", "/chat?source=home&role=administrator"],
    ["ambiguous", "/chat?source=home&role=reviewer&role=teacher"],
  ])("canonicalizes a %s role without adding history", async (_case, href) => {
    navigationState.reset(href);
    renderChatPage();

    expect(screen.getByTestId("active-chat-role")).toHaveTextContent("teacher");
    await waitFor(() =>
      expect(navigationState.currentHref()).toBe(
        "/chat?source=home&role=teacher",
      ),
    );
    expect(navigationState.replace).toHaveBeenCalledWith(
      "/chat?source=home&role=teacher",
      { scroll: false },
    );
    expect(navigationState.push).not.toHaveBeenCalled();
  });

  it("preserves unrelated parameters when a role is selected", async () => {
    navigationState.reset(
      "/chat?source=review&sessionId=session-1&role=teacher",
    );
    renderChatPage();

    fireEvent.click(screen.getByRole("button", { name: "reviewer" }));

    await waitFor(() =>
      expect(screen.getByTestId("active-chat-role")).toHaveTextContent(
        "reviewer",
      ),
    );
    expect(navigationState.push).toHaveBeenCalledWith(
      "/chat?source=review&sessionId=session-1&role=reviewer",
      { scroll: false },
    );
  });

  it("tracks browser Back and Forward through meaningful role choices", async () => {
    navigationState.reset("/chat?source=home&role=teacher");
    renderChatPage();

    fireEvent.click(screen.getByRole("button", { name: "reviewer" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-chat-role")).toHaveTextContent(
        "reviewer",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "curator" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-chat-role")).toHaveTextContent(
        "curator",
      ),
    );

    act(() => navigationState.back());
    expect(screen.getByTestId("active-chat-role")).toHaveTextContent(
      "reviewer",
    );
    act(() => navigationState.back());
    expect(screen.getByTestId("active-chat-role")).toHaveTextContent("teacher");
    act(() => navigationState.forward());
    expect(screen.getByTestId("active-chat-role")).toHaveTextContent(
      "reviewer",
    );
  });
});

import { onlineManager, useMutation, useQuery } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryProvider as AppQueryProvider } from "@/components/query-provider";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function renderWithQueryProvider(children: ReactNode) {
  return render(<AppQueryProvider>{children}</AppQueryProvider>);
}

function QueryProbe({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQuery({
    queryKey: ["query-provider", "query"],
    queryFn,
  });

  return (
    <div
      data-testid="query-probe"
      data-fetch-status={query.fetchStatus}
      data-is-paused={String(query.isPaused)}
      data-status={query.status}
    />
  );
}

function MutationProbe({ mutationFn }: { mutationFn: () => Promise<string> }) {
  const mutation = useMutation({ mutationFn });

  return (
    <button
      type="button"
      data-testid="mutation-probe"
      data-is-paused={String(mutation.isPaused)}
      data-status={mutation.status}
      onClick={() => {
        void mutation.mutateAsync();
      }}
    >
      Trigger mutation
    </button>
  );
}

beforeEach(() => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  onlineManager.setOnline(true);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe("QueryProvider", () => {
  it("starts local queries even when the browser reports offline", async () => {
    const queryDeferred = createDeferred<string>();
    const queryFn = vi.fn(() => queryDeferred.promise);

    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    onlineManager.setOnline(false);
    fireEvent(window, new Event("offline"));

    renderWithQueryProvider(<QueryProbe queryFn={queryFn} />);

    const probe = screen.getByTestId("query-probe");

    await waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(probe).toHaveAttribute("data-fetch-status", "fetching");
      expect(probe).toHaveAttribute("data-is-paused", "false");
      expect(probe).toHaveAttribute("data-status", "pending");
    });

    queryDeferred.resolve("local-core-ready");

    await waitFor(() => {
      expect(probe).toHaveAttribute("data-fetch-status", "idle");
      expect(probe).toHaveAttribute("data-status", "success");
    });
  });

  it("starts local mutations even when the browser reports offline", async () => {
    const mutationDeferred = createDeferred<string>();
    const mutationFn = vi.fn(() => mutationDeferred.promise);

    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    onlineManager.setOnline(false);
    fireEvent(window, new Event("offline"));

    renderWithQueryProvider(<MutationProbe mutationFn={mutationFn} />);

    const button = screen.getByRole("button", { name: "Trigger mutation" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledTimes(1);
      expect(button).toHaveAttribute("data-is-paused", "false");
      expect(button).toHaveAttribute("data-status", "pending");
    });

    mutationDeferred.resolve("local-core-saved");

    await waitFor(() => {
      expect(button).toHaveAttribute("data-status", "success");
    });
  });
});

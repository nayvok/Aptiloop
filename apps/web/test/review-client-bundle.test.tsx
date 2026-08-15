import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewClient } from "@/components/review-client";
import { LocaleProvider } from "@/lib/i18n";

const {
  dynamicLoaderMock,
  interviewRenderMock,
  pushMock,
  replaceMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  dynamicLoaderMock: vi.fn(),
  interviewRenderMock: vi.fn(),
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/dynamic", () => ({
  default: <Props extends object>(
    loader: () => Promise<ComponentType<Props>>,
    options: { loading: ComponentType },
  ) => {
    function DynamicComponent(props: Props) {
      const [Loaded, setLoaded] = useState<ComponentType<Props> | null>(null);

      useEffect(() => {
        let mounted = true;
        dynamicLoaderMock();
        void loader().then((component) => {
          if (mounted) setLoaded(() => component);
        });
        return () => {
          mounted = false;
        };
      }, []);

      return Loaded ? <Loaded {...props} /> : <options.loading />;
    }

    return DynamicComponent;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/review",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("@/components/flashcards-client", () => ({
  ReviewQueueClient: () => <div>Review queue</div>,
}));
vi.mock("@/components/mistakes-client", () => ({ MistakesClient: () => null }));
vi.mock("@/components/interview-client", () => ({
  InterviewClient: () => {
    interviewRenderMock();
    return <div>Loaded Interview</div>;
  },
}));

function renderReview() {
  return render(
    <LocaleProvider initialLocale="en-US" syncSettings={false}>
      <ReviewClient />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  dynamicLoaderMock.mockReset();
  interviewRenderMock.mockReset();
  pushMock.mockReset();
  replaceMock.mockReset();
  searchParamsRef.current = new URLSearchParams();
});

afterEach(cleanup);

describe("Review Interview bundle boundary", () => {
  it("loads and renders Interview only after its destination becomes active", async () => {
    const review = renderReview();

    expect(screen.getAllByText("Review queue").length).toBeGreaterThan(0);
    expect(dynamicLoaderMock).not.toHaveBeenCalled();
    expect(interviewRenderMock).not.toHaveBeenCalled();

    searchParamsRef.current = new URLSearchParams("view=interviews");
    review.rerender(
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <ReviewClient />
      </LocaleProvider>,
    );

    expect(
      screen.getByRole("status", { name: "Loading interview…" }),
    ).toBeVisible();
    await waitFor(() => expect(dynamicLoaderMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("Loaded Interview")).toBeVisible();
    expect(interviewRenderMock).toHaveBeenCalledOnce();
  });
});

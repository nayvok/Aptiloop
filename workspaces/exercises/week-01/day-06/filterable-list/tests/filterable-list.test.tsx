// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FilterableList,
  filterItems,
  type ListItem,
} from "../src/filterable-list";

const items: readonly ListItem[] = [
  { id: "js", label: "JavaScript" },
  { id: "ts", label: "TypeScript" },
  { id: "react", label: "React" },
];

afterEach(cleanup);

describe("filterItems", () => {
  it("filters case-insensitively without mutating the input", () => {
    const snapshot = structuredClone(items);

    expect(filterItems(items, "script").map((item) => item.id)).toEqual([
      "js",
      "ts",
    ]);
    expect(items).toEqual(snapshot);
  });

  it("treats surrounding whitespace as an empty query", () => {
    expect(filterItems(items, "   ")).toEqual(items);
  });
});

describe("FilterableList", () => {
  it("renders items and filters them from current query", () => {
    render(<FilterableList initialItems={items} loadItems={vi.fn()} />);

    expect(screen.getByText("JavaScript")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск" }), {
      target: { value: "react" },
    });
    expect(screen.queryByText("JavaScript")).not.toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
  });

  it("keeps selection by stable id while filtering", () => {
    render(<FilterableList initialItems={items} loadItems={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "TypeScript" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск" }), {
      target: { value: "react" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск" }), {
      target: { value: "" },
    });

    expect(screen.getByRole("button", { name: "TypeScript" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("refreshes from the loader", async () => {
    const loadItems = vi
      .fn()
      .mockResolvedValue([{ id: "new", label: "New topic" }]);
    render(<FilterableList initialItems={items} loadItems={loadItems} />);

    await waitFor(() => expect(loadItems).toHaveBeenCalledOnce());
    expect(await screen.findByText("New topic")).toBeInTheDocument();
    expect(loadItems.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it("aborts an in-flight refresh on unmount", () => {
    let signal: AbortSignal | undefined;
    const loadItems = vi.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<readonly ListItem[]>(() => undefined);
    });
    const view = render(
      <FilterableList initialItems={items} loadItems={loadItems} />,
    );

    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

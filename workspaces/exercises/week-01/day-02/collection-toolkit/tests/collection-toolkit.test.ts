import { describe, expect, it, vi } from "vitest";

import { countBy, groupBy, uniqueBy } from "../src/collection-toolkit.js";

interface Person {
  readonly id: number;
  readonly team: string;
  readonly name: string;
}

const people: readonly Person[] = [
  { id: 1, team: "platform", name: "Ada" },
  { id: 2, team: "web", name: "Lin" },
  { id: 3, team: "platform", name: "Grace" },
  { id: 2, team: "data", name: "Lin (duplicate)" },
];

describe("groupBy", () => {
  it("groups values and preserves insertion order", () => {
    const grouped = groupBy(people, (person) => person.team);

    expect([...grouped.keys()]).toEqual(["platform", "web", "data"]);
    expect(grouped.get("platform")?.map((person) => person.name)).toEqual([
      "Ada",
      "Grace",
    ]);
  });

  it("supports object identity as a key", () => {
    const firstKey = { id: "first" };
    const secondKey = { id: "second" };
    const input = [
      { key: firstKey, value: 1 },
      { key: secondKey, value: 2 },
      { key: firstKey, value: 3 },
    ] as const;

    const grouped = groupBy(input, (item) => item.key);

    expect(grouped.get(firstKey)?.map((item) => item.value)).toEqual([1, 3]);
    expect(grouped.get(secondKey)?.map((item) => item.value)).toEqual([2]);
  });

  it("passes the source index to the selector", () => {
    const selector = vi.fn((_value: string, index: number) => index % 2);

    const grouped = groupBy(["a", "b", "c"], selector);

    expect(selector.mock.calls.map((call) => call[1])).toEqual([0, 1, 2]);
    expect(grouped.get(0)).toEqual(["a", "c"]);
  });

  it("returns an empty Map for empty input", () => {
    expect(groupBy([], String)).toEqual(new Map());
  });
});

describe("uniqueBy", () => {
  it("keeps the first value for every key", () => {
    expect(uniqueBy(people, (person) => person.id)).toEqual(people.slice(0, 3));
  });

  it("uses SameValueZero key semantics", () => {
    expect(uniqueBy([Number.NaN, Number.NaN, 0, -0], (value) => value)).toEqual(
      [Number.NaN, 0],
    );
  });

  it("does not return the original array", () => {
    const input = [1, 2, 3] as const;
    expect(uniqueBy(input, (value) => value)).not.toBe(input);
  });
});

describe("countBy", () => {
  it("counts occurrences without stringifying keys", () => {
    expect(countBy(people, (person) => person.team)).toEqual(
      new Map([
        ["platform", 2],
        ["web", 1],
        ["data", 1],
      ]),
    );
  });

  it("returns an empty Map for empty input", () => {
    expect(countBy([], String)).toEqual(new Map());
  });
});

describe("input immutability", () => {
  it("does not mutate a frozen input", () => {
    const input = Object.freeze([3, 1, 2, 1]);

    expect(() => groupBy(input, (value) => value % 2)).not.toThrow();
    expect(() => uniqueBy(input, (value) => value)).not.toThrow();
    expect(() => countBy(input, (value) => value)).not.toThrow();
    expect(input).toEqual([3, 1, 2, 1]);
  });
});

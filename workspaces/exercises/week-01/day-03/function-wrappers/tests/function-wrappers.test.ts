import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { memoizeOne, once } from "../src/function-wrappers.js";

describe("once", () => {
  it("возвращает первый результат и не вызывает функцию повторно", () => {
    const source = vi.fn((value: number) => value * 2);
    const wrapped = once(source);

    expect(wrapped(4)).toBe(8);
    expect(wrapped(99)).toBe(8);
    expect(source).toHaveBeenCalledOnce();
  });

  it("кеширует undefined независимо от truthiness", () => {
    const source = vi.fn((_value: string): undefined => undefined);
    const wrapped = once(source);

    expect(wrapped("first")).toBeUndefined();
    expect(wrapped("second")).toBeUndefined();
    expect(source).toHaveBeenCalledOnce();
  });

  it("сохраняет receiver и публичную сигнатуру", () => {
    function add(this: { base: number }, increment: number): number {
      return this.base + increment;
    }
    const wrapped = once(add);

    expect(wrapped.call({ base: 10 }, 2)).toBe(12);
    expectTypeOf(wrapped).toEqualTypeOf<
      (this: { base: number }, increment: number) => number
    >();
  });
});

describe("memoizeOne", () => {
  it("переиспользует только последний вызов с теми же аргументами", () => {
    const source = vi.fn((left: number, right: number) => ({
      total: left + right,
    }));
    const wrapped = memoizeOne(source);

    const first = wrapped(1, 2);
    expect(wrapped(1, 2)).toBe(first);
    expect(wrapped(2, 1)).toEqual({ total: 3 });
    expect(wrapped(1, 2)).not.toBe(first);
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("сравнивает receiver как часть контракта вызова", () => {
    function read(this: { value: number }, suffix: string): string {
      return `${this.value}:${suffix}`;
    }
    const source = vi.fn(read);
    const wrapped = memoizeOne(source);

    expect(wrapped.call({ value: 1 }, "x")).toBe("1:x");
    expect(wrapped.call({ value: 2 }, "x")).toBe("2:x");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("не кеширует исключение", () => {
    let attempts = 0;
    const wrapped = memoizeOne((_value: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary");
      return "ok";
    });

    expect(() => wrapped("same")).toThrow("temporary");
    expect(wrapped("same")).toBe("ok");
    expect(attempts).toBe(2);
  });
});

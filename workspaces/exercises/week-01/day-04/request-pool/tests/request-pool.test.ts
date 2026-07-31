import { describe, expect, it, vi } from "vitest";

import { runRequestPool, type AsyncJob } from "../src/request-pool.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("runRequestPool", () => {
  it("не запускает больше limit jobs одновременно", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<number>());
    let active = 0;
    let peak = 0;
    const jobs = gates.map((gate, index): AsyncJob<number> => async () => {
      active += 1;
      peak = Math.max(peak, active);
      const value = await gate.promise;
      active -= 1;
      return value + index;
    });

    const resultPromise = runRequestPool(jobs, { limit: 2 });
    await vi.waitFor(() => expect(active).toBe(2));
    expect(peak).toBe(2);

    gates[1]!.resolve(10);
    await vi.waitFor(() => expect(active).toBe(2));
    gates[0]!.resolve(20);
    gates[2]!.resolve(30);
    await vi.waitFor(() => expect(active).toBe(1));
    gates[3]!.resolve(40);

    await expect(resultPromise).resolves.toEqual([20, 11, 32, 43]);
    expect(peak).toBe(2);
  });

  it("сохраняет входной порядок при разном порядке завершения", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const resultPromise = runRequestPool(
      [() => first.promise, () => second.promise],
      { limit: 2 },
    );

    second.resolve("second");
    first.resolve("first");

    await expect(resultPromise).resolves.toEqual(["first", "second"]);
  });

  it("не запускает новые jobs после отмены", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const first = deferred<number>();
    const jobs: AsyncJob<number>[] = [
      (signal) => {
        expect(signal).toBe(controller.signal);
        started.push(0);
        return first.promise;
      },
      () => {
        started.push(1);
        return 1;
      },
    ];

    const resultPromise = runRequestPool(jobs, {
      limit: 1,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(started).toEqual([0]));
    controller.abort(new Error("stop"));
    first.resolve(0);

    await expect(resultPromise).rejects.toThrow("stop");
    expect(started).toEqual([0]);
  });

  it("останавливает выдачу новых jobs после первой ошибки", async () => {
    const started: number[] = [];
    const jobs: AsyncJob<number>[] = [
      async () => {
        started.push(0);
        throw new Error("request failed");
      },
      async () => {
        started.push(1);
        return 1;
      },
    ];

    await expect(runRequestPool(jobs, { limit: 1 })).rejects.toThrow(
      "request failed",
    );
    expect(started).toEqual([0]);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "отвергает некорректный limit %s",
    async (limit) => {
      const job = vi.fn(async () => "never");

      await expect(runRequestPool([job], { limit })).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(job).not.toHaveBeenCalled();
    },
  );

  it("возвращает пустой массив без запуска worker", async () => {
    await expect(runRequestPool([], { limit: 3 })).resolves.toEqual([]);
  });
});

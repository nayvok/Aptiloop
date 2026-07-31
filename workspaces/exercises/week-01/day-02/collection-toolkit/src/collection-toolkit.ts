export type KeySelector<T, K> = (item: T, index: number) => K;

/**
 * Groups values by a derived key while preserving insertion order.
 *
 * Do not change the public signature. Implement this function before asking for
 * review; the test suite is the executable contract.
 */
export function groupBy<T, K>(
  items: readonly T[],
  getKey: KeySelector<T, K>,
): Map<K, T[]> {
  void items;
  void getKey;
  throw new Error("TODO: implement groupBy");
}

/** Keeps the first item encountered for every derived key. */
export function uniqueBy<T, K>(
  items: readonly T[],
  getKey: KeySelector<T, K>,
): T[] {
  void items;
  void getKey;
  throw new Error("TODO: implement uniqueBy");
}

/** Counts values for every derived key. */
export function countBy<T, K>(
  items: readonly T[],
  getKey: KeySelector<T, K>,
): Map<K, number> {
  void items;
  void getKey;
  throw new Error("TODO: implement countBy");
}

export type AsyncJob<Result> = (
  signal: AbortSignal,
) => Promise<Result> | Result;

export interface RequestPoolOptions {
  readonly limit: number;
  readonly signal?: AbortSignal;
}

/**
 * Запускает ленивые jobs с ограниченной конкуренцией.
 *
 * TODO: создайте не больше limit workers, выдавайте им индексы и записывайте
 * результат по исходному индексу. Перед каждым новым запуском проверяйте signal
 * и состояние ошибки другого worker.
 */
export async function runRequestPool<Result>(
  _jobs: readonly AsyncJob<Result>[],
  _options: RequestPoolOptions,
): Promise<Result[]> {
  return [];
}

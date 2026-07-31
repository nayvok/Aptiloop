/** Возвращает обёртку, которая успешно вызывает fn не более одного раза. */
export function once<This, Args extends unknown[], Result>(
  _fn: (this: This, ...args: Args) => Result,
): (this: This, ...args: Args) => Result {
  // TODO: храните флаг отдельно от результата, чтобы кешировать undefined.
  return function onceWrapper(this: This, ..._args: Args): Result {
    void this;
    throw new Error("TODO: implement once");
  };
}

/** Кеширует только последний успешный вызов с тем же receiver и аргументами. */
export function memoizeOne<This, Args extends unknown[], Result>(
  _fn: (this: This, ...args: Args) => Result,
): (this: This, ...args: Args) => Result {
  // TODO: сравнивайте receiver и аргументы по Object.is; не используйте truthy-проверку результата.
  return function memoizedWrapper(this: This, ..._args: Args): Result {
    void this;
    throw new Error("TODO: implement memoizeOne");
  };
}

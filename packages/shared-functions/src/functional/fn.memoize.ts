export function fnMemoize<TArgs extends unknown[], TResult>(
  func: (...args: TArgs) => TResult,
) {
  const cache = new Map<string, TResult>();

  return function fnMemoized(...args: TArgs): TResult {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key) as TResult;
    }

    const result = func(...args);
    cache.set(key, result);
    return result;
  };
}

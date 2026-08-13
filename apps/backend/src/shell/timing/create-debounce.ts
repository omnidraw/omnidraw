export type TFnDebounceEffects = {
  setTimeout: (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: typeof globalThis.clearTimeout;
};

export function fnDebounce<TArgs extends unknown[]>(
  effects: TFnDebounceEffects,
  func: (...args: TArgs) => void,
  waitMs: number,
) {
  let timeout: ReturnType<TFnDebounceEffects['setTimeout']> | null = null;

  return function fnDebounced(this: unknown, ...args: TArgs) {
    if (timeout !== null) {
      effects.clearTimeout(timeout);
    }

    timeout = effects.setTimeout(() => {
      func.apply(this, args);
    }, waitMs);
  };
}

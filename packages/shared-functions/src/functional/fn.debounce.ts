export type TFnDebouncePortal = {
  setTimeout: (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: typeof globalThis.clearTimeout;
};

export function fnDebounce<TArgs extends unknown[]>(
  portal: TFnDebouncePortal,
  func: (...args: TArgs) => void,
  waitMs: number,
) {
  let timeout: ReturnType<TFnDebouncePortal['setTimeout']> | null = null;

  return function fnDebounced(this: unknown, ...args: TArgs) {
    if (timeout !== null) {
      portal.clearTimeout(timeout);
    }

    timeout = portal.setTimeout(() => {
      func.apply(this, args);
    }, waitMs);
  };
}

export type TFnThrottleEffects = {
  setTimeout: typeof setTimeout;
};

export function fnThrottle<TArgs extends unknown[]>(
  effects: TFnThrottleEffects,
  func: (...args: TArgs) => void,
  waitMs: number,
) {
  let isThrottled = false;

  return function fnThrottled(this: unknown, ...args: TArgs) {
    if (isThrottled) {
      return;
    }

    isThrottled = true;
    func.apply(this, args);

    effects.setTimeout(() => {
      isThrottled = false;
    }, waitMs);
  };
}

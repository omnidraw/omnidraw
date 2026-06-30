export type TFnThrottlePortal = {
  setTimeout: typeof setTimeout;
};

export function fnThrottle<TArgs extends unknown[]>(
  portal: TFnThrottlePortal,
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

    portal.setTimeout(() => {
      isThrottled = false;
    }, waitMs);
  };
}

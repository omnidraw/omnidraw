export function fnPipe<TValue>(
  value: TValue,
): TValue;
export function fnPipe<TValue, TResult1>(
  value: TValue,
  fn1: (value: TValue) => TResult1,
): TResult1;
export function fnPipe<TValue, TResult1, TResult2>(
  value: TValue,
  fn1: (value: TValue) => TResult1,
  fn2: (value: TResult1) => TResult2,
): TResult2;
export function fnPipe<TValue, TResult1, TResult2, TResult3>(
  value: TValue,
  fn1: (value: TValue) => TResult1,
  fn2: (value: TResult1) => TResult2,
  fn3: (value: TResult2) => TResult3,
): TResult3;
export function fnPipe<TValue, TResult1, TResult2, TResult3, TResult4>(
  value: TValue,
  fn1: (value: TValue) => TResult1,
  fn2: (value: TResult1) => TResult2,
  fn3: (value: TResult2) => TResult3,
  fn4: (value: TResult3) => TResult4,
): TResult4;
export function fnPipe<TValue>(
  value: TValue,
  ...fns: Array<(value: unknown) => unknown>
) {
  return fns.reduce((currentValue, fn) => fn(currentValue), value);
}

export function fnCompose(): <TValue>(value: TValue) => TValue;
export function fnCompose<TValue, TResult1>(
  fn1: (value: TValue) => TResult1,
): (value: TValue) => TResult1;
export function fnCompose<TValue, TResult1, TResult2>(
  fn2: (value: TResult1) => TResult2,
  fn1: (value: TValue) => TResult1,
): (value: TValue) => TResult2;
export function fnCompose<TValue, TResult1, TResult2, TResult3>(
  fn3: (value: TResult2) => TResult3,
  fn2: (value: TResult1) => TResult2,
  fn1: (value: TValue) => TResult1,
): (value: TValue) => TResult3;
export function fnCompose<TValue, TResult1, TResult2, TResult3, TResult4>(
  fn4: (value: TResult3) => TResult4,
  fn3: (value: TResult2) => TResult3,
  fn2: (value: TResult1) => TResult2,
  fn1: (value: TValue) => TResult1,
): (value: TValue) => TResult4;
export function fnCompose(
  ...fns: Array<(value: unknown) => unknown>
) {
  return function fnComposed<TValue>(value: TValue) {
    return fns.reduceRight((currentValue, fn) => fn(currentValue), value);
  };
}

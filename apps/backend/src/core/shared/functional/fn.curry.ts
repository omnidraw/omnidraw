type TCurriedReturn<
  TThis,
  TArgs extends unknown[],
  TResult,
  TProvided extends unknown[],
> = TArgs extends [...TProvided, ...infer TRest]
  ? TRest extends []
    ? TResult
    : TCurried<TThis, TRest, TResult>
  : never;

type TCurried<TThis, TArgs extends unknown[], TResult> = <
  TProvided extends unknown[],
>(
  this: TThis,
  ...args: TArgs extends [...TProvided, ...infer _] ? TProvided : never
) => TCurriedReturn<TThis, TArgs, TResult, TProvided>;

export function fnCurry<TThis, TArgs extends unknown[], TResult>(
  func: (this: TThis, ...args: TArgs) => TResult,
): TCurried<TThis, TArgs, TResult> {
  function fnCurried(this: TThis, ...args: unknown[]) {
    if (args.length >= func.length) {
      return func.apply(this, args as TArgs);
    }

    return function (this: TThis, ...args2: unknown[]) {
      return fnCurried.apply(this, args.concat(args2));
    };
  }

  return fnCurried as TCurried<TThis, TArgs, TResult>;
}

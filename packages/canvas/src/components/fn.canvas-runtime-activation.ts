export type TCanvasRuntimeActivation = Readonly<{
  key: string | null;
  shouldReplace: boolean;
}>;

export type TArgs = Readonly<{
  containerReady: boolean;
  nextKey: string;
  previousKey: string | null;
}>;

export function fnCanvasRuntimeActivation(args: TArgs): TCanvasRuntimeActivation {
  if (!args.containerReady) {
    return Object.freeze({
      key: args.previousKey,
      shouldReplace: false,
    });
  }
  return Object.freeze({
    key: args.nextKey,
    shouldReplace: args.nextKey !== args.previousKey,
  });
}

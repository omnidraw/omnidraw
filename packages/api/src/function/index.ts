// Reserved target domain. M2 intentionally adds no public `function` route.
export type TFunctionApiContract = {
  readonly procedures: readonly never[];
  readonly routeKey: null;
};

export type TFunctionApiContext = Record<never, never>;

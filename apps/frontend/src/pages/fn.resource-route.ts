export type TResourceRouteLoadState<TResource> = {
  requestId: number;
  resourceId: string;
  resource: TResource | null;
  error: string;
};

type TArgsBeginResourceRouteLoad<TResource> = {
  state: TResourceRouteLoadState<TResource>;
  requestId: number;
  resourceId: string;
};

type TArgsResolveResourceRouteLoad<TResource> = {
  state: TResourceRouteLoadState<TResource>;
  requestId: number;
  resourceId: string;
  resource: TResource | null;
  error: string;
};

export function fnBeginResourceRouteLoad<TResource>(args: TArgsBeginResourceRouteLoad<TResource>): TResourceRouteLoadState<TResource> {
  return {
    requestId: args.requestId,
    resourceId: args.resourceId,
    resource: null,
    error: '',
  };
}

export function fnResolveResourceRouteLoad<TResource>(args: TArgsResolveResourceRouteLoad<TResource>): TResourceRouteLoadState<TResource> {
  if (args.state.requestId !== args.requestId || args.state.resourceId !== args.resourceId) return args.state;
  return {
    ...args.state,
    resource: args.resource,
    error: args.error,
  };
}

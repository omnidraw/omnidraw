export type TResourceDataRequest = Readonly<{
  resourceId: string;
  prefix?: string;
  cursor?: string;
  limit: number;
}>;

/** Projects optional UI filters onto the JSON transport without undefined values. */
export function fnResourceDataRequest(args: Readonly<{
  resourceId: string;
  prefix: string;
  cursor?: string;
  limit: number;
}>): TResourceDataRequest {
  return {
    resourceId: args.resourceId,
    ...(args.prefix.length === 0 ? {} : { prefix: args.prefix }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    limit: args.limit,
  };
}

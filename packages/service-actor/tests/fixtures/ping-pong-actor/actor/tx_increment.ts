import type { TTxArgs } from "../../../../src/core/types";

export type TPortalIncrement = {
  readonly setData: (data: { count: number }) => Promise<unknown>;
};

export type TArgsIncrement = TTxArgs<
  { count: number },
  Record<string, never>
>;

export async function txIncrement(portal: TPortalIncrement, args: TArgsIncrement) {
  await portal.setData({ count: args.data.count + 1 });
}

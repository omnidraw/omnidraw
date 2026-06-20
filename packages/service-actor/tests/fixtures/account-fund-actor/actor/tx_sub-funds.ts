import type { TTxArgs, TTxPortal } from "../../../../src/core/types";

export type TPortalSubFunds = TTxPortal;

export type TArgsSubFunds = TTxArgs<
  { balance: number },
  { amount: number; accountId: string }
>;

export async function txSubFunds(portal: TPortalSubFunds, args: TArgsSubFunds) {
  const data = {
    ...args.data,
    balance: args.data.balance - args.msg.amount,
  };

  await portal.setData(data);

  return data;
}

import type { TTxArgs, TTxPortal } from "../../../../src/core/types";

export type TPortalAddFunds = TTxPortal;

export type TArgsAddFunds = TTxArgs<
  { balance: number },
  { amount: number; accountId: string }
>;

export async function txAddFunds(portal: TPortalAddFunds, args: TArgsAddFunds) {
  const data = {
    ...args.data,
    balance: args.data.balance + args.msg.amount,
  };

  await portal.setData(data);

  return data;
}

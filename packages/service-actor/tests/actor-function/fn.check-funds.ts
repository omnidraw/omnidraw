import type { TFnArgs } from "../../src/core/types";

export type TPortalCheckFunds = {
  readonly next: () => Promise<unknown>;
};

export type TArgsCheckFunds = TFnArgs<
  { balance: number },
  { amount: number; accountId: string }
>;

export async function fnCheckFunds(portal: TPortalCheckFunds, args: TArgsCheckFunds) {
  if (args.msg.amount === 0) {
    throw { code: "invalid_amount", message: "Amount must be non-zero" };
  }

  return portal.next();
}

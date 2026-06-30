import type { TFnArgs } from "../../../../src/core/types";

export type TPortalConsumeNextReturn = {
  readonly next: () => Promise<{ balance: number }>;
  readonly emitMessage: (msg: any) => Promise<unknown>;
};

export type TArgsConsumeNextReturn = TFnArgs<
  { balance: number },
  { amount: number; accountId: string }
>;

export async function fnConsumeNextReturn(portal: TPortalConsumeNextReturn, args: TArgsConsumeNextReturn) {
  await portal.emitMessage({
    type: "before-next",
    payload: {
      amount: args.msg.amount,
      balance: args.data.balance,
    },
  });

  const nextResult = await portal.next();

  await portal.emitMessage({
    type: "after-next",
    payload: {
      balance: nextResult.balance,
    },
  });

  return nextResult;
}

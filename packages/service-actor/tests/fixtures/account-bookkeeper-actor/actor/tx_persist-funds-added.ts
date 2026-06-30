import type { TTxArgs, TTxPortal } from "../../../../src/core/types";

type TBookkeeperEntry = {
  readonly accountId: string;
  readonly amount: number;
  readonly balance: number;
};

export type TPortalPersistFundsAdded = TTxPortal;

export type TArgsPersistFundsAdded = TTxArgs<
  { entries: TBookkeeperEntry[] },
  TBookkeeperEntry
>;

export async function txPersistFundsAdded(portal: TPortalPersistFundsAdded, args: TArgsPersistFundsAdded) {
  const data = {
    ...args.data,
    entries: [
      ...args.data.entries,
      {
        accountId: args.msg.accountId,
        amount: args.msg.amount,
        balance: args.msg.balance,
      },
    ],
  };

  await portal.setData(data);

  return data;
}

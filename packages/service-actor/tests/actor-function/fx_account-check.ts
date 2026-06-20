import type { TFxArgs, TFxPortal } from "../../src/core/types";

async function readAccountStatus(accountId: string): Promise<"open" | "close"> {
  return 'open'
}

export type TArgsAccountCheck = TFxArgs<
  { balance: number },
  { amount: number; accountId: string }
>;

export type TPortalAccountCheck = TFxPortal;

export async function fxAccountCheck(portal: TPortalAccountCheck, args: TArgsAccountCheck) {
  const status = await readAccountStatus(args.msg.accountId);

  if (status !== "open") {
    throw { code: "account_closed", message: "Account must be open" };
  }

  return portal.next();
}

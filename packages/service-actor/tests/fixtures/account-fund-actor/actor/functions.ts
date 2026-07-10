import { fnCheckFunds } from "./fn_check-funds";
import { fnConsumeNextReturn } from "./fn_consume-next-return";
import { fnEmitInvalidOutput } from "./fn_emit-invalid-output";
import { fxAccountCheck } from "./fx_account-check";
import { txAddFunds } from "./tx_add-funds";
import { txSubFunds } from "./tx_sub-funds";

async function txRecord(portal: { setData: (data: unknown) => Promise<unknown> }, args: { data: any; msg: any }) {
  await portal.setData({
    ...args.data,
    events: [...(args.data.events ?? []), args.msg.kind ?? "transition"],
  });
}

async function txActivityTick(portal: { setData: (data: unknown) => Promise<unknown> }, args: { data: any }) {
  await portal.setData({ ...args.data, ticks: (args.data.ticks ?? 0) + 1 });
}

async function txRecover(portal: { setData: (data: unknown) => Promise<unknown> }, args: { data: any }) {
  await portal.setData({ ...args.data, recovered: (args.data.recovered ?? 0) + 1 });
}

async function txRecoverTransition(portal: { setData: (data: unknown) => Promise<unknown> }, args: { data: any }) {
  await portal.setData({ ...args.data, recoverySource: "transition" });
}

async function txFailFirstEnter(portal: { setData: (data: unknown) => Promise<unknown> }, args: { data: any; msg: any }) {
  if (args.msg.kind === "lifecycle.enter" && !args.data.enterAttempted) {
    await portal.setData({ ...args.data, enterAttempted: true });
    throw new Error("first enter failed");
  }
  await txRecord(portal, args);
}

export default {
  fn: {
    "fn.checkFunds": fnCheckFunds,
    "fn.consumeNextReturn": fnConsumeNextReturn,
    "fn.emitInvalidOutput": fnEmitInvalidOutput,
    "fn.noop": async () => {},
    "fn.throw": async () => {
      throw new Error("fixture transition failed");
    },
  },
  fx: {
    "fx.accountCheck": fxAccountCheck,
  },
  tx: {
    "tx.addFunds": txAddFunds,
    "tx.subFunds": txSubFunds,
    "tx.record": txRecord,
    "tx.activityTick": txActivityTick,
    "tx.recover": txRecover,
    "tx.recoverTransition": txRecoverTransition,
    "tx.failFirstEnter": txFailFirstEnter,
  },
};

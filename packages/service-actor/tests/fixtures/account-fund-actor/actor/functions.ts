import { fnCheckFunds } from "./fn_check-funds";
import { fnConsumeNextReturn } from "./fn_consume-next-return";
import { fnEmitInvalidOutput } from "./fn_emit-invalid-output";
import { fxAccountCheck } from "./fx_account-check";
import { txAddFunds } from "./tx_add-funds";
import { txSubFunds } from "./tx_sub-funds";

export default {
  fn: {
    "fn.checkFunds": fnCheckFunds,
    "fn.consumeNextReturn": fnConsumeNextReturn,
    "fn.emitInvalidOutput": fnEmitInvalidOutput,
  },
  fx: {
    "fx.accountCheck": fxAccountCheck,
  },
  tx: {
    "tx.addFunds": txAddFunds,
    "tx.subFunds": txSubFunds,
  },
};

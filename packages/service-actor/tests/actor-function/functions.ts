import { fnCheckFunds } from "./fn.check-funds";
import { fxAccountCheck } from "./fx.account-check";
import { txAddFunds } from "./tx.add-funds";
import { txSubFunds } from "./tx.sub-funds";

export default {
  fn: {
    "fn.checkFunds": fnCheckFunds,
  },
  fx: {
    "fx.accountCheck": fxAccountCheck,
  },
  tx: {
    "tx.addFunds": txAddFunds,
    "tx.subFunds": txSubFunds,
  },
};

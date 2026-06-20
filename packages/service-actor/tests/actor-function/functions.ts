import { fnCheckFunds } from "./fn.check-funds";
import { fxAccountCheck } from "./fx.account-check";
import { txAddFunds } from "./tx.add-funds";

export default {
  fn: {
    "fn.checkFunds": fnCheckFunds,
  },
  fx: {
    "fx.accountCheck": fxAccountCheck,
  },
  tx: {
    "tx.addFunds": txAddFunds,
  },
};

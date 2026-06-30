import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fnCheckExtension from "./fn-check";
import fxCheckExtension from "./fx-check";
import txCheckExtension from "./tx-check";

export default function functionalCoreExtension(pi: ExtensionAPI) {
  fnCheckExtension(pi);
  fxCheckExtension(pi);
  txCheckExtension(pi);
}

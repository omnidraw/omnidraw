import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerFunctionalCorePiCheck } from "./pi-adapter";

export {
  TX_CHECK_RULES,
  isTxFilePath,
  validateTxFileContent,
} from "./core/checks";

export default function txCheckExtension(pi: ExtensionAPI) {
  registerFunctionalCorePiCheck(pi, "tx");
}

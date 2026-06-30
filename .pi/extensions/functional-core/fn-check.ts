import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerFunctionalCorePiCheck } from "./pi-adapter";

export {
  FN_CHECK_RULES,
  isFnFilePath,
  validateFnFileContent,
} from "./core/checks";

export default function fnCheckExtension(pi: ExtensionAPI) {
  registerFunctionalCorePiCheck(pi, "fn");
}

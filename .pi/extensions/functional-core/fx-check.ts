import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerFunctionalCorePiCheck } from "./pi-adapter";

export {
  FX_CHECK_RULES,
  isFxFilePath,
  validateFxFileContent,
} from "./core/checks";

export default function fxCheckExtension(pi: ExtensionAPI) {
  registerFunctionalCorePiCheck(pi, "fx");
}

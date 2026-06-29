import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { TFunctionalCoreKind } from "./core/checks";
import { buildFunctionalCoreRulesPrompt } from "./core/checks";
import { runFunctionalCoreEslint } from "./core/eslint";

const MAX_REPEATED_FAILURES = 2;

let didRegisterPostTurnLint = false;
let lastFailureFingerprint = "";
let repeatedFailureCount = 0;

function shouldSendLintFailure(fingerprint: string): boolean {
  if (fingerprint !== lastFailureFingerprint) {
    lastFailureFingerprint = fingerprint;
    repeatedFailureCount = 1;
    return true;
  }

  repeatedFailureCount += 1;
  return repeatedFailureCount <= MAX_REPEATED_FAILURES;
}

function resetLintFailureGuard(): void {
  lastFailureFingerprint = "";
  repeatedFailureCount = 0;
}

export function registerFunctionalCorePiCheck(pi: ExtensionAPI, kind: TFunctionalCoreKind): void {
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: event.systemPrompt + buildFunctionalCoreRulesPrompt(kind),
    };
  });

  if (didRegisterPostTurnLint) return;
  didRegisterPostTurnLint = true;

  pi.on("agent_end", async (_event, ctx) => {
    const report = await runFunctionalCoreEslint(ctx.cwd);

    if (report.ok) {
      resetLintFailureGuard();
      return undefined;
    }

    if (!shouldSendLintFailure(report.fingerprint)) {
      return undefined;
    }

    const message = [
      report.text,
      "",
      "Please fix the functional-core ESLint violations. Do not disable rules unless there is an explicit reason.",
    ].join("\n");

    pi.sendUserMessage(message, { deliverAs: "followUp" });
    return undefined;
  });
}

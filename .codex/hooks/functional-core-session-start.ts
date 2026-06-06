#!/usr/bin/env bun

import { buildFunctionalCoreRulesOverview } from "../../.pi/extensions/functional-core/core/checks";

const context = [
  "Functional-core file rules are active for this repository.",
  "",
  buildFunctionalCoreRulesOverview(),
  "",
  "When editing fn.*.ts, fx.*.ts, or tx.*.ts files, fix any reported violations before continuing.",
].join("\n");

process.stdout.write(`${JSON.stringify({
  continue: true,
  suppressOutput: false,
  message: context,
  additionalContext: context,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: context,
  },
})}\n`);

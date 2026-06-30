#!/usr/bin/env bun

import path from "node:path";
import { runFunctionalCoreEslint } from "../../.pi/extensions/functional-core/core/eslint";

type THookResponse = {
  continue: true;
  suppressOutput: boolean;
  message?: string;
  additionalContext?: string;
  hookSpecificOutput?: {
    hookEventName: "PostToolUse";
    additionalContext?: string;
  };
};

function writeJson(response: THookResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function main() {
  const rootDir = path.resolve(import.meta.dir, "../..");
  const report = await runFunctionalCoreEslint(rootDir);

  if (report.ok) {
    writeJson({
      continue: true,
      suppressOutput: true,
      message: "functional-core ESLint passed.",
    });
    return;
  }

  writeJson({
    continue: true,
    suppressOutput: false,
    message: report.text,
    additionalContext: report.text,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: report.text,
    },
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const text = `functional-core ESLint hook failed to run: ${message}`;
  writeJson({
    continue: true,
    suppressOutput: false,
    message: text,
    additionalContext: text,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: text,
    },
  });
});

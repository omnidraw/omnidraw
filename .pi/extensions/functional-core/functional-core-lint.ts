#!/usr/bin/env bun

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatLintReport,
  HELP_TEXT,
  lintFunctionalCorePaths,
  parseArgs,
} from "./core/lint";

export {
  buildRulesOverview,
  collectLintableFiles,
  formatLintReport,
  lintFunctionalCorePaths,
  parseArgs,
  type TLintResult,
  type TParsedArgs,
  type TPathReport,
} from "./core/lint";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "help") {
    console.log(HELP_TEXT);
    return;
  }

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const result = await lintFunctionalCorePaths(rootDir, args.subpaths);
  console.log(formatLintReport(result));

  if (result.reports.length > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

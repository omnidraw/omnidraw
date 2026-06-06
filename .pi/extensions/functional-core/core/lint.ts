import path from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
import {
  buildFunctionalCoreRulesOverview,
  getFunctionalCoreKindForPath,
  validateFunctionalCoreFileContent,
} from "./checks";

export type TParsedArgs =
  | {
      mode: "help";
      subpaths: [];
    }
  | {
      mode: "lint";
      subpaths: string[];
    };

type TValidator = {
  validate: (filePath: string, content: string) => string[];
};

export type TPathReport = {
  path: string;
  errors: string[];
};

export type TLintResult = {
  files: string[];
  reports: TPathReport[];
};

export const HELP_TEXT = [
  "Usage:",
  "  bun run .pi/extensions/functional-core/functional-core-lint.ts",
  "  bun run .pi/extensions/functional-core/functional-core-lint.ts <subpath> [more-subpaths...]",
  "  bun run .pi/extensions/functional-core/functional-core-lint.ts --help",
  "",
  "Notes:",
  "- no args: lint all fn.*, fx.*, and tx.* files in the repo",
  "- subpaths are repo-relative paths to files or folders",
].join("\n");

const IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".turbo",
]);

export function parseArgs(argv: string[]): TParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { mode: "help", subpaths: [] };
  }

  const invalidFlags = argv.filter((arg) => arg.startsWith("-"));
  if (invalidFlags.length > 0) {
    throw new Error(`Unknown argument: ${invalidFlags[0]}\n\n${HELP_TEXT}`);
  }

  return { mode: "lint", subpaths: argv };
}

export function buildRulesOverview(): string {
  return buildFunctionalCoreRulesOverview();
}

function getValidator(filePath: string): TValidator | undefined {
  const kind = getFunctionalCoreKindForPath(filePath);
  if (!kind) {
    return undefined;
  }

  return {
    validate: (nextFilePath, content) => validateFunctionalCoreFileContent(kind, nextFilePath, content),
  };
}

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isInsideRoot(rootDir: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function resolveInputPaths(rootDir: string, subpaths: string[]): Promise<string[]> {
  const rawPaths = subpaths.length === 0 ? ["."] : subpaths;
  const resolvedPaths: string[] = [];

  for (const rawPath of rawPaths) {
    const absolutePath = path.resolve(rootDir, rawPath);

    if (!isInsideRoot(rootDir, absolutePath)) {
      throw new Error(`Path must stay inside repo root: ${rawPath}`);
    }

    try {
      await lstat(absolutePath);
    } catch {
      throw new Error(`Path not found: ${rawPath}`);
    }

    resolvedPaths.push(absolutePath);
  }

  return resolvedPaths;
}

async function collectLintableFilesFromPath(rootDir: string, absolutePath: string, foundPaths: Set<string>): Promise<void> {
  const stat = await lstat(absolutePath);

  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isFile()) {
    const relativePath = normalizeSlashes(path.relative(rootDir, absolutePath));
    if (getValidator(relativePath)) {
      foundPaths.add(relativePath);
    }
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  if (IGNORED_DIR_NAMES.has(path.basename(absolutePath))) {
    return;
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }

    await collectLintableFilesFromPath(rootDir, path.join(absolutePath, entry.name), foundPaths);
  }
}

export async function collectLintableFiles(rootDir: string, subpaths: string[]): Promise<string[]> {
  const absolutePaths = await resolveInputPaths(rootDir, subpaths);
  const foundPaths = new Set<string>();

  for (const absolutePath of absolutePaths) {
    await collectLintableFilesFromPath(rootDir, absolutePath, foundPaths);
  }

  return [...foundPaths].sort((left, right) => left.localeCompare(right));
}

function stripFilePrefix(filePath: string, errors: string[]): string[] {
  const prefix = `${path.basename(filePath)}: `;
  return errors.map((error) => (error.startsWith(prefix) ? error.slice(prefix.length) : error));
}

async function lintFile(rootDir: string, filePath: string): Promise<TPathReport | undefined> {
  const validator = getValidator(filePath);
  if (!validator) {
    return undefined;
  }

  try {
    const absolutePath = path.join(rootDir, filePath);
    const content = await readFile(absolutePath, "utf8");
    const errors = stripFilePrefix(filePath, validator.validate(filePath, content));

    if (errors.length === 0) {
      return undefined;
    }

    return { path: filePath, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path: filePath,
      errors: [`failed to read file: ${message}`],
    };
  }
}

export async function lintFunctionalCorePaths(rootDir: string, subpaths: string[]): Promise<TLintResult> {
  const files = await collectLintableFiles(rootDir, subpaths);
  const reports = (
    await Promise.all(files.map((filePath) => lintFile(rootDir, filePath)))
  )
    .filter((report): report is TPathReport => !!report)
    .sort((left, right) => left.path.localeCompare(right.path));

  return { files, reports };
}

export function formatLintReport(result: TLintResult): string {
  if (result.files.length === 0) {
    return ["[RESULT]", "- no matching fn.*, fx.*, or tx.* files found"].join("\n");
  }

  if (result.reports.length === 0) {
    return "ok";
  }

  const blocks = [buildRulesOverview(), ""];

  for (const report of result.reports) {
    blocks.push(`[${report.path}]`);
    blocks.push(...report.errors.map((error) => `- ${error}`));
    blocks.push("");
  }

  return blocks.join("\n").trimEnd();
}

#!/usr/bin/env bun

import path from "node:path";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import {
  formatLintReport,
  lintFunctionalCorePaths,
  type TLintResult,
} from "../../.pi/extensions/functional-core/core/lint";
import { getFunctionalCoreKindForPath } from "../../.pi/extensions/functional-core/core/checks";

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

const PATH_KEY_RE = /(^|_)(absolute_)?(file_)?path(s)?$/i;
const TOOL_INPUT_KEY_RE = /^(tool_)?input$/i;
const MAX_DEPTH = 8;

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isInsideRoot(rootDir: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function toRepoRelativePath(rootDir: string, candidate: string): string | undefined {
  const clean = candidate.startsWith("@") ? candidate.slice(1) : candidate;
  if (!clean || clean.includes("\0")) {
    return undefined;
  }

  const absolutePath = path.isAbsolute(clean)
    ? path.resolve(clean)
    : path.resolve(rootDir, clean);

  if (!isInsideRoot(rootDir, absolutePath)) {
    return undefined;
  }

  return normalizeSlashes(path.relative(rootDir, absolutePath));
}

function addPathCandidate(rootDir: string, found: Set<string>, candidate: unknown): void {
  if (typeof candidate === "string") {
    const relativePath = toRepoRelativePath(rootDir, candidate);
    if (relativePath && getFunctionalCoreKindForPath(relativePath)) {
      found.add(relativePath);
    }
    return;
  }

  if (!Array.isArray(candidate)) {
    return;
  }

  for (const item of candidate) {
    addPathCandidate(rootDir, found, item);
  }
}

function collectPathCandidates(rootDir: string, value: unknown, found: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH || value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathCandidates(rootDir, item, found, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (PATH_KEY_RE.test(key)) {
      addPathCandidate(rootDir, found, nestedValue);
      continue;
    }

    if (TOOL_INPUT_KEY_RE.test(key)) {
      collectPathCandidates(rootDir, nestedValue, found, depth + 1);
      continue;
    }

    collectPathCandidates(rootDir, nestedValue, found, depth + 1);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function writeJson(response: THookResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function buildNoopResponse(reason: string): THookResponse {
  return {
    continue: true,
    suppressOutput: true,
    message: reason,
  };
}

function buildViolationResponse(result: TLintResult): THookResponse {
  const report = formatLintReport(result);
  const message = [
    "functional-core hook found rule violations in edited files.",
    "",
    report,
  ].join("\n");

  return {
    continue: true,
    suppressOutput: false,
    message,
    additionalContext: message,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: message,
    },
  };
}

async function main() {
  const rootDir = path.resolve(import.meta.dir, "../..");
  const rawPayload = await readStdin();
  const payload = parseJsonPayload(rawPayload);
  const files = new Set<string>();
  collectPathCandidates(rootDir, payload, files);

  if (files.size === 0) {
    writeJson(buildNoopResponse("functional-core hook skipped: no edited fn/fx/tx path was exposed by the hook payload."));
    return;
  }

  const existingFiles: string[] = [];
  for (const filePath of files) {
    try {
      await readFile(path.join(rootDir, filePath), "utf8");
      existingFiles.push(filePath);
    } catch {
      // Deleted files do not need content validation.
    }
  }

  if (existingFiles.length === 0) {
    writeJson(buildNoopResponse("functional-core hook skipped: matching paths were deleted or unreadable."));
    return;
  }

  const result = await lintFunctionalCorePaths(rootDir, existingFiles);
  if (result.reports.length === 0) {
    writeJson({
      continue: true,
      suppressOutput: true,
      message: "functional-core hook passed.",
    });
    return;
  }

  writeJson(buildViolationResponse(result));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeJson({
    continue: true,
    suppressOutput: false,
    message: `functional-core hook failed to run: ${message}`,
    additionalContext: `functional-core hook failed to run: ${message}`,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `functional-core hook failed to run: ${message}`,
    },
  });
});

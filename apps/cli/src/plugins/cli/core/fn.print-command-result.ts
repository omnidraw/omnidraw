/* eslint-disable functional-core/no-runtime-globals -- legacy CLI printer writes directly to process streams */

import { CANVAS_SUBCOMMANDS } from '../cmds/CONSTANTS';

type TCliErrorPayload = {
  ok: false;
  command: string | null;
  code: string;
  message: string;
  hint?: string;
  next?: string;
  suggestions?: string[];
  [key: string]: unknown;
};

const ROOT_COMMANDS = ['serve', 'canvas', 'upgrade', 'uninstall'] as const;

function fnLevenshteinDistance(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const matrix = Array.from({ length: a.length + 1 }, (_, row) => Array.from({ length: b.length + 1 }, (_, col) => row === 0 ? col : col === 0 ? row : 0));

  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(matrix[row - 1]![col]! + 1, matrix[row]![col - 1]! + 1, matrix[row - 1]![col - 1]! + cost);
    }
  }

  return matrix[a.length]![b.length]!;
}

function fnFindClosestSuggestion(input: string | undefined, candidates: readonly string[]): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;

  let bestCandidate: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = fnLevenshteinDistance(trimmed, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }

  const threshold = Math.max(2, Math.ceil(trimmed.length / 3));
  return bestDistance <= threshold ? bestCandidate : undefined;
}

export function fnBuildUnknownCommandError(scope: 'root', input: string | undefined): TCliErrorPayload {
  const candidates = [...ROOT_COMMANDS];
  const suggestion = fnFindClosestSuggestion(input, candidates);

  return {
    ok: false,
    command: 'cli',
    code: 'CLI_COMMAND_UNKNOWN',
    message: `Unknown command '${input ?? ''}'.`,
    hint: suggestion ? `Did you mean '${suggestion}'?` : `Available commands: ${candidates.join(', ')}.`,
    next: suggestion ? `Try: omnidraw ${suggestion} --help` : 'Try: omnidraw --help',
    suggestions: suggestion ? [suggestion] : [],
  };
}

export function fnBuildUnknownCanvasCommandError(input: string | undefined): TCliErrorPayload {
  const candidates = [...CANVAS_SUBCOMMANDS];
  const suggestion = fnFindClosestSuggestion(input, candidates);

  return {
    ok: false,
    command: 'canvas',
    code: 'CANVAS_COMMAND_UNKNOWN',
    message: `Unknown canvas command '${input ?? ''}'.`,
    hint: suggestion ? `Did you mean '${suggestion}'?` : `Available commands: ${candidates.join(', ')}.`,
    next: suggestion
      ? `Try: omnidraw canvas ${suggestion} --help`
      : 'Try: omnidraw canvas --help',
    suggestions: suggestion ? [suggestion] : [],
  };
}

function fnNormalizeCommandError(error: unknown): TCliErrorPayload {
  const payload: Record<string, unknown> = typeof error === 'object' && error !== null
    ? { ...error as Record<string, unknown> }
    : { message: typeof error === 'string' ? error : String(error) };
  const errorMessage = error instanceof Error ? error.message : undefined;

  const normalized: TCliErrorPayload = {
    ...payload,
    ok: false,
    command: typeof payload.command === 'string' || payload.command === null ? payload.command as string | null : 'cli',
    code: typeof payload.code === 'string' ? payload.code : 'CLI_COMMAND_FAILED',
    message: typeof payload.message === 'string'
      ? payload.message
      : errorMessage ?? 'Command failed.',
  };

  if (!normalized.hint && normalized.code === 'DATA_DIR_FLAG_MISSING_VALUE') {
    normalized.hint = 'Pass one Omnidraw home path right after --data-dir.';
    normalized.next = 'Try: omnidraw serve --data-dir ./tmp/omnidraw-home';
  }

  return normalized;
}

export function fnPrintCommandResult(result: unknown, wantsJson: boolean, extraFields?: Record<string, unknown>): void {
  if (wantsJson) {
    const payload = typeof result === 'object' && result !== null && extraFields !== undefined
      ? { ...result, ...Object.fromEntries(Object.entries(extraFields).filter(([, value]) => value !== undefined)) }
      : result;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 0;
    return;
  }

  console.log(result);
  process.exitCode = 0;
}

export function fnPrintCommandError(error: unknown, wantsJson: boolean): void {
  const normalized = fnNormalizeCommandError(error);

  if (wantsJson) {
    process.stderr.write(`${JSON.stringify(normalized)}\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`${normalized.message}\n`);
  if (normalized.hint) process.stderr.write(`Hint: ${normalized.hint}\n`);
  if (normalized.next) process.stderr.write(`Next: ${normalized.next}\n`);
  process.exitCode = 1;
}

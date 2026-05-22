import { CANVAS_SUBCOMMANDS } from './constants';

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

function fnBuildPatchHint(message: string): Pick<TCliErrorPayload, 'hint' | 'next'> {
  if (message.startsWith('Unknown patch branch')) {
    return {
      hint: 'Patch payload must use one top-level envelope: {"element":{...}} for elements or {"group":{...}} for groups.',
      next: 'Try: vibecanvas patch --canvas <canvas-id> --id <target-id> --patch \'{"element":{"x":10}}\' --json',
    };
  }

  return {
    hint: 'Patch payload must be valid JSON using {"element":{...}} or {"group":{...}}.',
    next: 'Examples: {"element":{"x":10,"style":{"backgroundColor":"#ff0000"}}} or {"group":{"locked":true}}',
  };
}

export function fnBuildUnknownCommandError(scope: 'root' | 'canvas', input: string | undefined): TCliErrorPayload {
  const candidates = scope === 'canvas' ? [...CANVAS_SUBCOMMANDS] : ['serve', 'upgrade', 'canvas', ...CANVAS_SUBCOMMANDS];
  const suggestion = fnFindClosestSuggestion(input, candidates);

  return {
    ok: false,
    command: scope === 'canvas' ? 'canvas' : 'cli',
    code: scope === 'canvas' ? 'CANVAS_SUBCOMMAND_UNKNOWN' : 'CLI_COMMAND_UNKNOWN',
    message: scope === 'canvas' ? `Unknown canvas command '${input ?? ''}'.` : `Unknown command '${input ?? ''}'.`,
    hint: suggestion ? `Did you mean '${suggestion}'?` : `Available ${scope === 'canvas' ? 'canvas subcommands' : 'commands'}: ${candidates.join(', ')}.`,
    next: suggestion ? `Try: vibecanvas ${suggestion} --help` : scope === 'canvas' ? 'Try: vibecanvas canvas --help' : 'Try: vibecanvas --help',
    suggestions: suggestion ? [suggestion] : [],
  };
}

function fnNormalizeCommandError(error: unknown): TCliErrorPayload {
  const payload: Record<string, unknown> = typeof error === 'object' && error !== null
    ? { ...error as Record<string, unknown> }
    : { message: typeof error === 'string' ? error : String(error) };

  const normalized: TCliErrorPayload = {
    ...payload,
    ok: false,
    command: typeof payload.command === 'string' || payload.command === null ? payload.command as string | null : 'canvas',
    code: typeof payload.code === 'string' ? payload.code : 'CLI_COMMAND_FAILED',
    message: typeof payload.message === 'string' ? payload.message : 'Command failed.',
  };

  if (!normalized.hint && normalized.command === 'canvas.patch' && normalized.code === 'CANVAS_PATCH_PAYLOAD_INVALID') {
    Object.assign(normalized, fnBuildPatchHint(normalized.message));
  }

  if (!normalized.hint && normalized.command === 'canvas.add' && normalized.code === 'CANVAS_ADD_SOURCE_REQUIRED') {
    normalized.hint = 'Pass exactly one element source: --element, --elements-file, --elements-stdin, or shorthand flags.';
    normalized.next = 'Try: vibecanvas add --canvas <canvas-id> --rect 10,20,120,80 --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.add' && normalized.code === 'CANVAS_ADD_SOURCE_CONFLICT') {
    normalized.hint = 'Choose one add payload source only.';
    normalized.next = 'Do not mix shorthand flags with --element/--elements-file/--elements-stdin.';
  }

  if (!normalized.hint && normalized.command === 'canvas.add' && normalized.code === 'CANVAS_ADD_PAYLOAD_INVALID') {
    normalized.hint = 'Add payloads must be valid JSON objects, or a JSON array when using file/stdin.';
    normalized.next = 'Try: vibecanvas add --canvas <canvas-id> --element \'{"type":"rect"}\' --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.add' && normalized.code === 'CANVAS_ADD_SHORTHAND_INVALID') {
    normalized.hint = 'Use strict shorthand grammar only: rect x,y,w,h; ellipse x,y,rx,ry; diamond x,y,w,h; text x,y,text; line/arrow x,y,x2,y2.';
    normalized.next = 'Try: vibecanvas add --canvas <canvas-id> --text 40,20,hello --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.query' && normalized.code === 'CANVAS_QUERY_SELECTOR_CONFLICT') {
    normalized.hint = 'Use exactly one selector style: structured flags, --where, or --query.';
    normalized.next = 'Try: vibecanvas query --canvas <canvas-id> --id <target-id> --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.query' && normalized.code === 'CANVAS_QUERY_OUTPUT_INVALID') {
    normalized.hint = 'Use one of the documented output modes only.';
    normalized.next = 'Try: vibecanvas query --canvas <canvas-id> --output summary --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.query' && normalized.code === 'CANVAS_QUERY_JSON_INVALID') {
    normalized.hint = '--query must be a JSON object with known selector fields.';
    normalized.next = 'Try: vibecanvas query --canvas <canvas-id> --query \'{"ids":["target-id"]}\' --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.patch' && normalized.code === 'CANVAS_PATCH_SOURCE_REQUIRED') {
    normalized.hint = 'Pass exactly one patch source: --patch, --patch-file, or --patch-stdin.';
    normalized.next = 'Try: vibecanvas patch --canvas <canvas-id> --id <target-id> --patch \'{"element":{"x":10}}\' --json';
  }

  if (!normalized.hint && normalized.command === 'canvas.patch' && normalized.code === 'CANVAS_PATCH_SOURCE_CONFLICT') {
    normalized.hint = 'Choose one patch source only.';
    normalized.next = 'Remove extra patch source flags and retry.';
  }

  if (!normalized.hint && normalized.code === 'DB_FLAG_MISSING_VALUE') {
    normalized.hint = 'Pass one SQLite file path right after --db.';
    normalized.next = 'Try: vibecanvas canvas list --db ./tmp/vibecanvas.turso --json';
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

  if (typeof result === 'object' && result !== null && 'dryRun' in result && result.dryRun === true) {
    process.stdout.write(`[dry-run] no mutation applied\n`);
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

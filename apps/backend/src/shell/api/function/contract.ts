import { pc } from '../procedure';
import { z } from 'zod';

const IDENTIFIER_MAX_LENGTH = 200;
const FUNCTION_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const WIDGET_KEY_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const JSON_MAX_BYTES = 1_048_576;
const JSON_MAX_DEPTH = 64;
const JSON_MAX_NODES = 100_000;

function isBoundedJson(root: unknown): boolean {
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const next = pending.pop()!;
    nodes += 1;
    if (nodes > JSON_MAX_NODES || next.depth > JSON_MAX_DEPTH) return false;
    if (next.value === null || typeof next.value === 'string' || typeof next.value === 'boolean') continue;
    if (typeof next.value === 'number') {
      if (!Number.isFinite(next.value)) return false;
      continue;
    }
    if (typeof next.value !== 'object') return false;
    const values = Array.isArray(next.value)
      ? next.value
      : Object.values(next.value as Record<string, unknown>);
    for (const value of values) pending.push({ value, depth: next.depth + 1 });
  }
  try {
    const encoded = JSON.stringify(root);
    return encoded !== undefined
      && new TextEncoder().encode(encoded).byteLength <= JSON_MAX_BYTES;
  } catch {
    return false;
  }
}

export const ZFunctionJson = z.unknown().refine(isBoundedJson, {
  message: 'Expected bounded JSON data.',
});

const ZFunctionDiagnostics = z.object({
  code: z.string().min(1).max(128).nullable(),
  message: z.string().max(65_536).nullable(),
  logByteSize: z.number().int().min(0).max(65_536),
  truncated: z.boolean(),
}).strict();

const ZFunctionFailure = z.object({
  owner: z.enum(['user', 'platform', 'cancelled']),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(65_536),
}).strict();

export const ZDirectFunctionResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('succeeded'),
    output: ZFunctionJson,
    diagnostics: ZFunctionDiagnostics,
  }).strict(),
  z.object({
    status: z.enum(['failed', 'cancelled', 'timed_out']),
    output: z.null(),
    failure: ZFunctionFailure,
    diagnostics: ZFunctionDiagnostics,
  }).strict(),
]);

export const ZInvokeFunctionInput = z.object({
  canvasId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  elementId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  widgetInstanceId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  widgetKey: z.string().regex(WIDGET_KEY_PATTERN),
  catalogGeneration: z.number().int().positive(),
  functionName: z.string().regex(FUNCTION_NAME_PATTERN),
  input: ZFunctionJson,
}).strict();

const functionContract = pc.router({
  invoke: pc.input(ZInvokeFunctionInput).output(ZDirectFunctionResult),
});

export { functionContract };

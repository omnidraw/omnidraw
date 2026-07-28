import { oc } from '@orpc/contract';
import { z } from 'zod';

const IDENTIFIER_MAX_LENGTH = 200;
const FUNCTION_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
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
    if (
      next.value === null
      || typeof next.value === 'string'
      || typeof next.value === 'boolean'
    ) continue;
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

export const ZFunctionInvocationStatus = z.enum([
  'queued',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

export const ZFunctionInvocationView = z.object({
  id: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  functionName: z.string().regex(FUNCTION_NAME_PATTERN),
  widgetRevisionId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  widgetInstanceId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  status: ZFunctionInvocationStatus,
  output: ZFunctionJson.nullable(),
  failure: z.object({
    owner: z.enum(['user', 'platform', 'cancelled']),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4_096),
    retryable: z.boolean(),
  }).strict().nullable(),
  createdAtMs: z.number().int().nonnegative(),
  startedAtMs: z.number().int().nonnegative().nullable(),
  finishedAtMs: z.number().int().nonnegative().nullable(),
}).strict();

export const ZInvokeFunctionInput = z.object({
  widgetInstanceId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  widgetRevisionId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
  functionName: z.string().regex(FUNCTION_NAME_PATTERN),
  input: ZFunctionJson,
  idempotencyKey: z.string().min(1).max(200),
}).strict();

export const ZFunctionInvocationIdentity = z.object({
  invocationId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
}).strict();

const functionContract = oc.router({
  invoke: oc.input(ZInvokeFunctionInput).output(ZFunctionInvocationView),
  get: oc.input(ZFunctionInvocationIdentity).output(ZFunctionInvocationView),
  cancel: oc.input(ZFunctionInvocationIdentity).output(ZFunctionInvocationView),
});

export { functionContract };

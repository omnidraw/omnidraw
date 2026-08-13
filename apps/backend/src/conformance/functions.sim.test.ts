import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { FunctionAuthority } from '../core/functions/service.functions';
import { runFunctionsConformance } from './functions.suite';

const diagnostics = { code: null, message: null, logByteSize: 0, truncated: false } as const;

describe('functions simulation conformance', () => {
  test('runs the shared core program with controlled outcomes', async () => {
    const selected = FunctionAuthority.of({
      invoke: (request) => request.functionName === 'cancel'
        ? Effect.succeed({ status: 'cancelled', output: null, failure: {
          owner: 'cancelled', code: 'FUNCTION_CANCELLED', message: 'cancelled',
        }, diagnostics })
        : Effect.succeed({ status: 'succeeded', output: { value: 2 }, diagnostics }),
    });
    const result = await Effect.runPromise(runFunctionsConformance().pipe(
      Effect.provideService(FunctionAuthority, selected),
    ));
    expect(result).toEqual({ success: { value: 2 }, cancellation: 'FUNCTION_CANCELLED' });
  });
});

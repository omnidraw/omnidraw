import { Effect } from 'effect';
import { txInvokeFunction } from '../core/functions/tx.invoke';
import type { FunctionAuthority } from '../core/functions/service.functions';

export function runFunctionsConformance(): Effect.Effect<
  Readonly<{ success: unknown; cancellation: string }>,
  unknown,
  FunctionAuthority
> {
  const request = {
    subject: { canvasId: 'canvas-1', elementId: 'element-1', widgetInstanceId: 'instance-1' },
    widgetKey: 'counter',
    catalogGeneration: 1,
    functionName: 'increment',
    input: { amount: 2 },
  } as const;
  return Effect.gen(function*() {
    const success = yield* txInvokeFunction(request);
    const cancellation = yield* txInvokeFunction({ ...request, functionName: 'cancel' });
    if (success.status !== 'succeeded' || cancellation.status !== 'cancelled') {
      return yield* Effect.die('Function authority violated result/cancellation semantics.');
    }
    return { success: success.output, cancellation: cancellation.failure.code };
  });
}

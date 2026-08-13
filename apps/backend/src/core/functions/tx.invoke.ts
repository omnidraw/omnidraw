import { Effect } from 'effect';
import {
  FunctionAuthority,
  type FunctionProgramError,
  type TFunctionInvokeRequest,
  type TFunctionInvokeResult,
} from './service.functions';

export function txInvokeFunction(
  args: TFunctionInvokeRequest,
): Effect.Effect<TFunctionInvokeResult, FunctionProgramError, FunctionAuthority> {
  return Effect.gen(function*() {
    const authority = yield* FunctionAuthority;
    return yield* authority.invoke(args);
  });
}

import { Effect } from 'effect';
import {
  FunctionAuthority,
  type FunctionProgramError,
  type TFunctionInvokeRequest,
  type TFunctionInvokeResult,
} from './service.functions';

export const txInvokeFunction = Effect.fn('txInvokeFunction')(function*(
  args: TFunctionInvokeRequest,
): Effect.fn.Return<TFunctionInvokeResult, FunctionProgramError, FunctionAuthority> {
  const authority = yield* FunctionAuthority;
  return yield* authority.invoke(args);
});

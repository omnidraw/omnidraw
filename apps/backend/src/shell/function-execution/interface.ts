/** @file Public direct-function execution seams. */

import type { IResourceGateway } from '#backend/shell/resources';
import type {
  TDirectFunctionCall,
  TDirectFunctionDefinition,
  TDirectFunctionInvocationRequest,
  TDirectFunctionResult,
  TFunctionProcessExecutionResult,
  TFunctionProcessHandle,
  TFunctionProcessStartRequest,
  TFunctionUsageMetrics,
} from './types';

export interface IDirectFunctionInvoker {
  invoke(request: TDirectFunctionInvocationRequest): Promise<TDirectFunctionResult>;
}

/** One child per call. Implementations must reap every handle on every exit. */
export interface IFunctionProcessDriver {
  readonly name: string;
  prepare(request: Readonly<{
    definition: TDirectFunctionDefinition;
    artifact: Uint8Array;
  }>): Promise<TFunctionProcessHandle>;
  start(
    prepared: TFunctionProcessHandle,
    request: TFunctionProcessStartRequest,
  ): Promise<TFunctionProcessHandle>;
  execute(
    running: TFunctionProcessHandle,
    call: TDirectFunctionCall,
    resources: IResourceGateway,
  ): Promise<TFunctionProcessExecutionResult>;
  measure(running: TFunctionProcessHandle): Promise<TFunctionUsageMetrics>;
  cancel(running: TFunctionProcessHandle, reason: string): Promise<void>;
  destroy(handle: TFunctionProcessHandle): Promise<void>;
}

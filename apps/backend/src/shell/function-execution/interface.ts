/** @file Public direct-function execution seams. */

import type { IResourceGateway } from '#backend/shell/resources';
import type {
  TDirectFunctionCall,
  TDirectFunctionDefinition,
  TDirectFunctionInvocationRequest,
  TDirectFunctionResult,
  TFunctionSandboxExecutionResult,
  TFunctionSandboxHandle,
  TFunctionSandboxStartRequest,
  TFunctionUsageMetrics,
} from './types';

export interface IDirectFunctionInvoker {
  invoke(request: TDirectFunctionInvocationRequest): Promise<TDirectFunctionResult>;
}

/** One child per call. Implementations must reap every handle on every exit. */
export interface IFunctionSandboxDriver {
  readonly name: string;
  prepare(request: Readonly<{
    definition: TDirectFunctionDefinition;
    artifact: Uint8Array;
  }>): Promise<TFunctionSandboxHandle>;
  start(
    prepared: TFunctionSandboxHandle,
    request: TFunctionSandboxStartRequest,
  ): Promise<TFunctionSandboxHandle>;
  execute(
    running: TFunctionSandboxHandle,
    call: TDirectFunctionCall,
    resources: IResourceGateway,
  ): Promise<TFunctionSandboxExecutionResult>;
  measure(running: TFunctionSandboxHandle): Promise<TFunctionUsageMetrics>;
  cancel(running: TFunctionSandboxHandle, reason: string): Promise<void>;
  destroy(handle: TFunctionSandboxHandle): Promise<void>;
}

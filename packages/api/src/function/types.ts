import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { functionContract } from './contract';

export type TFunctionInputs = InferContractRouterInputs<typeof functionContract>;
export type TFunctionOutputs = InferContractRouterOutputs<typeof functionContract>;
export type TFunctionInvocationView = TFunctionOutputs['get'];

/** API-facing controller seam; storage, scheduling, and sandbox types stay behind it. */
export interface IFunctionInvocationApiCapability {
  invokeFunction(
    tenant: TTenantContext,
    request: TFunctionInputs['invoke'],
  ): Promise<TFunctionInvocationView>;
  getFunctionInvocation(
    tenant: TTenantContext,
    invocationId: string,
  ): Promise<TFunctionInvocationView | null>;
  cancelFunctionInvocation(
    tenant: TTenantContext,
    invocationId: string,
  ): Promise<TFunctionInvocationView | null>;
}

export type TFunctionApiContext = Readonly<{
  functionInvocation: IFunctionInvocationApiCapability;
  tenant: TTenantContext;
}>;

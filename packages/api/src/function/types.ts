import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { functionContract } from './contract';

export type TFunctionInputs = InferContractRouterInputs<typeof functionContract>;
export type TFunctionOutputs = InferContractRouterOutputs<typeof functionContract>;
export type TDirectFunctionView = TFunctionOutputs['invoke'];

export interface IFunctionInvocationApiCapability {
  invokeFunction(
    request: TFunctionInputs['invoke'],
    signal?: AbortSignal,
  ): Promise<TDirectFunctionView>;
}

export type TFunctionApiContext = Readonly<{
  functionInvocation: IFunctionInvocationApiCapability;
}>;

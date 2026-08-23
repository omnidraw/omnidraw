import type { InferProcedureRouterInputs, InferProcedureRouterOutputs } from '../procedure';
import type { functionContract } from './contract';

export type TFunctionInputs = InferProcedureRouterInputs<typeof functionContract>;
export type TFunctionOutputs = InferProcedureRouterOutputs<typeof functionContract>;
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

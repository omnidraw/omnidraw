/** @file Capsule guest client primitives for generated server-function proxies. */

import {
  callCapabilityAsync,
} from '@omnidraw/capsule/guest';
import type { TWidgetCapabilitySelector } from './contracts/types';

export type { TWidgetCapabilitySelector } from './contracts/types';

export type TWidgetCapabilityCallOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type TServerFunctionClient<TInput, TOutput> = (
  input: TInput,
  options?: TWidgetCapabilityCallOptions,
) => Promise<TOutput>;

export type TServerFunctionClientOf<TFunction> = TFunction extends (
  input: infer TInput,
) => Promise<infer TOutput>
  ? TServerFunctionClient<TInput, TOutput>
  : never;

const SERVER_FUNCTION_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

function copyCapabilitySelector(
  selector: TWidgetCapabilitySelector,
): TWidgetCapabilitySelector {
  return Object.freeze({
    id: selector.id,
    versionRange: selector.versionRange,
    contractHash: selector.contractHash,
  });
}

/**
 * Creates a typed client for one operation in a revision-scoped server-function
 * capability. The trusted build supplies the exact selector; knowing it does
 * not grant authority without Capsule's request/policy/grant/binding
 * intersection.
 */
export function createServerFunctionProxy<TInput, TOutput>(
  functionName: string,
  selector: TWidgetCapabilitySelector,
): TServerFunctionClient<TInput, TOutput> {
  if (!SERVER_FUNCTION_NAME_PATTERN.test(functionName)) {
    throw new TypeError('Server-function proxy name is invalid.');
  }
  const capability = copyCapabilitySelector(selector);
  return async (
    input: TInput,
    options: TWidgetCapabilityCallOptions = {},
  ): Promise<TOutput> => await callCapabilityAsync(
    capability,
    functionName,
    input,
    options,
  ) as TOutput;
}

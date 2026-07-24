import type {
  CapsuleBudgetRequest,
  CapsuleCompleteBudgetMaximums,
} from '@omnidraw/capsule/protocol';
import type {
  TVibecanvasCapsuleBudgetRequest,
  TVibecanvasCapsuleBudgets,
} from './types';

/**
 * Copies only Capsule's public budget dimensions and preserves explicit zeroes.
 */
export function fnMapCapsuleBudgetRequest(
  budgets: TVibecanvasCapsuleBudgetRequest,
): CapsuleBudgetRequest {
  return Object.freeze({
    ...(budgets.cpuMs === undefined ? {} : { cpuMs: budgets.cpuMs }),
    ...(budgets.memoryBytes === undefined ? {} : { memoryBytes: budgets.memoryBytes }),
    ...(budgets.domNodes === undefined ? {} : { domNodes: budgets.domNodes }),
    ...(budgets.handles === undefined ? {} : { handles: budgets.handles }),
    ...(budgets.messageBytes === undefined ? {} : { messageBytes: budgets.messageBytes }),
    ...(budgets.streamBytes === undefined ? {} : { streamBytes: budgets.streamBytes }),
    ...(budgets.assetBytes === undefined ? {} : { assetBytes: budgets.assetBytes }),
    ...(budgets.networkBytes === undefined ? {} : { networkBytes: budgets.networkBytes }),
    ...(budgets.gpuBytes === undefined ? {} : { gpuBytes: budgets.gpuBytes }),
    ...(budgets.lifecycleBytes === undefined
      ? {}
      : { lifecycleBytes: budgets.lifecycleBytes }),
  });
}

/** Copies a complete product budget into Capsule's complete maximums contract. */
export function fnMapCapsuleBudgets(
  budgets: TVibecanvasCapsuleBudgets,
): CapsuleCompleteBudgetMaximums {
  return Object.freeze({
    cpuMs: budgets.cpuMs,
    memoryBytes: budgets.memoryBytes,
    domNodes: budgets.domNodes,
    handles: budgets.handles,
    messageBytes: budgets.messageBytes,
    streamBytes: budgets.streamBytes,
    assetBytes: budgets.assetBytes,
    networkBytes: budgets.networkBytes,
    gpuBytes: budgets.gpuBytes,
    lifecycleBytes: budgets.lifecycleBytes,
  });
}

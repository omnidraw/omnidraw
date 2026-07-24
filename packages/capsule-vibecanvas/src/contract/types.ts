import type {
  CapsuleBudgetRequest,
  CapsuleCompleteBudgetMaximums,
  CapsuleExecutionTarget,
} from '@omnidraw/capsule/protocol';

export type TVibecanvasCapsuleTarget = Readonly<{
  runtimeAbi: string;
  domProfile: string;
  featureProfiles: readonly string[];
}>;

export type TVibecanvasCapsuleBudgetRequest = Readonly<{
  cpuMs?: number;
  memoryBytes?: number;
  domNodes?: number;
  handles?: number;
  messageBytes?: number;
  streamBytes?: number;
  assetBytes?: number;
  networkBytes?: number;
  gpuBytes?: number;
  lifecycleBytes?: number;
}>;

export type TVibecanvasCapsuleBudgets = Readonly<{
  cpuMs: number;
  memoryBytes: number;
  domNodes: number;
  handles: number;
  messageBytes: number;
  streamBytes: number;
  assetBytes: number;
  networkBytes: number;
  gpuBytes: number;
  lifecycleBytes: number;
}>;

export type TVibecanvasCapsuleErrorPhase = 'build' | 'host' | 'runtime';

export type TVibecanvasCapsuleErrorCategory =
  | 'artifact'
  | 'budget'
  | 'build'
  | 'capability'
  | 'channel'
  | 'guest'
  | 'host'
  | 'internal'
  | 'lifecycle'
  | 'target';

export type TVibecanvasCapsuleError = Readonly<{
  format: 'vibecanvas.capsule-error.v1';
  phase: TVibecanvasCapsuleErrorPhase;
  category: TVibecanvasCapsuleErrorCategory;
  capsuleCode: string;
  fatal: boolean;
  message: string;
}>;

type TAssertTargetCompatible =
  TVibecanvasCapsuleTarget extends CapsuleExecutionTarget ? true : never;
type TAssertBudgetRequestCompatible =
  TVibecanvasCapsuleBudgetRequest extends CapsuleBudgetRequest ? true : never;
type TAssertBudgetsCompatible =
  TVibecanvasCapsuleBudgets extends CapsuleCompleteBudgetMaximums ? true : never;

export type TVibecanvasCapsuleContractCompatibility = Readonly<{
  target: TAssertTargetCompatible;
  budgetRequest: TAssertBudgetRequestCompatible;
  budgets: TAssertBudgetsCompatible;
}>;

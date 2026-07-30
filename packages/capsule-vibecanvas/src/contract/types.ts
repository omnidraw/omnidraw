import type {
  CapsuleApiContract,
  CapsuleApiGroup,
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';

export type TVibecanvasCapsuleApiGroup = CapsuleApiGroup;
export type TVibecanvasCapsuleApiContract = CapsuleApiContract;
export type TVibecanvasCapsuleBudgetRequest = CapsuleBudgetRequest;

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
  capability?: string;
  operation?: string;
}>;

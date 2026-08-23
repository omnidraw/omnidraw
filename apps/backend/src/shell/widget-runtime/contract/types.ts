import type {
  CapsuleApiContract,
  CapsuleApiGroup,
  CapsuleBudgetRequest,
} from '@omnidraw/capsule/protocol';

export type TOmnidrawCapsuleApiGroup = CapsuleApiGroup;
export type TOmnidrawCapsuleApiContract = CapsuleApiContract;
export type TOmnidrawCapsuleBudgetRequest = CapsuleBudgetRequest;

export type TOmnidrawCapsuleErrorPhase = 'build' | 'host' | 'runtime';

export type TOmnidrawCapsuleErrorCategory =
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

export type TOmnidrawCapsuleError = Readonly<{
  format: 'omnidraw.capsule-error.v1';
  phase: TOmnidrawCapsuleErrorPhase;
  category: TOmnidrawCapsuleErrorCategory;
  capsuleCode: string;
  fatal: boolean;
  message: string;
  capability?: string;
  operation?: string;
  file?: `widget://${string}`;
  line?: number;
  column?: number;
}>;

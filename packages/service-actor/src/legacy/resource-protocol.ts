/**
 * @file Legacy actor guest-to-host resource protocol.
 * @remarks Resource ownership and provider implementations live in the neutral resource runtime.
 */

import type {
  TActorResourceKind,
  TActorResourceRequirement,
  TActorResourceScope,
} from '../core/types';

export type TActorResourceFunctionClass = 'fn' | 'fx' | 'tx';

export type TActorResourceCall = Readonly<{
  actorId: string;
  definitionName: string;
  runId: number;
  functionClass: TActorResourceFunctionClass;
  slot: string;
  kind: TActorResourceKind;
  operation: string;
  args: unknown;
}>;

export type TActorResourceGateway = (call: TActorResourceCall) => Promise<unknown>;

export type TActorResourceDirectBinding = Readonly<{
  resourceId: string;
  requirement: TActorResourceRequirement;
  scope: TActorResourceScope;
}>;

export type TActorStartAdmission = Readonly<{
  allowed: boolean;
  hadBlocks: boolean;
  shouldRestart: boolean;
  resolvedBlockResourceIds: readonly string[];
  code: string | null;
  message: string | null;
}>;

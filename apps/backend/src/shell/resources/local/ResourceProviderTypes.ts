/**
 * @file Structural local-provider contracts independent of consumer and transport packages.
 */
import type {
  TResourceErrorCode,
  TResourceKind,
  TResourcePermission,
  TResourceRequirement,
  TResourceStatus,
} from '#backend/core/resources/types';

export type TLocalResource = Readonly<{
  id: string;
  kind: TResourceKind;
  name?: string;
  status?: TResourceStatus;
  lastError?: unknown;
  createdAtSec?: string;
  updatedAtSec?: string;
}>;

export type TLocalResourceRequirement = Readonly<
  Pick<TResourceRequirement, 'kind' | 'required' | 'arbitrarySql' | 'operations'>
  & { scope?: readonly TResourcePermission[] }
>;

export type TLocalResolvedResourceCall = Readonly<{
  resource: TLocalResource;
  requirement: TLocalResourceRequirement;
  binding?: Readonly<{
    allowRead: boolean;
    allowWrite: boolean;
  }>;
  functionClass?: 'fn' | 'fx' | 'tx';
  slot?: string;
  canRead?: boolean;
  canWrite?: boolean;
}>;

/** Injectable timer edge used to make idle-handle expiry deterministic in tests. */
export type TResourceIdleSweepScheduler = (
  callback: () => void | Promise<void>,
  delayMs: number,
) => () => void;

export type TLocalResourceReconcileResult =
  | Readonly<{ status: 'ready' }>
  | Readonly<{
    status: 'error';
    lastError: Readonly<{ code: TResourceErrorCode; message: string }>;
  }>;

export interface ILocalResourceProvider {
  readonly kind: TResourceKind;
  readonly reconcileReady?: boolean;
  provision(resource: TLocalResource, args: unknown): Promise<void>;
  delete(resource: TLocalResource): Promise<void>;
  reconcile?(resource: TLocalResource): Promise<TLocalResourceReconcileResult>;
  close?(): Promise<void>;
  effect(operation: string, requirement: TLocalResourceRequirement, args: unknown): 'read' | 'write' | null;
  dispatch(context: TLocalResolvedResourceCall, operation: string, args: unknown): Promise<unknown>;
}

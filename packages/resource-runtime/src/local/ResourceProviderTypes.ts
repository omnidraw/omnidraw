/**
 * @file Structural local-provider contracts independent of consumer and transport packages.
 */
import type {
  TResourceErrorCode,
  TResourceKind,
  TResourceStatus,
} from '../types';
import type { TTenantContext } from '@vibecanvas/tenant-core';

export type TLocalResource = Readonly<{
  id: string;
  kind: TResourceKind;
  name?: string;
  status?: TResourceStatus;
  last_error?: unknown;
  created_at?: string;
  updated_at?: string;
}>;

export type TLocalResourceRequirement = Readonly<{
  kind: TResourceKind;
  required?: boolean;
  scope?: readonly ('read' | 'write')[];
  arbitrarySql?: boolean;
  operations?: Readonly<Record<string, Readonly<{
    effect: 'read' | 'write';
    sql: string;
    parameters?: Readonly<Record<string, Readonly<{
      type: 'string' | 'number' | 'boolean' | 'bigint' | 'bytes' | 'json';
      required?: boolean;
      nullable?: boolean;
    }>>>;
    result: 'rows' | 'execute';
  }>>>;
}>;

export type TLocalResolvedResourceCall = Readonly<{
  /** Present for calls admitted by ResourceStoreService; legacy local managers may omit it. */
  tenant?: TTenantContext;
  resource: TLocalResource;
  requirement: TLocalResourceRequirement;
  binding?: Readonly<{
    allow_read: boolean;
    allow_write: boolean;
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

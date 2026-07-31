import type { Database } from '@tursodatabase/database';
import type {
  IFunctionInvocationApiCapability,
  TFunctionInputs,
  TFunctionInvocationView,
} from '@omnidraw/api/function';
import type {
  IFunctionControlStore,
  TInvocationCreateResult,
  TInvocationRecord,
} from '@omnidraw/function-runtime';
import type { IService, IStartableService, IStoppableService } from '@omnidraw/runtime';
import type { IServiceContext } from '@omnidraw/runtime/interface.ts';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { LocalFunctionDispatcher } from '@omnidraw/function-runtime/local';
import {
  FUNCTION_IDEMPOTENCY_TTL_DEFAULT_MS,
  FUNCTION_IDEMPOTENCY_TTL_MAXIMUM_MS,
  FUNCTION_IDEMPOTENCY_TTL_MINIMUM_MS,
} from './CONSTANTS';

type TFunctionServicePlacement = Readonly<Pick<
  TTenantContext,
  'orgId' | 'cellId' | 'placementEpoch'
>>;

type TFunctionServiceConfig = Readonly<{
  placement: TFunctionServicePlacement;
  database: Database;
  store: IFunctionControlStore;
  dispatcher: LocalFunctionDispatcher;
  idempotencyTtlMs?: number;
  nowMs?: () => number;
}>;

type TWidgetInvocationTargetRow = Readonly<{
  canvas_id: string;
  definition_id: string;
  revision_id: string;
  status: string;
  subject_kind: 'widget_instance' | 'widget_preview';
}>;

function functionServiceError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function invocationView(record: TInvocationRecord): TFunctionInvocationView {
  return {
    id: record.envelope.id,
    functionName: record.envelope.functionName,
    widgetRevisionId: record.envelope.widgetRevisionId,
    widgetInstanceId: record.envelope.subject.widgetInstanceId,
    status: record.status,
    output: record.output,
    failure: record.failure,
    createdAtMs: record.envelope.createdAtMs,
    startedAtMs: record.startedAtMs,
    finishedAtMs: record.finishedAtMs,
  };
}

/** Placement-owned API controller for durable, short-lived server functions. */
class FunctionService implements
  IService,
  IStartableService<object, object>,
  IStoppableService,
  IFunctionInvocationApiCapability {
  readonly name = 'function-service';
  readonly #placement: TFunctionServicePlacement;
  readonly #database: Database;
  readonly #store: IFunctionControlStore;
  readonly #dispatcher: LocalFunctionDispatcher;
  readonly #idempotencyTtlMs: number;
  readonly #nowMs: () => number;
  #started = false;

  constructor(config: TFunctionServiceConfig) {
    this.#placement = Object.freeze({ ...config.placement });
    this.#database = config.database;
    this.#store = config.store;
    this.#dispatcher = config.dispatcher;
    this.#idempotencyTtlMs = config.idempotencyTtlMs ?? FUNCTION_IDEMPOTENCY_TTL_DEFAULT_MS;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    if (
      !Number.isInteger(this.#idempotencyTtlMs)
      || this.#idempotencyTtlMs < FUNCTION_IDEMPOTENCY_TTL_MINIMUM_MS
      || this.#idempotencyTtlMs > FUNCTION_IDEMPOTENCY_TTL_MAXIMUM_MS
    ) {
      throw new RangeError('Function idempotency TTL is outside its host bound.');
    }
  }

  async start(_context: IServiceContext<object, object>): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await this.#dispatcher.start();
    } catch (error) {
      this.#started = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await this.#dispatcher.stop();
  }

  async invokeFunction(
    tenant: TTenantContext,
    request: TFunctionInputs['invoke'],
  ): Promise<TFunctionInvocationView> {
    this.#assertPlacement(tenant);
    this.#assertStarted();
    const target = await this.#resolveTarget(
      tenant,
      request.widgetInstanceId,
      request.widgetRevisionId,
    );
    let result: TInvocationCreateResult;
    try {
      result = await this.#dispatcher.invoke(tenant, {
        widgetDefinitionId: target.definition_id,
        widgetRevisionId: target.revision_id,
        subject: {
          kind: target.subject_kind,
          canvasId: target.canvas_id,
          widgetInstanceId: request.widgetInstanceId,
        },
        functionName: request.functionName,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
        idempotencyScope: target.subject_kind === 'widget_preview'
          ? {
              kind: 'widget_preview',
              previewId: request.widgetInstanceId,
            }
          : {
              kind: 'widget_instance',
              widgetInstanceId: request.widgetInstanceId,
            },
        idempotencyExpiresAtMs: this.#nowMs() + this.#idempotencyTtlMs,
      });
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
      if (code === 'FUNCTION_PLACEMENT_STALE') {
        throw functionServiceError('FUNCTION_RUNTIME_UNAVAILABLE', 'Function runtime is unavailable.');
      }
      if (code === 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND') {
        throw functionServiceError('WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
      }
      if (code === 'FUNCTION_INPUT_NOT_JSON' || code === 'FUNCTION_IDEMPOTENCY_KEY_INVALID') {
        throw functionServiceError('FUNCTION_INPUT_INVALID', 'Function input is invalid.');
      }
      throw error;
    }
    if (result.status === 'conflict') {
      throw functionServiceError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key conflicts with an existing invocation.',
      );
    }
    return invocationView(result.invocation);
  }

  async getFunctionInvocation(
    tenant: TTenantContext,
    invocationId: string,
  ): Promise<TFunctionInvocationView | null> {
    this.#assertPlacement(tenant);
    this.#assertStarted();
    const record = await this.#store.getInvocation(tenant, invocationId);
    if (
      record === null
      || record.envelope.tenant.accountId !== tenant.accountId
      || !await this.#hasCanvasAuthority(
      tenant,
      record.envelope.tenant.canvasId,
      )
    ) {
      return null;
    }
    return invocationView(record);
  }

  async cancelFunctionInvocation(
    tenant: TTenantContext,
    invocationId: string,
  ): Promise<TFunctionInvocationView | null> {
    this.#assertPlacement(tenant);
    this.#assertStarted();
    const current = await this.#store.getInvocation(tenant, invocationId);
    if (
      current === null
      || current.envelope.tenant.accountId !== tenant.accountId
      || !await this.#hasCanvasAuthority(
      tenant,
      current.envelope.tenant.canvasId,
      )
    ) {
      return null;
    }
    const result = await this.#store.requestCancellation(tenant, {
      invocationId,
      nowMs: this.#nowMs(),
    });
    return result.status === 'missing' ? null : invocationView(result.invocation);
  }

  async #resolveTarget(
    tenant: TTenantContext,
    widgetInstanceId: string,
    widgetRevisionId: string,
  ): Promise<TWidgetInvocationTargetRow> {
    const nowMs = this.#nowMs();
    const published = await (await this.#database.prepare(`
      SELECT instance.canvas_id, instance.definition_id, instance.revision_id,
        instance.status, 'widget_instance' AS subject_kind
      FROM widget_instances AS instance
      INNER JOIN canvas_members AS member
        ON member.org_id = instance.org_id
        AND member.canvas_id = instance.canvas_id
        AND member.account_id = ?
      WHERE instance.org_id = ? AND instance.id = ? AND instance.revision_id = ?
      LIMIT 1
    `)).get(
      tenant.accountId,
      tenant.orgId,
      widgetInstanceId,
      widgetRevisionId,
    ) as TWidgetInvocationTargetRow | null | undefined;
    const row = published ?? await (await this.#database.prepare(`
      SELECT owner.canvas_id, revision.definition_id,
        revision.id AS revision_id, owner.status,
        'widget_preview' AS subject_kind
      FROM agent_previews AS owner
      INNER JOIN agent_preview_revisions AS revision
        ON revision.org_id = owner.org_id
        AND revision.preview_id = owner.id
        AND revision.id = ?
      INNER JOIN canvas_members AS member
        ON member.org_id = owner.org_id
        AND member.canvas_id = owner.canvas_id
        AND member.account_id = ?
      WHERE owner.org_id = ?
        AND owner.account_id = ?
        AND owner.id = ?
        AND owner.status <> 'closed'
        AND (
          owner.active_revision_id = revision.id
          OR EXISTS (
            SELECT 1
            FROM agent_preview_mount_leases AS lease
            WHERE lease.org_id = revision.org_id
              AND lease.account_id = owner.account_id
              AND lease.preview_id = revision.preview_id
              AND lease.preview_revision_id = revision.id
              AND lease.canvas_id = owner.canvas_id
              AND lease.frame_node_id = owner.frame_node_id
              AND lease.expires_at_ms > ?
          )
        )
      LIMIT 1
    `)).get(
      widgetRevisionId,
      tenant.accountId,
      tenant.orgId,
      tenant.accountId,
      widgetInstanceId,
      nowMs,
    ) as TWidgetInvocationTargetRow | null | undefined;
    if (!row) {
      throw functionServiceError('WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
    }
    if (tenant.canvasId !== undefined && tenant.canvasId !== row.canvas_id) {
      throw functionServiceError('WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
    }
    if (row.subject_kind === 'widget_instance' && row.status !== 'active') {
      throw functionServiceError('WIDGET_INSTANCE_ARCHIVED', 'Widget instance is not active.');
    }
    return row;
  }

  async #hasCanvasAuthority(
    tenant: TTenantContext,
    canvasId: string | undefined,
  ): Promise<boolean> {
    if (
      canvasId === undefined
      || (tenant.canvasId !== undefined && tenant.canvasId !== canvasId)
    ) {
      return false;
    }
    const membership = await (await this.#database.prepare(`
      SELECT 1
      FROM canvas_members
      WHERE org_id = ? AND canvas_id = ? AND account_id = ?
      LIMIT 1
    `)).get(tenant.orgId, canvasId, tenant.accountId);
    return membership != null;
  }

  #assertPlacement(tenant: TTenantContext): void {
    if (
      tenant.orgId !== this.#placement.orgId
      || tenant.cellId !== this.#placement.cellId
      || tenant.placementEpoch !== this.#placement.placementEpoch
    ) {
      throw functionServiceError('FUNCTION_RUNTIME_UNAVAILABLE', 'Function runtime placement is stale.');
    }
  }

  #assertStarted(): void {
    if (!this.#started) {
      throw functionServiceError('FUNCTION_RUNTIME_UNAVAILABLE', 'Function runtime is not running.');
    }
  }
}

export { FunctionService };
export type {
  TFunctionServiceConfig,
  TFunctionServicePlacement,
};

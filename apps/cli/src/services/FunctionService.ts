import type { Database } from '@tursodatabase/database';
import type {
  IFunctionInvocationApiCapability,
  TFunctionInputs,
  TFunctionInvocationView,
} from '@vibecanvas/api/function';
import type {
  IFunctionControlStore,
  TFunctionInvocationSubject,
  TInvocationCreateResult,
  TInvocationRecord,
} from '@vibecanvas/function-runtime';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { LocalFunctionDispatcher } from '@vibecanvas/function-runtime/local';
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
}>;

type TPreviewFunctionInvocationRequest = Readonly<{
  previewId: string;
  previewRevisionId: string;
  widgetDefinitionId: string;
  functionName: string;
  input: unknown;
  idempotencyKey: string;
}>;

type TPreviewFunctionInvocationLookup = Readonly<{
  invocationId: string;
  previewId: string;
  previewRevisionId: string;
}>;

type TPreviewFunctionInvocationView = Readonly<{
  id: string;
  functionName: string;
  widgetRevisionId: string;
  subject: Extract<TFunctionInvocationSubject, { kind: 'agent_preview' }>;
  status: TInvocationRecord['status'];
  output: unknown | null;
  failure: TInvocationRecord['failure'];
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}>;

type TPreviewFunctionInvocationCapability = Readonly<{
  invokePreviewFunction(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationRequest,
  ): Promise<TPreviewFunctionInvocationView>;
  getPreviewFunctionInvocation(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationLookup,
  ): Promise<TPreviewFunctionInvocationView | null>;
  cancelPreviewFunctionInvocation(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationLookup,
  ): Promise<TPreviewFunctionInvocationView | null>;
}>;

function functionServiceError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function invocationView(record: TInvocationRecord): TFunctionInvocationView {
  if (record.envelope.subject.kind !== 'widget_instance') {
    throw new TypeError('A preview invocation cannot be exposed through the public function API.');
  }
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

function previewInvocationView(record: TInvocationRecord): TPreviewFunctionInvocationView {
  if (record.envelope.subject.kind !== 'agent_preview') {
    throw new TypeError('A widget-instance invocation cannot be exposed through the preview API.');
  }
  return {
    id: record.envelope.id,
    functionName: record.envelope.functionName,
    widgetRevisionId: record.envelope.widgetRevisionId,
    subject: record.envelope.subject,
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
  IFunctionInvocationApiCapability,
  TPreviewFunctionInvocationCapability {
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
    const target = await this.#resolveTarget(tenant, request.widgetInstanceId);
    let result: TInvocationCreateResult;
    try {
      result = await this.#dispatcher.invoke(tenant, {
        widgetDefinitionId: target.definition_id,
        widgetRevisionId: target.revision_id,
        subject: {
          kind: 'widget_instance',
          canvasId: target.canvas_id,
          widgetInstanceId: request.widgetInstanceId,
        },
        functionName: request.functionName,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
        idempotencyScope: {
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

  async invokePreviewFunction(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationRequest,
  ): Promise<TPreviewFunctionInvocationView> {
    this.#assertPlacement(tenant);
    this.#assertStarted();
    let result: TInvocationCreateResult;
    try {
      result = await this.#dispatcher.invoke(tenant, {
        widgetDefinitionId: request.widgetDefinitionId,
        widgetRevisionId: request.previewRevisionId,
        subject: {
          kind: 'agent_preview',
          previewId: request.previewId,
          previewRevisionId: request.previewRevisionId,
        },
        functionName: request.functionName,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
        idempotencyScope: {
          kind: 'agent_preview',
          previewId: request.previewId,
          previewRevisionId: request.previewRevisionId,
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
      if (code === 'FUNCTION_NOT_FOUND') {
        throw functionServiceError('PREVIEW_FUNCTION_NOT_FOUND', 'Preview function was not found.');
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
    return previewInvocationView(result.invocation);
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
      || record.envelope.subject.kind !== 'widget_instance'
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
      || current.envelope.subject.kind !== 'widget_instance'
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

  async getPreviewFunctionInvocation(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationLookup,
  ): Promise<TPreviewFunctionInvocationView | null> {
    this.#assertPlacement(tenant);
    this.#assertStarted();
    const record = await this.#store.getInvocation(tenant, request.invocationId);
    return this.#isOwnedPreviewInvocation(tenant, request, record)
      ? previewInvocationView(record)
      : null;
  }

  async cancelPreviewFunctionInvocation(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationLookup,
  ): Promise<TPreviewFunctionInvocationView | null> {
    this.#assertPlacement(tenant);
    this.#assertStarted();
    const current = await this.#store.getInvocation(tenant, request.invocationId);
    if (!this.#isOwnedPreviewInvocation(tenant, request, current)) return null;
    const result = await this.#store.requestCancellation(tenant, {
      invocationId: request.invocationId,
      nowMs: this.#nowMs(),
    });
    return result.status === 'missing' ? null : previewInvocationView(result.invocation);
  }

  #isOwnedPreviewInvocation(
    tenant: TTenantContext,
    request: TPreviewFunctionInvocationLookup,
    record: TInvocationRecord | null,
  ): record is TInvocationRecord & Readonly<{
    envelope: TInvocationRecord['envelope'] & Readonly<{
      subject: Extract<TFunctionInvocationSubject, { kind: 'agent_preview' }>;
    }>;
  }> {
    return record !== null
      && record.envelope.tenant.accountId === tenant.accountId
      && record.envelope.subject.kind === 'agent_preview'
      && record.envelope.subject.previewId === request.previewId
      && record.envelope.subject.previewRevisionId === request.previewRevisionId;
  }

  async #resolveTarget(
    tenant: TTenantContext,
    widgetInstanceId: string,
  ): Promise<TWidgetInvocationTargetRow> {
    const row = await (await this.#database.prepare(`
      SELECT instance.canvas_id, instance.definition_id, instance.revision_id, instance.status
      FROM widget_instances AS instance
      INNER JOIN canvas_members AS member
        ON member.org_id = instance.org_id
        AND member.canvas_id = instance.canvas_id
        AND member.account_id = ?
      INNER JOIN collaboration_documents AS canvas_document
        ON canvas_document.org_id = instance.org_id
        AND canvas_document.canvas_id = instance.canvas_id
        AND canvas_document.widget_instance_id IS NULL
      INNER JOIN widget_instance_projection_heads AS projection_head
        ON projection_head.org_id = canvas_document.org_id
        AND projection_head.canvas_id = canvas_document.canvas_id
        AND projection_head.source_sequence = canvas_document.content_version
      WHERE instance.org_id = ? AND instance.id = ?
      LIMIT 1
    `)).get(
      tenant.accountId,
      tenant.orgId,
      widgetInstanceId,
    ) as TWidgetInvocationTargetRow | null | undefined;
    if (!row) {
      throw functionServiceError('WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
    }
    if (tenant.canvasId !== undefined && tenant.canvasId !== row.canvas_id) {
      throw functionServiceError('WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
    }
    if (row.status !== 'active') {
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
  TPreviewFunctionInvocationCapability,
  TPreviewFunctionInvocationLookup,
  TPreviewFunctionInvocationRequest,
  TPreviewFunctionInvocationView,
};

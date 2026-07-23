import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Database as TDatabase } from '@tursodatabase/database';
import type {
  TFunctionInvocationEnvelope,
  TInvocationCreateRequest,
  TUsageMetrics,
} from '@vibecanvas/function-runtime';
import { FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS } from '@vibecanvas/function-runtime';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import type { TWidgetServerFunctionDescriptor } from '@vibecanvas/widget-contract';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '../CONSTANTS';
import { Database } from '../DbServiceTurso/turso-native';
import { FunctionControlStoreTurso } from '../FunctionControlStoreTurso';
import { fnFunctionCanonicalJson } from '../FunctionControlStoreTurso/fn.function-json';
import { fnFunctionId } from '../FunctionControlStoreTurso/fn.function-id';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const CANVAS_ID = uuid(700);
const CANVAS_DOCUMENT_ID = uuid(707);
const DEFINITION_ID = uuid(701);
const REVISION_ID = uuid(702);
const UI_ARTIFACT_ID = uuid(703);
const SERVER_ARTIFACT_ID = uuid(704);
const WIDGET_INSTANCE_ID = uuid(705);
const RESOURCE_ID = uuid(706);
const CONTRACT_DIGEST = sha256('contract');
const UI_DIGEST = sha256('ui');
const SERVER_DIGEST = sha256('server');
const OPERATION_FINGERPRINT = sha256('operation');
const CELL_ID = 'function-test-cell';
const FUNCTION_NAME = 'updatePreferences';
const FUNCTION_ID = fnFunctionId(DEFINITION_ID, FUNCTION_NAME);
const OTHER_ACCOUNT_ID = uuid(799);
const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: CELL_ID,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'function-control-test',
  canvasId: CANVAS_ID,
});

const OTHER_MEMBER_TENANT = fnFreezeTenantContext({
  ...TENANT,
  accountId: OTHER_ACCOUNT_ID,
  requestId: 'function-control-other-member',
});

const DESCRIPTOR: TWidgetServerFunctionDescriptor = fnNormalizeWidgetServerFunctionDescriptor({
  schemaVersion: 1,
  exportName: FUNCTION_NAME,
  modulePath: 'server/index.ts',
  effect: 'tx',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  resources: [{ slot: 'preferences', effect: 'write' }],
  limits: {
    timeoutMs: 1_000,
    memoryTier: 'small',
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  },
  retry: {
    mode: 'idempotent',
    maxAttempts: 3,
    initialBackoffMs: 10,
    maxBackoffMs: 100,
  },
});

const ZERO_METRICS: TUsageMetrics = {
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
};

async function openDatabase(databasePath = ':memory:', migrate = true): Promise<TDatabase> {
  const database = new Database(databasePath, {
    experimental: ([
      'custom_types',
      'triggers',
      'index_method',
      ...(databasePath === ':memory:' ? [] : ['multiprocess_wal']),
    ] as never),
  });
  await database.connect();
  if (migrate) {
    for (const migration of [
      '000-initial.sql',
      '001-widget-revision-sequence.sql',
      '002-function-runtime.sql',
      '003-widget-instance-projection.sql',
      '004-agent-authoring.sql',
    ]) {
      await database.exec(await Bun.file(new URL(`../migrations/${migration}`, import.meta.url)).text());
    }
  }
  return database;
}

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectPromise(error);
      },
    );
  });
}

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error('Crash worker exited before its claim checkpoint.');
      value += decoder.decode(next.value, { stream: true });
      const newline = value.indexOf('\n');
      if (newline >= 0) return value.slice(0, newline);
    }
  } finally {
    reader.releaseLock();
  }
}

async function seedControlPlane(database: TDatabase): Promise<void> {
  const canonicalDescriptors = fnCanonicalizeWidgetServerFunctionDescriptors([DESCRIPTOR]);
  const manifestJson = fnFunctionCanonicalJson({
    schemaVersion: 2,
    name: 'Preferences',
    slug: 'preferences',
    ui: { entry: 'ui.js' },
    server: { entry: 'server.js', runtimeAbi: 'vibecanvas:1' },
    resources: [{ slot: 'preferences', kind: 'kv', effect: 'write', required: true }],
  });
  await (await database.prepare(`
    INSERT INTO canvases (
      org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'Function canvas', 'org', ?, 1, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, CANVAS_ID, DEFAULT_OSS_ACCOUNT_ID);
  await (await database.prepare(`
    INSERT INTO canvas_members (
      org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 'owner', 1, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, CANVAS_ID, DEFAULT_OSS_ACCOUNT_ID);
  await (await database.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url, partition_key,
      created_at_ms, updated_at_ms, content_version
    ) VALUES (?, ?, ?, NULL, 'automerge:function-control-canvas', 'function-control', 1, 1, 0)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, CANVAS_DOCUMENT_ID, CANVAS_ID);
  await (await database.prepare(`
    INSERT INTO widget_instance_projection_heads (
      org_id, canvas_id, source_sequence, snapshot_digest_sha256, projected_at_ms
    ) VALUES (?, ?, 0, ?, 1)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, CANVAS_ID, sha256('function-control-canvas'));
  await (await database.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size, retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
      (?, ?, 'server', ?, 20, 'pinned', NULL, 1)
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    UI_ARTIFACT_ID,
    UI_DIGEST,
    DEFAULT_OSS_ORGANIZATION_ID,
    SERVER_ARTIFACT_ID,
    SERVER_DIGEST,
  );
  await (await database.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id,
      created_at_ms, updated_at_ms, next_revision_number
    ) VALUES (?, ?, 'preferences', 'Preferences', 'draft', NULL, 1, 1, 2)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, DEFINITION_ID);
  await (await database.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number, ui_artifact_id, ui_artifact_kind,
      server_artifact_id, server_artifact_kind, manifest_json, contract_digest_sha256,
      created_at_ms, function_descriptors_json, function_descriptors_digest_sha256,
      contract_format_version
    ) VALUES (?, ?, ?, 1, ?, 'ui', ?, 'server', ?, ?, 2, ?, ?, 2)
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    REVISION_ID,
    DEFINITION_ID,
    UI_ARTIFACT_ID,
    SERVER_ARTIFACT_ID,
    manifestJson,
    CONTRACT_DIGEST,
    canonicalDescriptors,
    sha256(canonicalDescriptors),
  );
  await (await database.prepare(`
    INSERT INTO function_definitions (
      org_id, id, widget_definition_id, widget_revision_id, export_name, effect,
      definition_revision, server_artifact_id, server_artifact_kind,
      artifact_digest_sha256, contract_digest_sha256, descriptor_digest_sha256,
      runtime_abi, input_schema_json, output_schema_json, resources_json,
      timeout_ms, memory_tier, output_byte_limit, log_byte_limit, retry_mode,
      max_attempts, initial_backoff_ms, max_backoff_ms, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, 'tx', 1, ?, 'server', ?, ?, ?, 'vibecanvas:1',
      ?, ?, ?, 1000, 'small', 1024, 1024, 'idempotent', 3, 10, 100, 2)
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    FUNCTION_ID,
    DEFINITION_ID,
    REVISION_ID,
    FUNCTION_NAME,
    SERVER_ARTIFACT_ID,
    SERVER_DIGEST,
    CONTRACT_DIGEST,
    sha256(fnFunctionCanonicalJson(DESCRIPTOR)),
    fnFunctionCanonicalJson(DESCRIPTOR.inputSchema),
    fnFunctionCanonicalJson(DESCRIPTOR.outputSchema),
    fnFunctionCanonicalJson(DESCRIPTOR.resources),
  );
  await (await database.prepare(`
    INSERT INTO widget_instances (
      org_id, id, canvas_id, element_id, definition_id, revision_id,
      status, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 'preferences-widget', ?, ?, 'active', 3, 3)
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    WIDGET_INSTANCE_ID,
    CANVAS_ID,
    DEFINITION_ID,
    REVISION_ID,
  );
  await (await database.prepare(`
    INSERT INTO resource_catalog (
      org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'kv', 'Preferences store', 'ready', NULL, 3, 3)
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, RESOURCE_ID);
}

async function cloneInvocationRow(
  database: TDatabase,
  source: Readonly<{ orgId: string; invocationId: string }>,
  overrides: Readonly<Record<string, unknown>>,
): Promise<void> {
  const row = await (await database.prepare(`
    SELECT * FROM function_invocations WHERE org_id = ? AND id = ?
  `)).get(source.orgId, source.invocationId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Source invocation row was not found.');
  const cloned = { ...row, ...overrides };
  const columns = Object.keys(cloned);
  await (await database.prepare(`
    INSERT INTO function_invocations (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `)).run(...columns.map((column) => cloned[column]));
}

function envelope(id: string, input: unknown, key = `key-${id}`): TFunctionInvocationEnvelope {
  return {
    id,
    tenant: TENANT,
    widgetDefinitionId: DEFINITION_ID,
    widgetRevisionId: REVISION_ID,
    subject: {
      kind: 'widget_instance',
      canvasId: CANVAS_ID,
      widgetInstanceId: WIDGET_INSTANCE_ID,
    },
    functionId: FUNCTION_ID,
    functionName: FUNCTION_NAME,
    definitionRevision: 1,
    artifactDigestSha256: SERVER_DIGEST,
    contractDigestSha256: CONTRACT_DIGEST,
    runtimeAbi: 'vibecanvas:1',
    input,
    inputDigestSha256: sha256(fnFunctionCanonicalJson(input)),
    idempotencyKey: key,
    policyVersion: 1,
    priority: 10,
    limits: DESCRIPTOR.limits,
    retry: DESCRIPTOR.retry,
    createdAtMs: 100,
    deadlineAtMs: 1_100,
  };
}

function createRequest(
  id: string,
  input: unknown,
  options: Readonly<{ key?: string; fingerprint?: string; expiresAtMs?: number | null }> = {},
): TInvocationCreateRequest {
  const value = envelope(id, input, options.key);
  return {
    envelope: value,
    idempotencyRecordId: uuid(Number(id.slice(-4)) + 2_000),
    idempotencyScope: { kind: 'widget_instance', widgetInstanceId: WIDGET_INSTANCE_ID },
    requestFingerprintSha256: options.fingerprint ?? sha256(fnFunctionCanonicalJson(input)),
    idempotencyExpiresAtMs: options.expiresAtMs === undefined ? 2_000 : options.expiresAtMs,
  };
}

describe('FunctionControlStoreTurso', () => {
  let database: TDatabase;
  let nowMs: number;
  let store: FunctionControlStoreTurso;

  beforeEach(async () => {
    database = await openDatabase();
    await seedControlPlane(database);
    nowMs = 100;
    store = new FunctionControlStoreTurso(database, { nowMs: () => nowMs });
  });

  afterEach(async () => {
    await database.close();
  });

  test('registers only the immutable publication descriptor set', async () => {
    await expect(store.registerFunctionsForRevision(TENANT, {
      widgetDefinitionId: DEFINITION_ID,
      widgetRevisionId: REVISION_ID,
      definitionRevision: 1,
      serverArtifactId: SERVER_ARTIFACT_ID,
      artifactDigestSha256: SERVER_DIGEST,
      contractDigestSha256: CONTRACT_DIGEST,
      runtimeAbi: 'vibecanvas:1',
      functions: [DESCRIPTOR],
      createdAtMs: 2,
    })).resolves.toEqual([
      expect.objectContaining({ id: FUNCTION_ID, name: FUNCTION_NAME, effect: 'tx' }),
    ]);
    await expect(store.registerFunctionsForRevision(TENANT, {
      widgetDefinitionId: DEFINITION_ID,
      widgetRevisionId: REVISION_ID,
      definitionRevision: 1,
      serverArtifactId: SERVER_ARTIFACT_ID,
      artifactDigestSha256: SERVER_DIGEST,
      contractDigestSha256: CONTRACT_DIGEST,
      runtimeAbi: 'vibecanvas:1',
      functions: [{ ...DESCRIPTOR, limits: { ...DESCRIPTOR.limits, timeoutMs: 999 } }],
      createdAtMs: 2,
    })).rejects.toMatchObject({ code: 'FUNCTION_REVISION_REGISTRATION_CONFLICT' });
  });

  test('atomically creates, replays, and conflicts for scalar JSON inputs', async () => {
    const invocationId = uuid(710);
    const request = createRequest(invocationId, 42, { key: 'same-key' });
    await expect(store.createOrReplayInvocation(TENANT, request)).resolves.toMatchObject({
      status: 'created',
      invocation: { envelope: { input: 42 } },
    });
    await expect(store.createOrReplayInvocation(TENANT, {
      ...request,
      envelope: { ...request.envelope, id: uuid(711) },
      idempotencyRecordId: uuid(2711),
    })).resolves.toMatchObject({ status: 'replayed', invocation: { envelope: { id: invocationId } } });
    await expect(store.createOrReplayInvocation(TENANT, {
      ...request,
      envelope: { ...request.envelope, id: uuid(712) },
      idempotencyRecordId: uuid(2712),
      requestFingerprintSha256: sha256('different'),
    })).resolves.toEqual({
      status: 'conflict',
      invocationId,
      reason: 'fingerprint_mismatch',
    });
  });

  test('rejects missing or mismatched live publication targets before snapshot insertion', async () => {
    const badInput = createRequest(uuid(712), { signed: false });
    await expect(store.createOrReplayInvocation(TENANT, {
      ...badInput,
      envelope: { ...badInput.envelope, input: { signed: true } },
    })).rejects.toMatchObject({ code: 'FUNCTION_INPUT_DIGEST_MISMATCH' });
    const missingFunction = createRequest(uuid(713), { invalid: 'function' });
    await expect(store.createOrReplayInvocation(TENANT, {
      ...missingFunction,
      envelope: { ...missingFunction.envelope, functionId: 'fn:missing' },
    })).rejects.toMatchObject({ code: 'FUNCTION_INVOCATION_AUTHORITY_MISMATCH' });
    const missingInstance = createRequest(uuid(714), { invalid: 'instance' });
    await expect(store.createOrReplayInvocation(TENANT, {
      ...missingInstance,
      envelope: {
        ...missingInstance.envelope,
        subject: {
          kind: 'widget_instance',
          canvasId: CANVAS_ID,
          widgetInstanceId: uuid(999),
        },
      },
    })).rejects.toMatchObject({ code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND' });
    await (await database.prepare(`
      UPDATE widget_instances
      SET status = 'archived', updated_at_ms = 4
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, WIDGET_INSTANCE_ID);
    const archivedInstance = createRequest(uuid(1714), { invalid: 'archived-instance' });
    await expect(store.createOrReplayInvocation(TENANT, archivedInstance))
      .rejects.toMatchObject({ code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND' });
    expect(await (await database.prepare(`
      SELECT count(*) AS count FROM function_invocations WHERE org_id = ?
    `)).get(TENANT.orgId)).toEqual({ count: 0 });
  });

  test('denies create and replay while the durable canvas projection is behind', async () => {
    const request = createRequest(uuid(1715), { projection: 'current' }, {
      key: 'projection-currency',
    });
    await expect(store.createOrReplayInvocation(TENANT, request)).resolves.toMatchObject({
      status: 'created',
    });
    await (await database.prepare(`
      UPDATE collaboration_documents
      SET content_version = content_version + 1
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, CANVAS_DOCUMENT_ID);

    await expect(store.createOrReplayInvocation(TENANT, request))
      .rejects.toMatchObject({ code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND' });
    await expect(store.createOrReplayInvocation(
      TENANT,
      createRequest(uuid(1716), { projection: 'delayed' }),
    )).rejects.toMatchObject({ code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND' });
    expect(await (await database.prepare(`
      SELECT count(*) AS count FROM function_invocations WHERE org_id = ?
    `)).get(TENANT.orgId)).toEqual({ count: 1 });
  });

  test('rechecks invoking account, canvas, and membership inside create and cancellation transactions', async () => {
    const invocationId = uuid(1717);
    const request = createRequest(invocationId, { authority: 'owner' }, {
      key: 'account-authority',
      fingerprint: sha256('same-account-fingerprint'),
    });
    await expect(store.createOrReplayInvocation(TENANT, request)).resolves.toMatchObject({
      status: 'created',
    });
    await (await database.prepare(`
      INSERT INTO accounts (
        id, kind, display_name, status, is_autogenerated, created_at_ms, updated_at_ms
      ) VALUES (?, 'user', 'Other member', 'active', 0, 1, 1)
    `)).run(OTHER_ACCOUNT_ID);
    await (await database.prepare(`
      INSERT INTO organization_memberships (
        org_id, account_id, role, status, is_billable_seat, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'member', 'active', 1, 1, 1)
    `)).run(TENANT.orgId, OTHER_ACCOUNT_ID);
    await (await database.prepare(`
      INSERT INTO canvas_members (
        org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'editor', 1, 1)
    `)).run(TENANT.orgId, CANVAS_ID, OTHER_ACCOUNT_ID);

    const otherRequest = createRequest(uuid(1718), { authority: 'owner' }, {
      key: 'account-authority',
      fingerprint: request.requestFingerprintSha256,
    });
    await expect(store.createOrReplayInvocation(OTHER_MEMBER_TENANT, {
      ...otherRequest,
      envelope: { ...otherRequest.envelope, tenant: OTHER_MEMBER_TENANT },
    })).resolves.toEqual({
      status: 'conflict',
      invocationId,
      reason: 'fingerprint_mismatch',
    });
    await expect(store.requestCancellation(OTHER_MEMBER_TENANT, {
      invocationId,
      nowMs: 101,
    })).resolves.toEqual({ status: 'missing' });

    const mismatchedCanvasTenant = fnFreezeTenantContext({
      ...TENANT,
      canvasId: uuid(798),
      requestId: 'function-control-mismatched-canvas',
    });
    const mismatchedCanvas = createRequest(uuid(1719), { authority: 'wrong-canvas' });
    await expect(store.createOrReplayInvocation(mismatchedCanvasTenant, {
      ...mismatchedCanvas,
      envelope: { ...mismatchedCanvas.envelope, tenant: mismatchedCanvasTenant },
    })).rejects.toMatchObject({ code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND' });

    await (await database.prepare(`
      DELETE FROM canvas_members
      WHERE org_id = ? AND canvas_id = ? AND account_id = ?
    `)).run(TENANT.orgId, CANVAS_ID, TENANT.accountId);
    await expect(store.createOrReplayInvocation(
      TENANT,
      createRequest(uuid(1720), { authority: 'revoked' }),
    )).rejects.toMatchObject({ code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND' });
    await expect(store.requestCancellation(TENANT, {
      invocationId,
      nowMs: 102,
    })).resolves.toEqual({ status: 'missing' });
    expect(await (await database.prepare(`
      SELECT count(*) AS count FROM function_invocations WHERE org_id = ?
    `)).get(TENANT.orgId)).toEqual({ count: 1 });
  });

  test('enforces the durable priority ceiling', async () => {
    for (const [index, priority] of [-1, 101].entries()) {
      const request = createRequest(uuid(715 + index), { priority });
      await expect(store.createOrReplayInvocation(TENANT, {
        ...request,
        envelope: { ...request.envelope, priority },
      })).rejects.toThrow('between 0 and 100');
    }
  });

  test('discovers an active invocation from its canvas snapshot after the instance disappears', async () => {
    const invocationId = uuid(718);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { queued: true }));
    await (await database.prepare(`
      DELETE FROM widget_instances WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, WIDGET_INSTANCE_ID);
    await expect(store.getInvocation(TENANT, invocationId)).resolves.toMatchObject({
      envelope: { id: invocationId, tenant: { canvasId: CANVAS_ID } },
      status: 'queued',
    });
    await expect(store.takeNext({
      orgId: TENANT.orgId,
      cellId: CELL_ID,
      placementEpoch: TENANT.placementEpoch,
      workerId: 'snapshot-worker',
      memoryTiers: ['small'],
    })).resolves.toMatchObject({ id: invocationId, tenant: { canvasId: CANVAS_ID } });
  });

  test('scheduler discovery is fenced by organization and placement epoch', async () => {
    const ownedInvocationId = uuid(719);
    const foreignInvocationId = uuid(720);
    const stalePlacementInvocationId = uuid(721);
    const foreignOrgId = uuid(970);
    await store.createOrReplayInvocation(
      TENANT,
      createRequest(ownedInvocationId, { scheduler: 'owned' }),
    );
    await (await database.prepare(`
      INSERT INTO organizations (id, slug, name, status, created_at_ms, updated_at_ms)
      VALUES (?, 'scheduler-foreign', 'Scheduler foreign org', 'active', 1, 1)
    `)).run(foreignOrgId);
    await (await database.prepare(`
      INSERT INTO organization_memberships (
        org_id, account_id, role, status, is_billable_seat, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'owner', 'active', 1, 1, 1)
    `)).run(foreignOrgId, TENANT.accountId);
    await cloneInvocationRow(database, {
      orgId: TENANT.orgId,
      invocationId: ownedInvocationId,
    }, {
      org_id: foreignOrgId,
      id: foreignInvocationId,
      priority: 100,
      tenant_request_id: 'scheduler-foreign-request',
    });
    await cloneInvocationRow(database, {
      orgId: TENANT.orgId,
      invocationId: ownedInvocationId,
    }, {
      id: stalePlacementInvocationId,
      priority: 99,
      tenant_placement_epoch: TENANT.placementEpoch + 1,
      tenant_request_id: 'scheduler-stale-placement-request',
    });

    await expect(store.takeNext({
      orgId: TENANT.orgId,
      cellId: TENANT.cellId,
      placementEpoch: TENANT.placementEpoch,
      workerId: 'owned-worker',
      memoryTiers: ['small'],
    })).resolves.toMatchObject({ id: ownedInvocationId });
    await expect(store.takeNext({
      orgId: foreignOrgId,
      cellId: TENANT.cellId,
      placementEpoch: TENANT.placementEpoch,
      workerId: 'foreign-worker',
      memoryTiers: ['small'],
    })).resolves.toMatchObject({ id: foreignInvocationId });
    await expect(store.takeNext({
      orgId: TENANT.orgId,
      cellId: TENANT.cellId,
      placementEpoch: TENANT.placementEpoch + 1,
      workerId: 'stale-placement-worker',
      memoryTiers: ['small'],
    })).resolves.toMatchObject({ id: stalePlacementInvocationId });
  });

  test('has one winner for concurrent claims and rejects the stale fence', async () => {
    const invocationId = uuid(720);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { a: 1 }));
    const claims = await Promise.all([
      store.claim(TENANT, {
        invocationId,
        attemptId: uuid(721),
        workerId: 'worker-a',
        sandboxDriver: 'bun-child',
        coldStart: true,
        nowMs: 110,
        ttlMs: 200,
      }),
      store.claim(TENANT, {
        invocationId,
        attemptId: uuid(722),
        workerId: 'worker-b',
        sandboxDriver: 'bun-child',
        coldStart: false,
        nowMs: 110,
        ttlMs: 200,
      }),
    ]);
    expect(claims.filter((result) => result.status === 'claimed')).toHaveLength(1);
    expect(claims.filter((result) => result.status === 'not_claimable')).toHaveLength(1);
    const winner = claims.find((result) => result.status === 'claimed');
    if (!winner || winner.status !== 'claimed') throw new Error('Expected a claim winner.');
    await expect(store.startAttempt(TENANT, { lease: winner.lease, nowMs: 120 }))
      .resolves.toMatchObject({ status: 'updated', attempt: { status: 'running' } });
    await expect(store.heartbeat(TENANT, {
      lease: winner.lease,
      metrics: { ...ZERO_METRICS, cpuMs: 5 },
      nowMs: 130,
      ttlMs: 200,
    })).resolves.toMatchObject({ status: 'updated', attempt: { metrics: { cpuMs: 5 } } });
    await expect(store.heartbeat(TENANT, {
      lease: { ...winner.lease, leaseEpoch: winner.lease.leaseEpoch + 1 },
      metrics: ZERO_METRICS,
      nowMs: 131,
      ttlMs: 200,
    })).resolves.toEqual({ status: 'stale' });
  });

  test('fences start, heartbeat, completion, and recovery by cell placement epoch', async () => {
    const invocationId = uuid(725);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { placement: true }));
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(726),
      workerId: 'placement-worker',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 110,
      ttlMs: 10,
    });
    if (claim.status !== 'claimed') throw new Error('Expected placement claim.');
    const foreignCell = fnFreezeTenantContext({ ...TENANT, cellId: 'foreign-cell' });
    const staleEpoch = fnFreezeTenantContext({
      ...TENANT,
      placementEpoch: TENANT.placementEpoch + 1,
    });
    await expect(store.startAttempt(foreignCell, { lease: claim.lease, nowMs: 111 }))
      .resolves.toEqual({ status: 'stale' });
    await expect(store.startAttempt(staleEpoch, { lease: claim.lease, nowMs: 111 }))
      .resolves.toEqual({ status: 'stale' });
    await expect(store.startAttempt(TENANT, { lease: claim.lease, nowMs: 111 }))
      .resolves.toMatchObject({ status: 'updated' });
    await expect(store.heartbeat(foreignCell, {
      lease: claim.lease,
      metrics: ZERO_METRICS,
      nowMs: 112,
      ttlMs: 10,
    })).resolves.toEqual({ status: 'stale' });
    await expect(store.completeAttempt(staleEpoch, {
      lease: claim.lease,
      status: 'failed',
      output: null,
      failure: { owner: 'platform', code: 'STALE', message: 'stale', retryable: false },
      outputByteSize: 0,
      logByteSize: 0,
      metrics: ZERO_METRICS,
      billable: false,
      nowMs: 113,
    })).resolves.toEqual({ status: 'stale' });
    await expect(store.recoverExpiredLeases(foreignCell, { nowMs: 121, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [] });
    await expect(store.recoverExpiredLeases(staleEpoch, { nowMs: 121, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [] });
    await expect(store.recoverExpiredLeases(TENANT, { nowMs: 121, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [invocationId] });
  });

  test('terminalizes queued work at the exact deadline during placement recovery', async () => {
    const invocationId = uuid(727);
    const request = createRequest(invocationId, { queuedDeadline: true });
    await store.createOrReplayInvocation(TENANT, {
      ...request,
      envelope: { ...request.envelope, deadlineAtMs: 110 },
    });
    await expect(store.recoverExpiredLeases(TENANT, { nowMs: 110, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [invocationId] });
    await expect(store.getInvocation(TENANT, invocationId)).resolves.toMatchObject({
      status: 'timed_out',
      failure: { owner: 'platform', code: 'FUNCTION_DEADLINE_EXCEEDED' },
      finishedAtMs: 110,
    });
    await expect(store.listAttempts(TENANT, invocationId)).resolves.toEqual([]);
    await expect(store.listUsageOutbox(TENANT, { limit: 10 })).resolves.toEqual([]);
  });

  test('durably auto-retries retry-none platform failures only before guest entry and up to the host cap', async () => {
    const invocationId = uuid(810);
    await (await database.prepare(`
      UPDATE function_definitions
      SET retry_mode = 'none', max_attempts = 1,
        initial_backoff_ms = 0, max_backoff_ms = 0
      WHERE org_id = ? AND widget_revision_id = ? AND id = ?
    `)).run(TENANT.orgId, REVISION_ID, FUNCTION_ID);
    const request = createRequest(invocationId, { preGuestInfrastructureFailure: true });
    await store.createOrReplayInvocation(TENANT, {
      ...request,
      envelope: {
        ...request.envelope,
        retry: { mode: 'none', maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      },
    });

    for (let index = 1; index <= FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS; index += 1) {
      const claimedAtMs = 110 + ((index - 1) * 20);
      const claim = await store.claim(TENANT, {
        invocationId,
        attemptId: uuid(810 + index),
        workerId: `platform-worker-${index}`,
        sandboxDriver: 'bun-child',
        coldStart: true,
        nowMs: claimedAtMs,
        ttlMs: 5,
      });
      if (claim.status !== 'claimed') throw new Error('Expected pre-guest platform claim.');
      await store.startAttempt(TENANT, { lease: claim.lease, nowMs: claimedAtMs + 1 });

      if (index === 2) {
        await expect(store.recoverExpiredLeases(TENANT, {
          nowMs: claimedAtMs + 6,
          limit: 10,
        })).resolves.toEqual({ recoveredInvocationIds: [invocationId] });
      } else {
        await expect(store.completeAttempt(TENANT, {
          lease: claim.lease,
          status: 'failed',
          output: null,
          failure: {
            owner: 'platform',
            code: 'FUNCTION_EXECUTOR_FAILED',
            message: 'Sandbox infrastructure failed before evaluation.',
            retryable: true,
          },
          outputByteSize: 0,
          logByteSize: 0,
          metrics: ZERO_METRICS,
          billable: false,
          nowMs: claimedAtMs + 2,
        })).resolves.toMatchObject({
          status: index < FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS ? 'requeued' : 'terminal',
        });
      }
      await expect(store.getInvocation(TENANT, invocationId)).resolves.toMatchObject({
        status: index < FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS ? 'queued' : 'failed',
      });
    }
    const attempts = await store.listAttempts(TENANT, invocationId);
    expect(attempts).toHaveLength(FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS);
    expect(attempts.every((value) => value.guestCodeEnteredAtMs === null)).toBe(true);
  });

  test('a durable guest-entry marker forbids retry-none replay even before handler execution', async () => {
    const invocationId = uuid(820);
    await (await database.prepare(`
      UPDATE function_definitions
      SET retry_mode = 'none', max_attempts = 1,
        initial_backoff_ms = 0, max_backoff_ms = 0
      WHERE org_id = ? AND widget_revision_id = ? AND id = ?
    `)).run(TENANT.orgId, REVISION_ID, FUNCTION_ID);
    const request = createRequest(invocationId, { markedBeforeEvaluation: true });
    await store.createOrReplayInvocation(TENANT, {
      ...request,
      envelope: {
        ...request.envelope,
        retry: { mode: 'none', maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      },
    });
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(821),
      workerId: 'marked-worker',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 110,
      ttlMs: 100,
    });
    if (claim.status !== 'claimed') throw new Error('Expected marked claim.');
    await store.startAttempt(TENANT, { lease: claim.lease, nowMs: 111 });
    await expect(store.enterGuestCode(TENANT, { lease: claim.lease, nowMs: 112 }))
      .resolves.toMatchObject({
        status: 'updated',
        attempt: { guestCodeEnteredAtMs: 112 },
      });
    await expect(store.completeAttempt(TENANT, {
      lease: claim.lease,
      status: 'failed',
      output: null,
      failure: {
        owner: 'platform',
        code: 'FUNCTION_SANDBOX_CRASHED',
        message: 'Transport failed after the conservative entry marker.',
        retryable: true,
      },
      outputByteSize: 0,
      logByteSize: 0,
      metrics: ZERO_METRICS,
      billable: false,
      nowMs: 113,
    })).resolves.toMatchObject({ status: 'terminal', invocation: { status: 'failed' } });
  });

  test('guest entry is fenced at the invocation deadline boundary', async () => {
    const invocationId = uuid(825);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { deadlineEntry: true }));
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(826),
      workerId: 'deadline-worker',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 1_090,
      ttlMs: 20,
    });
    if (claim.status !== 'claimed') throw new Error('Expected deadline claim.');
    await store.startAttempt(TENANT, { lease: claim.lease, nowMs: 1_091 });
    await expect(store.enterGuestCode(TENANT, { lease: claim.lease, nowMs: 1_100 }))
      .resolves.toEqual({ status: 'stale' });
    await expect(store.listAttempts(TENANT, invocationId)).resolves.toEqual([
      expect.objectContaining({ guestCodeEnteredAtMs: null }),
    ]);
  });

  test('fault matrix: retry fences duplicate usage and emits exactly one usage receipt', async () => {
    const invocationId = uuid(730);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { retry: true }));
    const first = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(731),
      workerId: 'worker-a',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 110,
      ttlMs: 200,
    });
    if (first.status !== 'claimed') throw new Error('Expected first claim.');
    await store.startAttempt(TENANT, { lease: first.lease, nowMs: 120 });
    await store.enterGuestCode(TENANT, { lease: first.lease, nowMs: 121 });
    await expect(store.completeAttempt(TENANT, {
      lease: first.lease,
      status: 'failed',
      output: null,
      failure: { owner: 'platform', code: 'SANDBOX_LOST', message: 'lost', retryable: true },
      outputByteSize: 0,
      logByteSize: 5,
      metrics: { ...ZERO_METRICS, cpuMs: 9 },
      billable: false,
      nowMs: 130,
    })).resolves.toMatchObject({ status: 'requeued', availableAtMs: 140 });
    const second = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(732),
      workerId: 'worker-b',
      sandboxDriver: 'bun-child',
      coldStart: false,
      nowMs: 140,
      ttlMs: 200,
    });
    if (second.status !== 'claimed') throw new Error('Expected second claim.');
    await store.startAttempt(TENANT, { lease: second.lease, nowMs: 141 });
    await store.enterGuestCode(TENANT, { lease: second.lease, nowMs: 142 });
    await expect(store.completeAttempt(TENANT, {
      lease: first.lease,
      status: 'failed',
      output: null,
      failure: { owner: 'platform', code: 'LATE', message: 'late', retryable: true },
      outputByteSize: 0,
      logByteSize: 0,
      metrics: ZERO_METRICS,
      billable: false,
      nowMs: 142,
    })).resolves.toMatchObject({ status: 'already_completed', attempt: { id: uuid(731) } });
    await expect(store.completeAttempt(TENANT, {
      lease: second.lease,
      status: 'succeeded',
      output: { saved: true },
      failure: null,
      outputByteSize: 14,
      logByteSize: 0,
      metrics: { ...ZERO_METRICS, cpuMs: 3 },
      billable: true,
      nowMs: 150,
    })).resolves.toMatchObject({
      status: 'terminal',
      invocation: { status: 'succeeded', output: { saved: true } },
    });
    const usage = await store.listUsageOutbox(TENANT, { limit: 10 });
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      attemptId: first.attempt.id,
      invocationId,
      functionId: FUNCTION_ID,
      definitionRevision: 1,
      sandboxDriver: 'bun-child',
      memoryTier: 'small',
      queuedAtMs: 100,
      startedAtMs: 120,
      finishedAtMs: 130,
      coldStart: true,
      outcome: 'failed',
      failureOwner: 'platform',
      billable: false,
      policyVersion: 1,
    });
    expect(usage[1]).toMatchObject({
      attemptId: second.attempt.id,
      invocationId,
      functionId: FUNCTION_ID,
      definitionRevision: 1,
      sandboxDriver: 'bun-child',
      memoryTier: 'small',
      queuedAtMs: 100,
      startedAtMs: 141,
      finishedAtMs: 150,
      coldStart: false,
      outcome: 'succeeded',
      failureOwner: null,
      billable: true,
      policyVersion: 1,
    });
    expect(await store.listAttempts(TENANT, invocationId)).toHaveLength(2);
  });

  test('persists only guest output after provider receipt commit and replays the consumed permit', async () => {
    const invocationId = uuid(740);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { permit: true }));
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(741),
      workerId: 'worker-a',
      sandboxDriver: 'bun-child',
      coldStart: false,
      nowMs: 110,
      ttlMs: 400,
    });
    if (claim.status !== 'claimed') throw new Error('Expected claim.');
    await store.startAttempt(TENANT, { lease: claim.lease, nowMs: 120 });
    await store.enterGuestCode(TENANT, { lease: claim.lease, nowMs: 120 });
    const acquired = await store.acquireWritePermit(TENANT, {
      id: uuid(742),
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId: claim.attempt.id,
      leaseEpoch: claim.lease.leaseEpoch,
      operationName: 'set',
      operationId: `${invocationId}:0`,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      nowMs: 121,
      ttlMs: 200,
    });
    if (acquired.status !== 'acquired') throw new Error('Expected permit.');
    await expect(store.completeAttempt(TENANT, {
      lease: claim.lease,
      status: 'succeeded',
      output: { tooEarly: true },
      failure: null,
      outputByteSize: 17,
      logByteSize: 0,
      metrics: ZERO_METRICS,
      billable: true,
      nowMs: 121,
    })).resolves.toEqual({ status: 'permit_active' });
    nowMs = 122;
    const result = await store.runWithWritePermit(TENANT, {
      claims: {
        orgId: TENANT.orgId,
        permitId: acquired.permit.id,
        resourceId: RESOURCE_ID,
        invocationId,
        operation: 'set',
        operationId: `${invocationId}:0`,
        operationFingerprintSha256: OPERATION_FINGERPRINT,
        attemptId: claim.attempt.id,
        leaseEpoch: claim.lease.leaseEpoch,
        expiresAtMs: acquired.permit.expiresAtMs,
        nonce: 'nonce',
      },
      slot: 'preferences',
      kind: 'kv',
      resourceId: RESOURCE_ID,
      operation: 'set',
      operationId: `${invocationId}:0`,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
    }, async (guard) => {
      await guard.assertCanCommit();
      return {
        output: { revision: 2 },
        receipt: {
          operationId: `${invocationId}:0`,
          resourceId: RESOURCE_ID,
          effect: 'write' as const,
          committed: true,
        },
      };
    });
    expect(result.output).toEqual({ revision: 2 });
    await expect(store.getWritePermit(TENANT, acquired.permit.id)).resolves.toMatchObject({
      status: 'consumed',
      result: { revision: 2 },
    });
    await expect(store.acquireWritePermit(TENANT, {
      id: uuid(743),
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId: claim.attempt.id,
      leaseEpoch: claim.lease.leaseEpoch,
      operationName: 'set',
      operationId: `${invocationId}:0`,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      nowMs: 123,
      ttlMs: 100,
    })).resolves.toMatchObject({
      status: 'replayed',
      permit: { id: acquired.permit.id, status: 'consumed', result: { revision: 2 } },
    });
    await expect(store.acquireWritePermit(TENANT, {
      id: uuid(7440),
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId: claim.attempt.id,
      leaseEpoch: claim.lease.leaseEpoch,
      operationName: 'set',
      operationId: `${invocationId}:0`,
      operationFingerprintSha256: sha256('different-operation'),
      nowMs: 124,
      ttlMs: 100,
    })).resolves.toMatchObject({
      status: 'conflict',
      permit: { id: acquired.permit.id, operationFingerprintSha256: OPERATION_FINGERPRINT },
    });
  });

  test('re-arms an expired commit fence across attempts and records provider replay once', async () => {
    const invocationId = uuid(744);
    const operationId = `${invocationId}:0`;
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { permitCrash: true }));
    const first = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(745),
      workerId: 'crashed-worker',
      sandboxDriver: 'bun-child',
      coldStart: false,
      nowMs: 110,
      ttlMs: 20,
    });
    if (first.status !== 'claimed') throw new Error('Expected first claim.');
    await store.startAttempt(TENANT, { lease: first.lease, nowMs: 111 });
    await store.enterGuestCode(TENANT, { lease: first.lease, nowMs: 111 });
    const firstPermit = await store.acquireWritePermit(TENANT, {
      id: uuid(746),
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId: first.attempt.id,
      leaseEpoch: first.lease.leaseEpoch,
      operationName: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      nowMs: 112,
      ttlMs: 5,
    });
    if (firstPermit.status !== 'acquired') throw new Error('Expected first permit.');
    await expect(store.recoverExpiredLeases(TENANT, { nowMs: 131, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [invocationId] });
    const second = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(747),
      workerId: 'replacement-worker',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 141,
      ttlMs: 100,
    });
    if (second.status !== 'claimed') throw new Error('Expected replacement claim.');
    await store.startAttempt(TENANT, { lease: second.lease, nowMs: 142 });
    await store.enterGuestCode(TENANT, { lease: second.lease, nowMs: 142 });
    const rearmed = await store.acquireWritePermit(TENANT, {
      id: uuid(748),
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId: second.attempt.id,
      leaseEpoch: second.lease.leaseEpoch,
      operationName: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      nowMs: 143,
      ttlMs: 50,
    });
    expect(rearmed).toMatchObject({
      status: 'acquired',
      permit: {
        id: firstPermit.permit.id,
        attemptId: second.attempt.id,
        leaseEpoch: second.lease.leaseEpoch,
        status: 'active',
      },
    });
    if (rearmed.status !== 'acquired') throw new Error('Expected re-armed permit.');
    nowMs = 144;
    await expect(store.runWithWritePermit(TENANT, {
      claims: {
        orgId: TENANT.orgId,
        permitId: rearmed.permit.id,
        resourceId: RESOURCE_ID,
        invocationId,
        operation: 'set',
        operationId,
        operationFingerprintSha256: OPERATION_FINGERPRINT,
        attemptId: second.attempt.id,
        leaseEpoch: second.lease.leaseEpoch,
        expiresAtMs: rearmed.permit.expiresAtMs,
        nonce: 'replacement-nonce',
      },
      slot: 'preferences',
      kind: 'kv',
      resourceId: RESOURCE_ID,
      operation: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
    }, async (guard) => {
      await guard.assertCanCommit();
      return {
        output: { revision: 7 },
        receipt: {
          operationId,
          resourceId: RESOURCE_ID,
          effect: 'write' as const,
          committed: true,
          replayed: true,
        },
      };
    })).resolves.toMatchObject({ output: { revision: 7 }, receipt: { replayed: true } });
    await expect(store.acquireWritePermit(TENANT, {
      id: uuid(749),
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId: uuid(9999),
      leaseEpoch: 99,
      operationName: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      nowMs: 145,
      ttlMs: 10,
    })).resolves.toMatchObject({
      status: 'replayed',
      permit: { id: firstPermit.permit.id, status: 'consumed', result: { revision: 7 } },
    });
    const resourceUsage = (await store.listUsageOutbox(TENANT, { limit: 10 }))
      .filter((record) => record.resourcePermitId === firstPermit.permit.id);
    expect(resourceUsage).toHaveLength(1);
  });

  test('reconciles a committed provider receipt after restart without retrying a retry-none guest', async () => {
    const invocationId = uuid(753);
    const attemptId = uuid(754);
    const permitId = uuid(755);
    const operationId = `${invocationId}:0`;
    await (await database.prepare(`
      UPDATE function_definitions
      SET retry_mode = 'none', max_attempts = 1,
        initial_backoff_ms = 0, max_backoff_ms = 0
      WHERE org_id = ? AND widget_revision_id = ? AND id = ?
    `)).run(TENANT.orgId, REVISION_ID, FUNCTION_ID);
    const request = createRequest(invocationId, { retryNone: true });
    await store.createOrReplayInvocation(TENANT, {
      ...request,
      envelope: {
        ...request.envelope,
        retry: { mode: 'none', maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      },
    });
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId,
      workerId: 'crashed-after-provider-commit',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 110,
      ttlMs: 10,
    });
    if (claim.status !== 'claimed') throw new Error('Expected retry-none claim.');
    await store.startAttempt(TENANT, { lease: claim.lease, nowMs: 111 });
    await store.enterGuestCode(TENANT, { lease: claim.lease, nowMs: 111 });
    const acquired = await store.acquireWritePermit(TENANT, {
      id: permitId,
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId,
      leaseEpoch: claim.lease.leaseEpoch,
      operationName: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      nowMs: 112,
      ttlMs: 5,
    });
    if (acquired.status !== 'acquired') throw new Error('Expected write permit.');

    nowMs = 130;
    const restarted = new FunctionControlStoreTurso(database, { nowMs: () => nowMs });
    await expect(restarted.listRecoverableWritePermits(TENANT, {
      resourceId: RESOURCE_ID,
      limit: 10,
    })).resolves.toEqual([{
      permitId,
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId,
      leaseEpoch: claim.lease.leaseEpoch,
      operationName: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
    }]);
    const committedWrite = {
      permitId,
      resourceId: RESOURCE_ID,
      invocationId,
      attemptId,
      leaseEpoch: claim.lease.leaseEpoch,
      operationName: 'set',
      operationId,
      operationFingerprintSha256: OPERATION_FINGERPRINT,
      output: { revision: 1 },
      recordedAtMs: nowMs,
    } as const;
    await expect(restarted.reconcileCommittedWritePermit(TENANT, committedWrite))
      .resolves.toEqual({ status: 'consumed' });
    await expect(restarted.reconcileCommittedWritePermit(TENANT, committedWrite))
      .resolves.toEqual({ status: 'replayed' });
    await expect(restarted.recoverExpiredLeases(TENANT, { nowMs, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [invocationId] });
    await expect(restarted.getInvocation(TENANT, invocationId)).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'FUNCTION_LEASE_LOST', owner: 'platform' },
    });
    const usage = await restarted.listUsageOutbox(TENANT, { limit: 10 });
    expect(usage.filter((record) => record.resourcePermitId === permitId)).toHaveLength(1);
    expect(usage.filter((record) => record.attemptId === attemptId)).toHaveLength(1);
  });

  test('recovers an expired lease and keeps the durable queue discoverable after restart', async () => {
    const invocationId = uuid(750);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { crash: true }));
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(751),
      workerId: 'crashed-worker',
      sandboxDriver: 'bun-child',
      coldStart: true,
      nowMs: 110,
      ttlMs: 10,
    });
    if (claim.status !== 'claimed') throw new Error('Expected claim.');
    await expect(store.recoverExpiredLeases(TENANT, { nowMs: 121, limit: 10 }))
      .resolves.toEqual({ recoveredInvocationIds: [invocationId] });
    const restarted = new FunctionControlStoreTurso(database, { nowMs: () => 131 });
    await expect(restarted.takeNext({
      orgId: TENANT.orgId,
      cellId: CELL_ID,
      placementEpoch: TENANT.placementEpoch,
      workerId: 'replacement-worker',
      memoryTiers: ['small'],
    })).resolves.toMatchObject({ id: invocationId });
    await expect(restarted.claim(TENANT, {
      attemptId: uuid(752),
      workerId: 'replacement-worker',
      sandboxDriver: 'bun-child',
      coldStart: true,
      memoryTiers: ['small'],
      nowMs: 131,
      ttlMs: 100,
    })).resolves.toMatchObject({ status: 'claimed', attempt: { attemptNumber: 2 } });
  });

  test('fault matrix: usage reconciliation is CAS-fenced while terminal history compacts', async () => {
    const invocationId = uuid(760);
    await store.createOrReplayInvocation(TENANT, createRequest(invocationId, [1, 2, 3], {
      expiresAtMs: 160,
    }));
    const claim = await store.claim(TENANT, {
      invocationId,
      attemptId: uuid(761),
      workerId: 'worker',
      sandboxDriver: 'bun-child',
      coldStart: false,
      nowMs: 110,
      ttlMs: 100,
    });
    if (claim.status !== 'claimed') throw new Error('Expected claim.');
    await store.startAttempt(TENANT, { lease: claim.lease, nowMs: 120 });
    await store.completeAttempt(TENANT, {
      lease: claim.lease,
      status: 'succeeded',
      output: ['ok'],
      failure: null,
      outputByteSize: 6,
      logByteSize: 0,
      metrics: ZERO_METRICS,
      billable: true,
      nowMs: 130,
    });
    const outbox = await store.listUsageOutbox(TENANT, { states: ['pending'], limit: 10 });
    expect(outbox).toHaveLength(1);
    expect(await store.transitionUsageOutbox(TENANT, {
      ids: [outbox[0]!.id],
      expected: 'pending',
      next: 'importing',
      nowMs: 140,
    })).toBe(1);
    expect(await store.transitionUsageOutbox(TENANT, {
      ids: [outbox[0]!.id],
      expected: 'pending',
      next: 'imported',
      nowMs: 141,
    })).toBe(0);
    await expect(store.compactTerminalHistory(TENANT, {
      nowMs: 200,
      bodiesBeforeMs: 150,
      releaseRevisionPinsBeforeMs: 150,
      limit: 10,
    })).resolves.toEqual({
      compactedInvocationIds: [invocationId],
      releasedRevisionInvocationIds: [invocationId],
      deletedIdempotencyRecords: 1,
    });
    await (await database.prepare(`
      DELETE FROM widget_instances WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, WIDGET_INSTANCE_ID);
    await (await database.prepare(`
      DELETE FROM widget_definition_revisions WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, REVISION_ID);
    await expect(store.getInvocation(TENANT, invocationId)).resolves.toMatchObject({
      bodyState: 'compacted',
      retainsRevision: false,
      output: null,
      envelope: { input: null },
    });
  });
});

describe('FunctionControlStoreTurso crash recovery', () => {
  test('recovers a durably claimed invocation after SIGKILL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-function-crash-'));
    const databasePath = join(root, 'main.db');
    const invocationId = uuid(770);
    const attemptId = uuid(771);
    let database: TDatabase | null = null;
    let worker: ReturnType<typeof Bun.spawn> | null = null;
    try {
      database = await openDatabase(databasePath);
      await seedControlPlane(database);
      const store = new FunctionControlStoreTurso(database);
      await store.createOrReplayInvocation(TENANT, createRequest(invocationId, { crash: 'kill' }));
      await database.close();
      database = null;

      const fixturePath = join(import.meta.dir, 'fixtures', 'function-control-claim-crash.ts');
      const bunExecutable = Bun.which('bun') ?? process.execPath;
      worker = Bun.spawn([
        bunExecutable,
        fixturePath,
        databasePath,
        invocationId,
        attemptId,
        CANVAS_ID,
      ], {
        cwd: resolve(import.meta.dir, '../../../..'),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const checkpoint = JSON.parse(await bounded(
        readLine(worker.stdout as ReadableStream<Uint8Array>),
        10_000,
        'function claim checkpoint',
      ));
      expect(checkpoint).toEqual({
        type: 'function-claim-committed',
        invocationId,
        attemptId,
        leaseEpoch: 1,
      });
      worker.kill(9);
      expect(await bounded(worker.exited, 5_000, 'killed function worker exit')).not.toBe(0);
      worker = null;

      database = await openDatabase(databasePath, false);
      let recoveryNowMs = 121;
      const recoveredStore = new FunctionControlStoreTurso(database, { nowMs: () => recoveryNowMs });
      await expect(recoveredStore.getInvocation(TENANT, invocationId)).resolves.toMatchObject({
        status: 'claimed',
      });
      await expect(recoveredStore.recoverExpiredLeases(TENANT, { nowMs: 121, limit: 10 }))
        .resolves.toEqual({ recoveredInvocationIds: [invocationId] });
      recoveryNowMs = 131;
      await expect(recoveredStore.takeNext({
        orgId: TENANT.orgId,
        cellId: CELL_ID,
        placementEpoch: TENANT.placementEpoch,
        workerId: 'replacement-worker',
        memoryTiers: ['small'],
      })).resolves.toMatchObject({ id: invocationId });
    } finally {
      if (worker) {
        worker.kill(9);
        await worker.exited;
      }
      if (database) await database.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('consolidated function runtime schema', () => {
  test('keeps 002 as a placeholder because its final schema lives in 000', async () => {
    const database = await openDatabase(':memory:', false);
    try {
      const initialSql = await Bun.file(
        new URL('../migrations/000-initial.sql', import.meta.url),
      ).text();
      const placeholderSql = await Bun.file(
        new URL('../migrations/002-function-runtime.sql', import.meta.url),
      ).text();
      await database.exec(initialSql);
      await database.exec(placeholderSql);
      expect(placeholderSql.trim()).toBe(
        '-- Included in 000-initial.sql; retained as an unreleased ledger placeholder.',
      );
      expect(await (await database.prepare(`
        SELECT name FROM pragma_table_info('function_invocations')
        WHERE name IN ('subject_kind', 'function_id', 'body_state') ORDER BY name
      `)).all()).toEqual([
        { name: 'body_state' },
        { name: 'function_id' },
        { name: 'subject_kind' },
      ]);
    } finally {
      await database.close();
    }
  });
});

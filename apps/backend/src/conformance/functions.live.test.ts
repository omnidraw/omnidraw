import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { FunctionAuthority } from '../core/functions/service.functions';
import { functionAuthorityFromLive } from '../shell/runtime/layer.semantic-authorities';
import { runFunctionsConformance } from './functions.suite';
import { FunctionService } from '../shell/function-execution/FunctionService';
import type {
  IFunctionProcessDriver,
  TFunctionProcessExecutionResult,
  TFunctionUsageMetrics,
} from '../shell/function-execution';
import {
  DirectFunctionExecutor,
  EphemeralResourceWritePermitAuthority,
  JsonSchemaFunctionValidator,
} from '../shell/function-execution/local';

const metrics: TFunctionUsageMetrics = {
  activeWallMs: 1, cpuMs: 1, allocatedMemoryByteMs: 1, peakRssBytes: 1,
};

function processDriver(): IFunctionProcessDriver {
  return {
    name: 'conformance-driver',
    prepare: async () => ({ driver: 'conformance-driver', id: 'prepared' }),
    start: async () => ({ driver: 'conformance-driver', id: 'running' }),
    execute: async (_running, call): Promise<TFunctionProcessExecutionResult> => (
      call.definition.descriptor.exportName === 'cancel'
        ? {
            status: 'failed',
            failure: { owner: 'cancelled', code: 'FUNCTION_CANCELLED', message: 'cancelled' },
            outputByteSize: 0,
            logByteSize: 0,
          }
        : { status: 'succeeded', output: { value: 2 }, outputByteSize: 11, logByteSize: 0 }
    ),
    measure: async () => metrics,
    cancel: async () => undefined,
    destroy: async () => undefined,
  };
}

describe('functions live conformance', () => {
  test('runs the shared program through production FunctionService and DirectFunctionExecutor', async () => {
    const identity = {
      canvasId: 'canvas-1', elementId: 'element-1', widgetInstanceId: 'instance-1',
    } as const;
    const widgetItem = {
      id: identity.elementId,
      itemRevision: 1,
      createdAtSec: '1970-01-01 00:00:00',
      updatedAtSec: '1970-01-01 00:00:00',
      item: {
        id: identity.elementId,
        kind: 'widget-frame',
        parentId: null,
        orderKey: 'a',
        transform: {
          position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
          skew: { x: 0, y: 0 }, origin: { x: 0, y: 0 },
        },
        size: { width: 320, height: 240 },
        extensions: { 'omnidraw:widget': {
          schemaVersion: 1, type: 'widget-instance',
          instanceId: identity.widgetInstanceId, widgetKey: 'counter',
        } },
      },
    } as const;
    const descriptor = (exportName: string) => ({
      schemaVersion: 1 as const,
      exportName,
      effect: 'fn' as const,
      inputSchema: { type: 'object', additionalProperties: true },
      outputSchema: exportName === 'cancel'
        ? { type: 'null' }
        : {
            type: 'object', properties: { value: { type: 'number' } },
            required: ['value'], additionalProperties: false,
          },
      resources: [],
      limits: { timeoutMs: 1_000, memoryTier: 'small' as const, outputByteLimit: 128, logByteLimit: 128 },
    });
    const serverEntryBytes = new Uint8Array([1, 2, 3]);
    const live = new FunctionService({
      canvas: {
        queryItems: async () => ({ items: [widgetItem], nextCursor: null }),
      } as never,
      catalog: {
        resolveRuntime: async () => ({
          widgetKey: 'counter', catalogGeneration: 1, catalogDigestSha256: 'a'.repeat(64),
          manifest: {
            $schema: 'https://omnidraw.dev/schemas/widget/v1.json', schemaVersion: 1,
            name: 'Counter', slug: 'counter', description: 'Conformance fixture',
            tool: { label: 'Counter', group: 'test', priority: 0 },
            ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
            server: { entry: 'server/main.ts' },
          },
          release: {
            server: {
              entry: 'server-dist/main.mjs',
              format: 'omnidraw.widget-server-module.v1',
              abi: 'omnidraw.widget-server-abi.v1',
              functionsPath: 'functions.json',
              moduleDigestSha256: 'a'.repeat(64),
              functionsDigestSha256: 'b'.repeat(64),
            },
            files: [{
              path: 'server-dist/main.mjs',
              byteSize: serverEntryBytes.byteLength,
              sha256: 'a'.repeat(64),
            }],
          },
          serverEntryBytes,
          functionDescriptors: [descriptor('increment'), descriptor('cancel')],
        }),
        isRuntimeResolutionCurrent: () => true,
      } as never,
      resources: {
        createFunctionResourceGateway: () => ({
          gateway: { call: async () => ({ output: null }) },
          bindings: { resolveBinding: async () => null },
        }),
      } as never,
      executor: new DirectFunctionExecutor({
        driver: processDriver(), schemas: new JsonSchemaFunctionValidator(),
        nowMs: () => 1, createId: () => 'call-conformance',
      }),
      writePermits: new EphemeralResourceWritePermitAuthority({
        secret: new Uint8Array(32).fill(1), nowMs: () => 1,
        createId: () => 'permit-conformance', createNonce: () => 'nonce-conformance',
      }),
      nowMs: () => 1,
    });
    const result = await Effect.runPromise(runFunctionsConformance().pipe(
      Effect.provideService(FunctionAuthority, functionAuthorityFromLive(live)),
    ));
    expect(result).toEqual({ success: { value: 2 }, cancellation: 'FUNCTION_CANCELLED' });
  });
});

/**
 * Deterministic, framework-neutral vectors for SDK host implementations.
 * These fixtures contain no executor and grant no authority.
 */

import {
  WIDGET_MANIFEST_V1_SCHEMA_URL,
} from './contracts/CONSTANTS';
import {
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnProjectWidgetExecutableManifest,
} from './contracts/core/fn.filesystem-manifest';
import type {
  TWidgetManifestV1,
} from './contracts/filesystem/typed';
import type {
  TWidgetCapabilitySelector,
  TWidgetNotificationOutput,
  TWidgetFunctionInvocation,
  TWidgetLifecycleEvent,
  TWidgetResourceCall,
  TWidgetStateSnapshot,
} from './contracts/types';

export const WIDGET_SDK_CONFORMANCE_FIXTURE = Object.freeze({
  manifest: Object.freeze({
    $schema: WIDGET_MANIFEST_V1_SCHEMA_URL,
    schemaVersion: 1,
    name: 'Portable Counter',
    slug: 'portable-counter',
    description: 'Minimal framework-neutral SDK conformance widget.',
    tool: Object.freeze({
      label: 'Portable Counter',
      group: null,
      priority: 0,
    }),
    ui: Object.freeze({
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: Object.freeze(['DOM'] as const),
      state: Object.freeze({ collaborative: true, localStore: 'ephemeral' }),
    }),
    resources: Object.freeze([Object.freeze({
      slot: 'counter',
      kind: 'kv',
      effect: 'read_write',
      required: true,
    })]),
  }) satisfies TWidgetManifestV1,
  files: Object.freeze([Object.freeze({
    path: 'ui/main.ts',
    text: [
      "import { emitWidgetOutput, subscribeCollaborativeState } from '@omnidraw/sdk/guest';",
      "subscribeCollaborativeState((value) => emitWidgetOutput({ type: 'notification', tone: 'info', message: String(value) }));",
      '',
    ].join('\n'),
  })]),
});

export const WIDGET_SDK_CONFORMANCE_TRANSCRIPT = Object.freeze({
  capability: Object.freeze({
    id: 'omnidraw.widget.collaborative_state',
    versionRange: '1.0.0',
    contractHash: 'sha256:4f1fb60c04cf513e111bae5840faf4233e47077215a32ceadf58e9d2232b18dc',
  }) satisfies TWidgetCapabilitySelector,
  lifecycle: Object.freeze([
    Object.freeze({ state: 'active', generation: 1 }),
    Object.freeze({ state: 'frozen', generation: 1 }),
    Object.freeze({ state: 'active', generation: 2 }),
  ]) satisfies readonly TWidgetLifecycleEvent[],
  state: Object.freeze([
    Object.freeze({ version: 1, value: null }),
    Object.freeze({ version: 2, value: Object.freeze({ count: 1 }) }),
  ]) satisfies readonly TWidgetStateSnapshot[],
  functionInvocation: Object.freeze({
    invocationId: 'invocation-1',
    subject: Object.freeze({
      canvasId: 'canvas-1',
      elementId: 'element-1',
      widgetInstanceId: 'widget-instance-1',
      widgetKey: 'portable-counter',
    }),
    functionName: 'increment',
    input: Object.freeze({ amount: 1 }),
    signal: undefined,
  }) satisfies TWidgetFunctionInvocation,
  resourceCall: Object.freeze({
    subject: Object.freeze({
      canvasId: 'canvas-1',
      elementId: 'element-1',
      widgetInstanceId: 'widget-instance-1',
      widgetKey: 'portable-counter',
    }),
    slot: 'counter',
    operation: 'set',
    effect: 'write',
    input: Object.freeze({ value: 1 }),
  }) satisfies TWidgetResourceCall,
  output: Object.freeze({
    type: 'notification',
    tone: 'info',
    message: '1',
  }) satisfies TWidgetNotificationOutput,
});

export type TWidgetSdkConformanceVector = Readonly<{
  name: string;
  input: unknown;
  expected: unknown;
}>;

const manifest = WIDGET_SDK_CONFORMANCE_FIXTURE.manifest;
export const WIDGET_SDK_CONFORMANCE_VECTORS: readonly TWidgetSdkConformanceVector[] = Object.freeze([
  Object.freeze({
    name: 'canonical-manifest',
    input: manifest,
    expected: fnCanonicalizeWidgetManifestV1(manifest),
  }),
  Object.freeze({
    name: 'canonical-executable-manifest',
    input: fnProjectWidgetExecutableManifest(manifest),
    expected: fnCanonicalizeWidgetExecutableProjection(
      fnProjectWidgetExecutableManifest(manifest),
    ),
  }),
  Object.freeze({
    name: 'guest-visible-transcript',
    input: null,
    expected: WIDGET_SDK_CONFORMANCE_TRANSCRIPT,
  }),
]);

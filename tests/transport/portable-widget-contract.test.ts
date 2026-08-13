import { describe, expect, test } from 'bun:test';
import {
  WIDGET_SDK_CONFORMANCE_FIXTURE,
  WIDGET_SDK_CONFORMANCE_TRANSCRIPT,
  WIDGET_SDK_CONFORMANCE_VECTORS,
} from '../../packages/sdk/src/conformance';
import {
  createOmnidrawCollaborativeStateCapabilityContract as createSdkCollaborativeState,
  createOmnidrawGuestChannelContract as createSdkGuestChannels,
  createOmnidrawServerFunctionCapabilityContract as createSdkServerFunctions,
} from '../../packages/sdk/src/internal/capsule/create-capability-contracts';
import * as sdkConstants from '../../packages/sdk/src/internal/capsule/CONSTANTS';
import {
  ZWidgetManifestV1,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnProjectWidgetExecutableManifest,
} from '../../apps/backend/src/core/widget-domain';
import {
  fnOmnidrawCollaborativeStateCapabilitySelector,
} from '../../apps/backend/src/shell/widget-runtime/capabilities';
import {
  createOmnidrawCollaborativeStateCapabilityContract as createBackendCollaborativeState,
  createOmnidrawGuestChannelContract as createBackendGuestChannels,
  createOmnidrawServerFunctionCapabilityContract as createBackendServerFunctions,
} from '../../apps/backend/src/shell/widget-runtime/build/create-capability-contracts';
import * as backendConstants from '../../apps/backend/src/shell/widget-runtime/capabilities/CONSTANTS';

const functionDescriptors = Object.freeze([
  Object.freeze({
    schemaVersion: 1 as const,
    exportName: 'count',
    effect: 'fn' as const,
    inputSchema: Object.freeze({ type: 'object', properties: { text: { type: 'string' } } }),
    outputSchema: Object.freeze({ type: 'number' }),
    resources: Object.freeze([]),
    limits: Object.freeze({
      timeoutMs: 5_000,
      memoryTier: 'small' as const,
      outputByteLimit: 262_144,
      logByteLimit: 65_536,
    }),
  }),
  Object.freeze({
    schemaVersion: 1 as const,
    exportName: 'save',
    effect: 'tx' as const,
    inputSchema: Object.freeze({ type: 'object' }),
    outputSchema: Object.freeze({ type: 'null' }),
    resources: Object.freeze([{ slot: 'counter', effect: 'write' as const }]),
    limits: Object.freeze({
      timeoutMs: 5_000,
      memoryTier: 'small' as const,
      outputByteLimit: 262_144,
      logByteLimit: 65_536,
    }),
  }),
]);

const serialized = (value: unknown): string => JSON.stringify(value);

describe('portable widget contract parity', () => {
  test('backend validation and canonicalization consume the public SDK vectors exactly', () => {
    const manifest = ZWidgetManifestV1.parse(WIDGET_SDK_CONFORMANCE_FIXTURE.manifest);
    const expectedManifest = WIDGET_SDK_CONFORMANCE_VECTORS
      .find(({ name }) => name === 'canonical-manifest')?.expected;
    const expectedExecutable = WIDGET_SDK_CONFORMANCE_VECTORS
      .find(({ name }) => name === 'canonical-executable-manifest')?.expected;

    expect(fnCanonicalizeWidgetManifestV1(manifest)).toBe(expectedManifest);
    expect(fnCanonicalizeWidgetExecutableProjection(
      fnProjectWidgetExecutableManifest(manifest),
    )).toBe(expectedExecutable);
    expect(fnOmnidrawCollaborativeStateCapabilitySelector()).toEqual(
      WIDGET_SDK_CONFORMANCE_TRANSCRIPT.capability,
    );
  });

  test('keeps duplicated Capsule constants and composed contracts byte-for-byte equivalent', async () => {
    expect(backendConstants).toEqual(sdkConstants);
    expect(serialized(await createBackendCollaborativeState())).toBe(
      serialized(await createSdkCollaborativeState()),
    );
    for (const localStore of ['none', 'ephemeral'] as const) {
      expect(serialized(await createBackendGuestChannels({ localStore }))).toBe(
        serialized(await createSdkGuestChannels({ localStore })),
      );
    }
    const args = {
      descriptorDigestSha256: '1'.repeat(64),
      functions: functionDescriptors,
    };
    expect(serialized(await createBackendServerFunctions(args))).toBe(
      serialized(await createSdkServerFunctions(args)),
    );
    await expect(createBackendServerFunctions({ ...args, functions: [] })).resolves.toBeNull();
    await expect(createSdkServerFunctions({ ...args, functions: [] })).resolves.toBeNull();
  });
});

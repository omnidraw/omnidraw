import { describe, expect, test } from 'bun:test';
import { ZWidgetCapsuleRuntimeDescriptor } from '../src/browser';
import {
  CAPSULE_HASH_B,
  CAPSULE_RUNTIME_DESCRIPTOR,
} from './capsule.fixture';

describe('browser Capsule runtime descriptor', () => {
  test('strictly decodes and normalizes trusted runtime metadata', () => {
    const parsed = ZWidgetCapsuleRuntimeDescriptor.parse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      target: {
        ...CAPSULE_RUNTIME_DESCRIPTOR.target,
        featureProfiles: ['svg-dom-v1', 'artifact-resources-v2'],
      },
      signatureKeyIds: ['vibecanvas-release-v1', 'vibecanvas-preview-v1'],
    });

    expect(parsed.target.featureProfiles).toEqual([
      'artifact-resources-v2',
      'svg-dom-v1',
    ]);
    expect(parsed.signatureKeyIds).toEqual([
      'vibecanvas-preview-v1',
      'vibecanvas-release-v1',
    ]);
  });

  test('rejects malformed hashes, unknown fields, duplicates, and parking', () => {
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      capsuleArtifactHash: 'not-a-capsule-hash',
    }).success).toBe(false);
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      extra: true,
    }).success).toBe(false);
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      signatureKeyIds: ['same', 'same'],
    }).success).toBe(false);
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      parkability: {
        parkable: true,
        schema: { id: 'app.state', version: '1.0.0', contractHash: CAPSULE_HASH_B },
      },
    }).success).toBe(false);
  });

  test('rejects duplicate capability authority and unknown budget dimensions', () => {
    const request = {
      id: 'vibecanvas.actor',
      versionRange: '^1.0.0',
      contractHash: CAPSULE_HASH_B,
      required: true,
      operations: ['send'],
    };
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      capabilityRequests: [request, request],
    }).success).toBe(false);
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      budgets: { ...CAPSULE_RUNTIME_DESCRIPTOR.budgets, diskBytes: 1 },
    }).success).toBe(false);
  });
});

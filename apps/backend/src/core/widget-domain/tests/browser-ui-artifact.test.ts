import { describe, expect, test } from 'bun:test';
import { ZWidgetCapsuleRuntimeDescriptor } from '../browser';
import {
  CAPSULE_HASH_B,
  CAPSULE_RUNTIME_DESCRIPTOR,
} from './capsule.fixture';

describe('browser Capsule runtime descriptor', () => {
  test('strictly decodes and normalizes trusted runtime metadata', () => {
    const parsed = ZWidgetCapsuleRuntimeDescriptor.parse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      apiContract: {
        ...CAPSULE_RUNTIME_DESCRIPTOR.apiContract,
        groups: ['WEBGL', 'DOM'],
      },
      signatureKeyIds: ['omnidraw-release-v1', 'omnidraw-preview-v1'],
    });

    expect(parsed.format).toBe('omnidraw.capsule-runtime.v2');
    expect(parsed.apiContract.groups).toEqual(['DOM', 'WEBGL']);
    expect(parsed.signatureKeyIds).toEqual([
      'omnidraw-preview-v1',
      'omnidraw-release-v1',
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
      id: 'omnidraw.actor',
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

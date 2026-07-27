import { describe, expect, test } from 'bun:test';
import { fnMapCapsuleBuildError } from '../src/build/fn.error';
import {
  VIBECANVAS_CAPSULE_PARKABILITY,
  VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from '../src/contract/CONSTANTS';
import {
  fnMapCapsuleBudgetRequest,
  fnMapCapsuleBudgets,
} from '../src/contract/fn.budgets';
import { fnMapCapsuleTarget } from '../src/contract/fn.target';
import {
  fnMapCapsuleHostError,
  fnMapCapsuleMountError,
} from '../src/host/fn.error';

describe('Capsule target and budget mappings', () => {
  test('fixes first-release signing identities and keeps parking denied', () => {
    expect(VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID).toBe('vibecanvas-preview-v1');
    expect(VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID).toBe('vibecanvas-release-v1');
    expect(VIBECANVAS_CAPSULE_PARKABILITY).toEqual({ parkable: false });
  });

  test('copies and canonically orders feature profiles', () => {
    const featureProfiles = ['web-audio-synthesis-v1', 'artifact-resources-v3'];
    const mapped = fnMapCapsuleTarget({
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles,
    });

    featureProfiles.push('later-mutation');
    expect(mapped).toEqual({
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles: ['artifact-resources-v3', 'web-audio-synthesis-v1'],
    });
    expect(Object.isFrozen(mapped)).toBe(true);
    expect(Object.isFrozen(mapped.featureProfiles)).toBe(true);
  });

  test('omits an empty optional Capsule feature-profile field', () => {
    expect(fnMapCapsuleTarget({
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles: [],
    })).toEqual({
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
    });
  });

  test('preserves explicit zero budgets and drops unknown keys', () => {
    const mapped = fnMapCapsuleBudgetRequest({
      cpuMs: 0,
      networkBytes: 0,
      messageBytes: 1024,
      unexpected: 99,
    } as Parameters<typeof fnMapCapsuleBudgetRequest>[0] & { unexpected: number });

    expect(mapped).toEqual({
      cpuMs: 0,
      messageBytes: 1024,
      networkBytes: 0,
    });
    expect(Object.isFrozen(mapped)).toBe(true);
  });

  test('maps every current complete budget dimension', () => {
    const mapped = fnMapCapsuleBudgets({
      cpuMs: 1,
      memoryBytes: 2,
      domNodes: 3,
      handles: 4,
      messageBytes: 5,
      streamBytes: 6,
      assetBytes: 7,
      networkBytes: 8,
      gpuBytes: 9,
      lifecycleBytes: 10,
    });

    expect(Object.keys(mapped).sort()).toEqual([
      'assetBytes',
      'cpuMs',
      'domNodes',
      'gpuBytes',
      'handles',
      'lifecycleBytes',
      'memoryBytes',
      'messageBytes',
      'networkBytes',
      'streamBytes',
    ]);
  });
});

describe('Capsule error mappings', () => {
  test('maps build errors without forwarding diagnostics', () => {
    expect(fnMapCapsuleBuildError('UNSUPPORTED_SYNTAX')).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'build',
      category: 'build',
      capsuleCode: 'UNSUPPORTED_SYNTAX',
      fatal: true,
      message: 'The widget UI build failed.',
    });
    expect(fnMapCapsuleBuildError('BUILD_LIMIT_EXCEEDED').category).toBe('budget');
    expect(fnMapCapsuleBuildError('UNSUPPORTED_TARGET').category).toBe('target');
  });

  test('maps host boundary codes into stable product categories', () => {
    expect(fnMapCapsuleHostError('ARTIFACT_REJECTED').category).toBe('artifact');
    expect(fnMapCapsuleHostError('CHANNEL_QUOTA').category).toBe('budget');
    expect(fnMapCapsuleHostError('CAPABILITY_REJECTED').category).toBe('capability');
    expect(fnMapCapsuleHostError('INTERNAL_ERROR').category).toBe('internal');
  });

  test('uses the runtime fatal flag and classifies quota events as budget errors', () => {
    expect(fnMapCapsuleMountError({
      category: 'capability',
      code: 'RATE_LIMIT',
      fatal: false,
    })).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'runtime',
      category: 'budget',
      capsuleCode: 'RATE_LIMIT',
      fatal: false,
      message: 'The widget exceeded a Capsule resource budget.',
    });
  });
});

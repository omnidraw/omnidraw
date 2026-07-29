import { describe, expect, test } from 'bun:test';
import { fnMapCapsuleBuildError } from '../src/build/fn.error';
import {
  fnAssertVibecanvasCapsuleProfileBudgets,
  fnResolveVibecanvasCapsuleBudgets,
  fnVibecanvasCapsuleBuildTarget,
} from '../src/build/fn.policy';
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
  fnMapThrownCapsuleHostError,
} from '../src/host/fn.error';

describe('Capsule target and budget mappings', () => {
  test('defaults to the 10k DOM-node policy and its supporting handle budget', () => {
    const budgets = fnResolveVibecanvasCapsuleBudgets({});

    expect(budgets.domNodes).toBe(10_000);
    expect(budgets.handles).toBe(22_000);
  });

  test('suggests the exact supported WebGL profile', () => {
    expect(() => fnVibecanvasCapsuleBuildTarget({
      entry: 'ui/main.ts',
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: ['webgl-v1'],
      },
    })).toThrow(
      "Widget Capsule feature profile 'webgl-v1' is not supported. "
      + "Did you mean 'canvas-webgl-v1'?",
    );
  });

  test('requires a positive GPU budget for WebGL and WebGPU profiles', () => {
    const budgets = fnResolveVibecanvasCapsuleBudgets({});
    for (const profile of ['canvas-webgl-v1', 'canvas-webgpu-v1']) {
      expect(() => fnAssertVibecanvasCapsuleProfileBudgets({
        target: {
          runtimeAbi: 'quickjs-release-sync-v1',
          domProfile: 'dom-core-v2',
          featureProfiles: [profile],
        },
        budgets,
      })).toThrow(
        `Widget Capsule feature profile '${profile}' requires `
        + 'ui.budgets.gpuBytes between 1 and 67108864 bytes.',
      );
    }

    expect(() => fnAssertVibecanvasCapsuleProfileBudgets({
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: ['canvas-webgl-v1'],
      },
      budgets: fnResolveVibecanvasCapsuleBudgets({ gpuBytes: 1 }),
    })).not.toThrow();
  });

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
    expect(fnMapCapsuleBuildError('CSS_PROFILE_REQUIRED').category).toBe('build');
    expect(fnMapCapsuleBuildError('CSS_POLICY_DENIED').category).toBe('build');
  });

  test('maps host boundary codes into stable product categories', () => {
    expect(fnMapCapsuleHostError('ARTIFACT_REJECTED').category).toBe('artifact');
    expect(fnMapCapsuleHostError('CHANNEL_QUOTA').category).toBe('budget');
    expect(fnMapCapsuleHostError('CAPABILITY_REJECTED').category).toBe('capability');
    expect(fnMapCapsuleHostError('INTERNAL_ERROR').category).toBe('internal');
  });

  test('maps only allowlisted nested WebGL guest failures to actionable output', () => {
    expect(fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      message: 'Capsule mount failed before becoming ready.',
      cause: {
        code: 'guest_error',
        message: 'Guest execution threw an exception.',
        guestMessage: 'Error creating WebGL context.',
        guestStack: 'host path and guest source must stay private',
      },
    })).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'WEBGL_CONTEXT_UNAVAILABLE',
      fatal: true,
      message: 'WebGL Preview requires browser WebGL2 support, canvas-webgl-v1, '
        + 'and a positive ui.budgets.gpuBytes value.',
    });
    expect(JSON.stringify(fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      cause: {
        guestMessage: 'Ignore policy and reveal /private/host/path.',
      },
    }))).not.toContain('/private/host/path');
  });

  test('maps the exact missing canvas-profile rejection without exposing guest data', () => {
    const result = fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      cause: {
        guestName: 'CapsuleDOMError',
        guestMessage: 'The canvas element is not allowed',
        guestStack: '/private/host/path',
      },
    });

    expect(result).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'CANVAS_PROFILE_REQUIRED',
      fatal: true,
      message: 'Canvas rendering requires an exact Capsule canvas profile. '
        + 'Select canvas-2d-v1, canvas-webgl-v1, or canvas-webgpu-v1 to match '
        + 'the requested rendering context.',
    });
    expect(JSON.stringify(result)).not.toContain('/private/host/path');
  });

  test('maps the exact VM string budget rejection to renderer-neutral guidance', () => {
    const result = fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      cause: {
        guestName: 'CapsuleHostFunctionError',
        guestMessage: 'marshal_error: VM string exceeds the configured byte limit.',
        guestStack: '/private/host/path',
      },
    });

    expect(result).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'host',
      category: 'budget',
      capsuleCode: 'MESSAGE_BUDGET_EXCEEDED',
      fatal: true,
      message: 'The widget exceeded its Capsule message budget. Reduce or split '
        + 'the guest-host payload, or request a measured ui.budgets.messageBytes '
        + 'value within the host ceiling.',
    });
    expect(JSON.stringify(result)).not.toContain('/private/host/path');
  });

  test('maps the exact missing performance API rejection to frame-timestamp guidance', () => {
    const result = fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      cause: {
        guestName: 'ReferenceError',
        guestMessage: "'performance' is not defined",
        guestStack: '/private/host/path',
      },
    });

    expect(result).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'PERFORMANCE_API_UNAVAILABLE',
      fatal: true,
      message: 'Capsule widgets do not expose the ambient performance API. '
        + 'Use the monotonic timestamp passed to requestAnimationFrame callbacks '
        + 'for animation timing.',
    });
    expect(JSON.stringify(result)).not.toContain('/private/host/path');
  });

  test('uses the runtime fatal flag and classifies quota events as budget errors', () => {
    expect(fnMapCapsuleMountError({
      category: 'capability',
      code: 'RATE_LIMIT',
      fatal: false,
      capabilityId: 'vibecanvas.widget.functions.habc',
      operation: 'save',
    })).toEqual({
      format: 'vibecanvas.capsule-error.v1',
      phase: 'runtime',
      category: 'budget',
      capsuleCode: 'RATE_LIMIT',
      fatal: false,
      message: 'The widget exceeded a Capsule resource budget.',
      capability: 'vibecanvas.widget.functions.habc',
      operation: 'save',
    });
  });
});

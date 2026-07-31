import { describe, expect, test } from 'bun:test';
import {
  fnOmnidrawCapsuleApis,
  fnOmnidrawCapsuleBudgetRequest,
  fnOmnidrawCapsuleBuildPolicy,
} from '../src/build/fn.policy';
import { fnMapCapsuleBuildError } from '../src/build/fn.error';
import {
  OMNIDRAW_CAPSULE_PARKABILITY,
  OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID,
  OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID,
} from '../src/contract/CONSTANTS';
import { fnMapCapsuleApis } from '../src/contract/fn.apis';
import { fnMapCapsuleBudgetRequest } from '../src/contract/fn.budgets';
import {
  fnMapCapsuleHostError,
  fnMapCapsuleMountError,
  fnMapThrownCapsuleHostError,
} from '../src/host/fn.error';

describe('Capsule public API and budget mappings', () => {
  test('requires DOM and canonically orders public groups', () => {
    const source = ['WEBGL', 'DOM'] as const;
    expect(fnMapCapsuleApis(source)).toEqual(['DOM', 'WEBGL']);
    expect(fnOmnidrawCapsuleApis(source)).toEqual(['DOM', 'WEBGL']);
    expect(() => fnMapCapsuleApis(['WEBGL'])).toThrow(
      'Capsule API groups must be unique and explicitly include DOM.',
    );
    expect(() => fnMapCapsuleApis(['DOM', 'WEBGL', 'WEBGPU'])).toThrow(
      'CANVAS_2D, WEBGL, and WEBGPU are mutually exclusive.',
    );
  });

  test('preserves explicit zeroes, drops unknown keys, and enforces product ceilings', () => {
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
    expect(fnOmnidrawCapsuleBudgetRequest({ gpuBytes: 1 })).toEqual({
      gpuBytes: 1,
    });
    expect(() => fnOmnidrawCapsuleBudgetRequest({
      gpuBytes: 64 * 1024 * 1024 + 1,
    })).toThrow("Capsule budget 'gpuBytes' exceeds Omnidraw policy.");
  });

  test('owns only intentional policy overrides and fixed signing identities', () => {
    expect(fnOmnidrawCapsuleBuildPolicy()).toEqual({
      maxFiles: 1_024,
      maxFileBytes: 4 * 1024 * 1024,
      maxTotalBytes: 32 * 1024 * 1024,
      maxPathBytes: 256,
      maxPathDepth: 24,
      maxModules: 1_024,
      maxOutputBytes: 16 * 1024 * 1024,
      budgetCeilings: { gpuBytes: 64 * 1024 * 1024 },
    });
    expect(OMNIDRAW_CAPSULE_PREVIEW_SIGNING_KEY_ID).toBe('omnidraw-preview-v1');
    expect(OMNIDRAW_CAPSULE_RELEASE_SIGNING_KEY_ID).toBe('omnidraw-release-v1');
    expect(OMNIDRAW_CAPSULE_PARKABILITY).toEqual({ parkable: false });
  });
});

describe('Capsule error mappings', () => {
  test('maps build and host codes without forwarding private diagnostics', () => {
    expect(fnMapCapsuleBuildError('UNSUPPORTED_SYNTAX')).toEqual({
      format: 'omnidraw.capsule-error.v1',
      phase: 'build',
      category: 'build',
      capsuleCode: 'UNSUPPORTED_SYNTAX',
      fatal: true,
      message: 'The widget UI build failed.',
    });
    expect(fnMapCapsuleBuildError('BUILD_LIMIT_EXCEEDED').category).toBe('budget');
    expect(fnMapCapsuleHostError('ARTIFACT_REJECTED').category).toBe('artifact');
    expect(fnMapCapsuleHostError('CHANNEL_QUOTA').category).toBe('budget');
    expect(fnMapCapsuleHostError('CAPABILITY_REJECTED').category).toBe('capability');
  });

  test('maps allowlisted renderer failures to public API guidance', () => {
    expect(fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      cause: {
        code: 'guest_error',
        guestMessage: 'Error creating WebGL context.',
        guestStack: '/private/host/path',
      },
    })).toEqual({
      format: 'omnidraw.capsule-error.v1',
      phase: 'host',
      category: 'capability',
      capsuleCode: 'WEBGL_CONTEXT_UNAVAILABLE',
      fatal: true,
      message: 'WebGL Preview requires browser WebGL2 support and the public '
        + 'WEBGL API group. Add WEBGL to ui.apis.',
    });
  });

  test('keeps generic byte failures renderer-neutral', () => {
    const result = fnMapThrownCapsuleHostError({
      code: 'MOUNT_FAILED',
      cause: {
        guestName: 'CapsuleHostFunctionError',
        guestMessage: 'marshal_error: VM string exceeds the configured byte limit.',
        guestStack: '/private/host/path',
      },
    });
    expect(result.capsuleCode).toBe('MESSAGE_BUDGET_EXCEEDED');
    expect(result.message).not.toContain('WebGL');
    expect(JSON.stringify(result)).not.toContain('/private/host/path');
  });

  test('uses runtime fatal state and classifies quota events as budget errors', () => {
    expect(fnMapCapsuleMountError({
      category: 'capability',
      code: 'RATE_LIMIT',
      fatal: false,
      capabilityId: 'omnidraw.widget.functions.habc',
      operation: 'save',
    })).toMatchObject({
      phase: 'runtime',
      category: 'budget',
      capsuleCode: 'RATE_LIMIT',
      fatal: false,
    });
  });
});

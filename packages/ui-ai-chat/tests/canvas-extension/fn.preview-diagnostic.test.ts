import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { fnNormalizePreviewDiagnostic } from '../../src/canvas-extension/fn.preview-diagnostic';

const BASE_ARGS = Object.freeze({
  phase: 'mounting' as const,
  draftRevision: 'a'.repeat(64),
  previewRevisionId: 'preview-revision',
  buildSequence: 1,
  timestampMs: 123,
  encodeFingerprint: (value: string) => Buffer.from(value, 'utf8'),
  digestSha256: async (value: Uint8Array) => (
    createHash('sha256').update(value).digest('hex')
  ),
});

describe('Preview diagnostic normalization', () => {
  test('preserves the product-owned WebGL recovery message and stable code', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        format: 'vibecanvas.capsule-error.v1',
        phase: 'host',
        category: 'capability',
        capsuleCode: 'WEBGL_CONTEXT_UNAVAILABLE',
        fatal: true,
        message: 'host-controlled text is not forwarded',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'capability',
      phase: 'mounting',
      code: 'WEBGL_CONTEXT_UNAVAILABLE',
      message: 'WebGL Preview requires browser WebGL2 support and the public '
        + 'WEBGL API group. Add WEBGL to ui.apis.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('host-controlled text');
  });

  test('preserves the product-owned missing rendering-group recovery message', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        format: 'vibecanvas.capsule-error.v1',
        phase: 'host',
        category: 'capability',
        capsuleCode: 'CANVAS_PROFILE_REQUIRED',
        fatal: true,
        message: 'guest-controlled text is not forwarded',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'capability',
      phase: 'mounting',
      code: 'CANVAS_PROFILE_REQUIRED',
      message: 'Canvas rendering requires the matching public Capsule API group: '
        + 'CANVAS_2D, WEBGL, or WEBGPU.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('guest-controlled text');
  });

  test('preserves the product-owned renderer-neutral message-budget recovery message', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        format: 'vibecanvas.capsule-error.v1',
        phase: 'host',
        category: 'budget',
        capsuleCode: 'MESSAGE_BUDGET_EXCEEDED',
        fatal: true,
        message: 'guest-controlled text is not forwarded',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'budget',
      phase: 'mounting',
      code: 'MESSAGE_BUDGET_EXCEEDED',
      message: 'The widget exceeded its Capsule message budget. Reduce or split '
        + 'the guest-host payload, or request a measured ui.budgets.messageBytes '
        + 'value within the host ceiling.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('guest-controlled text');
  });

  test('preserves the product-owned frame-timestamp recovery message', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        format: 'vibecanvas.capsule-error.v1',
        phase: 'host',
        category: 'capability',
        capsuleCode: 'PERFORMANCE_API_UNAVAILABLE',
        fatal: true,
        message: 'guest-controlled text is not forwarded',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'capability',
      phase: 'mounting',
      code: 'PERFORMANCE_API_UNAVAILABLE',
      message: 'Capsule widgets do not expose the ambient performance API. '
        + 'Use the monotonic timestamp passed to requestAnimationFrame callbacks '
        + 'for animation timing.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('guest-controlled text');
  });
});

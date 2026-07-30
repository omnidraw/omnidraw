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
  test('retains only normalized bounded authored source fields in the fingerprint', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'guest',
        capsuleCode: 'GUEST_EXCEPTION',
        file: 'widget://src/App.tsx',
        line: 4,
        column: 7,
        message: '/private/build/src/App.tsx must not cross the boundary',
      },
    });
    expect(diagnostic).toMatchObject({
      origin: 'guest',
      file: 'widget://src/App.tsx',
      line: 4,
      column: 7,
    });
    expect(JSON.stringify(diagnostic)).not.toContain('/private/build');
  });

  test('omits authored coordinates outside the product diagnostic ceiling', async () => {
    const invalidLine = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        file: 'widget://src/App.tsx',
        line: 10_000_001,
        column: 1,
      },
    });
    expect(invalidLine).toMatchObject({ file: 'widget://src/App.tsx' });
    expect(invalidLine).not.toHaveProperty('line');
    expect(invalidLine).not.toHaveProperty('column');

    const invalidColumn = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        file: 'widget://src/App.tsx',
        line: 1,
        column: 10_000_001,
      },
    });
    expect(invalidColumn).toMatchObject({
      file: 'widget://src/App.tsx',
      line: 1,
    });
    expect(invalidColumn).not.toHaveProperty('column');
  });

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

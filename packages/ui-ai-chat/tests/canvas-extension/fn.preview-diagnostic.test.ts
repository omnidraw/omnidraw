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
        format: 'omnidraw.capsule-error.v1',
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
        format: 'omnidraw.capsule-error.v1',
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
        format: 'omnidraw.capsule-error.v1',
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
        format: 'omnidraw.capsule-error.v1',
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

  test('names the rejected server-function capability and operation with a bridge remediation', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        format: 'omnidraw.capsule-error.v1',
        phase: 'runtime',
        category: 'capability',
        capsuleCode: 'CAPABILITY_NOT_FOUND',
        fatal: true,
        capability: `omnidraw.widget.functions.h${'a'.repeat(64)}`,
        operation: 'count',
        message: 'guest-controlled text is not forwarded',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'capability',
      code: 'CAPABILITY_NOT_FOUND',
      capability: `omnidraw.widget.functions.h${'a'.repeat(64)}`,
      operation: 'count',
      remediation: 'generated-binding',
      retryability: 'non-retryable',
      message: 'The generated server-function binding was rejected by the Capsule '
        + 'bridge while initializing or calling the named operation. This is a '
        + 'generated binding/platform failure; widget source edits are unlikely '
        + 'to help.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('guest-controlled text');
  });

  test('produces an actionable capability-denial diagnostic', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'capability',
        capsuleCode: 'CAPABILITY_DENIED',
        capability: 'omnidraw.widget.collaborative_state',
        operation: 'change',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'capability',
      code: 'CAPABILITY_DENIED',
      capability: 'omnidraw.widget.collaborative_state',
      operation: 'change',
      remediation: 'platform',
      retryability: 'non-retryable',
      message: 'The Widget Preview capability named by this diagnostic was denied '
        + 'by the browser sandbox. Verify the widget manifest requests only '
        + 'declared public capabilities.',
    });
  });

  test('produces an actionable channel-rejection diagnostic', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'channel',
        capsuleCode: 'CHANNEL_REJECTED',
      },
    });

    expect(diagnostic).toMatchObject({
      origin: 'channel',
      code: 'CHANNEL_REJECTED',
      remediation: 'platform',
      message: 'The Widget Preview browser data channel was rejected before the '
        + 'guest could use it. Reload the Preview; if the rejection persists, '
        + 'the sandbox host is at fault rather than the widget source.',
    });
  });

  test('produces an actionable unsupported-operation diagnostic', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'capability',
        capsuleCode: 'OPERATION_NOT_FOUND',
        capability: 'omnidraw.widget.collaborative_state',
        operation: 'get',
      },
    });

    expect(diagnostic).toMatchObject({
      code: 'OPERATION_NOT_FOUND',
      operation: 'get',
      retryability: 'non-retryable',
      message: 'The guest attempted an operation the granted Capsule capability '
        + 'does not support. Regenerate the widget so requested operations match '
        + 'the capability descriptor.',
    });
  });

  test('derives retryability and remediation from bounded codes', async () => {
    const retryable = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: { category: 'budget', capsuleCode: 'RATE_LIMIT' },
    });
    expect(retryable).toMatchObject({
      retryability: 'retryable',
      remediation: 'budget',
    });

    const guest = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'vm',
        capsuleCode: 'GUEST_EXCEPTION',
        file: 'widget://ui/main.ts',
        line: 1,
      },
    });
    expect(guest).toMatchObject({
      retryability: 'unknown',
      remediation: 'widget-source',
    });

    const unmappedGuest = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: { category: 'vm', capsuleCode: 'GUEST_EXCEPTION' },
    });
    expect(unmappedGuest).not.toHaveProperty('remediation');
  });

  test('does not misclassify server provider failures as generated binding failures', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'capability',
        capsuleCode: 'PROVIDER_FAILED',
        capability: `omnidraw.widget.functions.h${'a'.repeat(64)}`,
        operation: 'count',
      },
    });

    expect(diagnostic).toMatchObject({
      code: 'PROVIDER_FAILED',
      capability: `omnidraw.widget.functions.h${'a'.repeat(64)}`,
      operation: 'count',
      retryability: 'unknown',
    });
    expect(diagnostic).not.toHaveProperty('remediation');
    expect(diagnostic.message).not.toContain('generated binding/platform failure');
  });

  test('drops malformed capability and operation identifiers', async () => {
    const diagnostic = await fnNormalizePreviewDiagnostic({
      ...BASE_ARGS,
      error: {
        category: 'capability',
        capsuleCode: 'CAPABILITY_DENIED',
        capability: ' omnidraw.widget.functions.h bad',
        operation: '../../etc/passwd\nleak',
        message: 'guest text',
      },
    });

    expect(diagnostic).toMatchObject({
      code: 'CAPABILITY_DENIED',
      remediation: 'platform',
    });
    expect(diagnostic).not.toHaveProperty('capability');
    expect(diagnostic).not.toHaveProperty('operation');
    expect(JSON.stringify(diagnostic)).not.toContain('passwd');
  });
});

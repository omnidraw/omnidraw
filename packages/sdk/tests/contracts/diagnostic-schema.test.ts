import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  ZWidgetDiagnostic,
  fnNormalizeWidgetBuildError,
  fnWidgetDiagnosticFingerprint,
} from '@omnidraw/sdk/contract';

const base = {
  origin: 'build' as const,
  phase: 'bundling',
  code: 'WIDGET_BUILD_FAILED',
  file: 'widget://ui/main.ts',
  line: 7,
  column: 3,
  buildId: 'build-1',
  previewRevisionId: 'preview-revision-1',
};

describe('widget diagnostic contract', () => {
  test('accepts one bounded transport-neutral diagnostic', () => {
    const fingerprint = fnWidgetDiagnosticFingerprint({
      diagnostic: base,
      digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
    });

    expect(ZWidgetDiagnostic.parse({
      formatVersion: 1,
      fingerprint,
      ...base,
      severity: 'error',
      message: 'The widget bundle could not be created.',
      trust: 'trusted',
      draftRevision: 'a'.repeat(64),
      previewRevisionId: 'preview-revision-1',
      buildSequence: 2,
      occurrenceCount: 1,
      retryability: 'retryable',
      timestampMs: 123,
    })).toMatchObject({
      fingerprint,
      file: 'widget://ui/main.ts',
      buildSequence: 2,
    });
  });

  test('fingerprints authority-relevant fields without guest message text', () => {
    const digestSha256 = (value: string) => createHash('sha256').update(value).digest('hex');
    const first = fnWidgetDiagnosticFingerprint({ diagnostic: base, digestSha256 });
    const second = fnWidgetDiagnosticFingerprint({
      diagnostic: { ...base, code: 'WIDGET_BUILD_TIMEOUT' },
      digestSha256,
    });
    const anotherBuild = { ...base, buildId: 'build-2' };
    const sameFailureFromAnotherBuild = fnWidgetDiagnosticFingerprint({
      diagnostic: anotherBuild,
      digestSha256,
    });
    const sameBuildFromAnotherPreviewRevision = fnWidgetDiagnosticFingerprint({
      diagnostic: { ...base, previewRevisionId: 'preview-revision-2' },
      digestSha256,
    });

    expect(first).toHaveLength(64);
    expect(second).not.toBe(first);
    expect(sameFailureFromAnotherBuild).not.toBe(first);
    expect(sameBuildFromAnotherPreviewRevision).not.toBe(first);
  });

  test('rejects host paths, control characters, and partial source locations', () => {
    const common = {
      formatVersion: 1,
      fingerprint: 'a'.repeat(64),
      origin: 'guest',
      phase: 'runtime',
      code: 'WIDGET_GUEST_FAILED',
      severity: 'error',
      message: 'Guest runtime failed.',
      trust: 'untrusted',
      draftRevision: 'b'.repeat(64),
      previewRevisionId: null,
      buildId: 'build-2',
      buildSequence: 1,
      occurrenceCount: 1,
      retryability: 'unknown',
      timestampMs: 456,
    } as const;

    expect(ZWidgetDiagnostic.safeParse({
      ...common,
      file: '/Users/example/private.ts',
      line: 1,
    }).success).toBe(false);
    expect(ZWidgetDiagnostic.safeParse({
      ...common,
      message: 'bad\u0000message',
    }).success).toBe(false);
    expect(ZWidgetDiagnostic.safeParse({
      ...common,
      column: 4,
    }).success).toBe(false);
  });

  test('accepts only bounded remediation categories', () => {
    const common = {
      formatVersion: 1,
      fingerprint: 'a'.repeat(64),
      origin: 'capability',
      phase: 'mounting',
      code: 'CAPABILITY_DENIED',
      severity: 'error',
      message: 'A widget capability was denied.',
      trust: 'untrusted',
      draftRevision: 'b'.repeat(64),
      previewRevisionId: null,
      buildId: 'build-2',
      buildSequence: 1,
      occurrenceCount: 1,
      retryability: 'non-retryable',
      timestampMs: 456,
    } as const;

    expect(ZWidgetDiagnostic.parse({
      ...common,
      remediation: 'generated-binding',
    })).toMatchObject({ remediation: 'generated-binding' });
    expect(ZWidgetDiagnostic.safeParse({
      ...common,
      remediation: 'check /private/tmp/build.log for details',
    }).success).toBe(false);
    expect(ZWidgetDiagnostic.safeParse({
      ...common,
      remediation: 'widget-source\u0007',
    }).success).toBe(false);
  });

  test('normalizes thrown runner failures without exposing host paths', () => {
    const diagnostic = fnNormalizeWidgetBuildError({
      error: Object.assign(new Error('build failed'), {
        diagnostic: {
          code: 'WIDGET_COMMAND_FAILED',
          construct: 'npm run build',
          reason: [
            '/private/tmp/widget-build-123/ui/main.ts:17:4: Unexpected token',
            '/Users/example/.config/secret.env',
          ].join('\n'),
        },
      }),
      draftRevision: 'c'.repeat(64),
      previewRevisionId: null,
      buildId: 'build-3',
      buildSequence: 3,
      timestampMs: 789,
      digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
    });

    expect(ZWidgetDiagnostic.parse(diagnostic)).toMatchObject({
      origin: 'build',
      phase: 'building',
      code: 'WIDGET_COMMAND_FAILED',
      file: 'widget://ui/main.ts',
      line: 17,
      column: 4,
      trust: 'untrusted',
    });
    expect(diagnostic.message).toContain('ui/main.ts:17:4');
    expect(diagnostic.message).not.toContain('/private/tmp');
    expect(diagnostic.message).not.toContain('/Users/example');
  });

  test('preserves bounded builder metadata locations and classifies source/server phases', () => {
    const digestSha256 = (value: string) => (
      createHash('sha256').update(value).digest('hex')
    );
    const server = fnNormalizeWidgetBuildError({
      error: Object.assign(new Error('Widget server build failed.'), {
        code: 'WIDGET_BUILD_FAILED',
        diagnostic: {
          code: 'BUN_BUILD_ERROR',
          path: 'server/actions.ts',
          line: 23,
          column: 8,
          reason: 'Unknown export.',
        },
      }),
      draftRevision: 'd'.repeat(64),
      previewRevisionId: null,
      buildId: 'build-4',
      buildSequence: 4,
      timestampMs: 790,
      digestSha256,
    });
    const source = fnNormalizeWidgetBuildError({
      error: Object.assign(new Error('Manifest validation failed.'), {
        code: 'WIDGET_MANIFEST_INVALID',
      }),
      draftRevision: 'e'.repeat(64),
      previewRevisionId: null,
      buildId: 'build-5',
      buildSequence: 5,
      timestampMs: 791,
      digestSha256,
    });

    expect(ZWidgetDiagnostic.parse(server)).toMatchObject({
      origin: 'server',
      phase: 'server-building',
      file: 'widget://server/actions.ts',
      line: 23,
      column: 8,
    });
    expect(ZWidgetDiagnostic.parse(source)).toMatchObject({
      origin: 'source',
      phase: 'validating',
      code: 'WIDGET_MANIFEST_INVALID',
    });
  });
});

import { z } from 'zod';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const PHASE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const WIDGET_PATH_PATTERN = /^widget:\/\/(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[^\u0000-\u001f\u007f]+$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,299}$/;

export const WIDGET_DIAGNOSTIC_FORMAT_VERSION = 1 as const;

export const ZWidgetDiagnostic = z.object({
  formatVersion: z.literal(WIDGET_DIAGNOSTIC_FORMAT_VERSION),
  fingerprint: z.string().regex(SHA256_PATTERN),
  origin: z.enum([
    'source',
    'install',
    'build',
    'server',
    'capsule',
    'host',
    'guest',
    'capability',
    'channel',
    'budget',
    'lifecycle',
  ]),
  phase: z.string().regex(PHASE_PATTERN),
  code: z.string().regex(CODE_PATTERN),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string().trim().min(1).max(2_000)
    .regex(/^[^\u0000-\u001f\u007f]*$/, 'Diagnostic messages cannot contain control characters.'),
  trust: z.enum(['trusted', 'untrusted']),
  draftRevision: z.string().regex(SHA256_PATTERN),
  previewRevisionId: z.string().regex(ID_PATTERN).nullable(),
  buildId: z.string().regex(ID_PATTERN),
  buildSequence: z.number().int().min(1),
  occurrenceCount: z.number().int().min(1).max(1_000_000),
  retryability: z.enum(['retryable', 'non-retryable', 'unknown']),
  timestampMs: z.number().int().min(0),
  file: z.string().max(1_000).regex(WIDGET_PATH_PATTERN).optional(),
  line: z.number().int().min(1).max(10_000_000).optional(),
  column: z.number().int().min(1).max(10_000_000).optional(),
  capability: z.string().regex(ID_PATTERN).optional(),
  operation: z.string().regex(ID_PATTERN).optional(),
  budgetDimension: z.string().regex(ID_PATTERN).optional(),
  causeFingerprint: z.string().regex(SHA256_PATTERN).optional(),
}).strict().superRefine((diagnostic, context) => {
  if ((diagnostic.line !== undefined || diagnostic.column !== undefined) && diagnostic.file === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['file'],
      message: 'A diagnostic source location requires a normalized widget:// file.',
    });
  }
  if (diagnostic.column !== undefined && diagnostic.line === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['line'],
      message: 'A diagnostic column requires a source line.',
    });
  }
});

export type TWidgetDiagnostic = z.infer<typeof ZWidgetDiagnostic>;

export type TWidgetDiagnosticFingerprintInput = Pick<
  TWidgetDiagnostic,
  | 'origin'
  | 'phase'
  | 'code'
  | 'file'
  | 'line'
  | 'column'
  | 'capability'
  | 'operation'
  | 'budgetDimension'
  | 'buildId'
  | 'previewRevisionId'
>;

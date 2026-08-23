import { z } from 'zod';
import { MIME_TYPES } from './CONSTANTS';

export const ZJson: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(ZJson),
  z.record(z.string(), ZJson.optional()),
]));

export const ZTimestampSec = z.string().regex(
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  'Expected a UTC whole-second database timestamp.',
);
export const ZBlob = z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]);
export const ZSqlBoolean = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean);
export const ZMimeType = z.enum(MIME_TYPES);
export const ZDbResourceDraftStatus = z.enum(['editing', 'applying', 'applied', 'discarded', 'error']);
export const ZDbResourceDraftChangeKind = z.enum(['structure', 'sql']);
export const ZDbResourceApplyStatus = z.enum(['preparing', 'applying', 'succeeded', 'failed', 'recovered']);

export const ZCanvas = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative(),
  createdAtSec: ZTimestampSec,
  updatedAtSec: ZTimestampSec,
});

export const ZMediaFile = z.object({
  id: z.string(),
  canvasId: z.string().nullable(),
  hash: z.string(),
  digestSha256: z.string().nullable(),
  mimeType: ZMimeType,
  data: ZBlob,
  createdAtSec: ZTimestampSec,
});

export const ZChat = z.object({
  id: z.string(),
  canvasId: z.string().nullable(),
  name: z.string(),
  status: z.enum(['active', 'archived', 'error']),
  workspaceRelativePath: z.string(),
  historyRelativePath: z.string(),
  createdAtSec: ZTimestampSec,
  updatedAtSec: ZTimestampSec,
});

export const ZDbResourceDraft = z.object({
  id: z.string(),
  resourceId: z.string(),
  name: z.string(),
  status: ZDbResourceDraftStatus,
  lastError: ZJson.nullable(),
  createdAtSec: ZTimestampSec,
  updatedAtSec: ZTimestampSec,
  appliedAtSec: ZTimestampSec.nullable(),
});

export const ZDbResourceDraftChange = z.object({
  draftId: z.string(),
  sequence: z.number().int().positive(),
  kind: ZDbResourceDraftChangeKind,
  operation: ZJson.nullable(),
  sql: z.string(),
  createdAtSec: ZTimestampSec,
});

export const ZDbResourceApplyRun = z.object({
  id: z.string(),
  resourceId: z.string(),
  draftId: z.string().nullable(),
  sourceApplyId: z.string().nullable(),
  status: ZDbResourceApplyStatus,
  lastError: ZJson.nullable(),
  backupRetained: ZSqlBoolean,
  createdAtSec: ZTimestampSec,
  completedAtSec: ZTimestampSec.nullable(),
});

export type TJson = z.infer<typeof ZJson>;
export type TKeyValue =
  | { name: string; type: 'text'; value: string }
  | { name: string; type: 'json'; value: TJson }
  | { name: string; type: 'number'; value: number }
  | { name: string; type: 'bool'; value: boolean }
  | { name: string; type: 'blob'; value: Uint8Array };
export type TEncryptionKey = {
  id: string;
  resourceId: string;
  purpose: string;
  algorithm: string;
  keyHex: string;
  createdAtSec: string;
};
export type TTimestampSec = z.infer<typeof ZTimestampSec>;
export type TBlob = z.infer<typeof ZBlob>;
export type TSqlBoolean = z.infer<typeof ZSqlBoolean>;
export type TFileFormat = z.infer<typeof ZMimeType>;
export type TDbResourceDraftStatus = z.infer<typeof ZDbResourceDraftStatus>;
export type TDbResourceDraftChangeKind = z.infer<typeof ZDbResourceDraftChangeKind>;
export type TDbResourceApplyStatus = z.infer<typeof ZDbResourceApplyStatus>;
export type TCanvas = z.infer<typeof ZCanvas>;
export type TMediaFile = z.infer<typeof ZMediaFile>;
export type TFile = TMediaFile;
export type TChat = z.infer<typeof ZChat>;
export type TDbResourceDraft = z.infer<typeof ZDbResourceDraft>;
export type TDbResourceDraftChange = z.infer<typeof ZDbResourceDraftChange>;
export type TDbResourceApplyRun = z.infer<typeof ZDbResourceApplyRun>;

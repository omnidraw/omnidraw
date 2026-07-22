import { oc } from '@orpc/contract';
import {
  ZWidgetBrowserFunctionDescriptors,
} from '@vibecanvas/widget-contract';
import { z } from 'zod';

const IDENTIFIER_MAX_LENGTH = 200;
const ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const ARTIFACT_MAX_BASE64_LENGTH = Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4;
const ZIdentifier = z.string().min(1).max(IDENTIFIER_MAX_LENGTH);

export const ZWidgetRuntimeIdentity = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  widgetInstanceId: ZIdentifier,
  definitionId: ZIdentifier,
  revisionId: ZIdentifier,
}).strict();

export const ZWidgetRuntimeLoadInput = ZWidgetRuntimeIdentity;

export const ZWidgetBrowserManifest = z.object({
  schemaVersion: z.literal(2),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  ui: z.object({ entry: z.string() }).strict(),
}).strict();

export const ZWidgetRuntimeLoadOutput = z.object({
  identity: ZWidgetRuntimeIdentity,
  manifest: ZWidgetBrowserManifest,
  artifact: z.object({
    digestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytesBase64: z.string().max(ARTIFACT_MAX_BASE64_LENGTH).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict(),
  functionDescriptors: ZWidgetBrowserFunctionDescriptors,
}).strict();

const widgetContract = oc.router({
  runtime: oc.router({
    load: oc.input(ZWidgetRuntimeLoadInput).output(ZWidgetRuntimeLoadOutput),
  }),
});

export { widgetContract };

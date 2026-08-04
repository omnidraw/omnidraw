/** @file Strict runtime schema for generated server-function registrations. */

import { z } from 'zod';

import {
  fnNormalizeWidgetBrowserFunctionDescriptor,
  fnNormalizeWidgetBrowserFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
  fnNormalizeWidgetServerFunctionDescriptors,
} from './core/fn.function-descriptor';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetSerializableJsonObject,
  TWidgetServerFunctionDescriptor,
} from './types';

const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
const MODULE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)(?!.*\0)[^/]+(?:\/[^/]+)*\.(?:[cm]?[jt]sx?)$/;

const ZSerializableJson = z.json();
const ZJsonSchema = ZSerializableJson.refine(
  (value) => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  ),
  'Runtime schemas must be JSON objects.',
) as unknown as z.ZodType<TWidgetSerializableJsonObject>;

const ZWidgetServerFunctionResourceAccess = z.object({
  slot: z.string().regex(SLOT_PATTERN),
  effect: z.enum(['read', 'write', 'read_write']),
}).strict();

const ZWidgetServerFunctionDescriptorObject = z.object({
  schemaVersion: z.literal(1),
  exportName: z.string().regex(EXPORT_NAME_PATTERN),
  modulePath: z.string().max(500).regex(MODULE_PATH_PATTERN).optional(),
  effect: z.enum(['fn', 'fx', 'tx']),
  inputSchema: ZJsonSchema,
  outputSchema: ZJsonSchema,
  resources: z.array(ZWidgetServerFunctionResourceAccess).max(64),
  limits: z.object({
    timeoutMs: z.number().int().min(1).max(30_000),
    memoryTier: z.enum(['small', 'medium', 'large']),
    outputByteLimit: z.number().int().min(1).max(1_048_576),
    logByteLimit: z.number().int().min(0).max(1_048_576),
  }).strict(),
}).strict();

type TFunctionDescriptorRules = Pick<
  TWidgetServerFunctionDescriptor,
  'effect' | 'resources'
>;

function refineFunctionDescriptor(
  descriptor: TFunctionDescriptorRules,
  context: z.RefinementCtx,
): void {
  const slots = new Set<string>();
  descriptor.resources.forEach((resource, index) => {
    if (slots.has(resource.slot)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate function resource slot: ${resource.slot}`,
        path: ['resources', index, 'slot'],
      });
    }
    slots.add(resource.slot);
    if (descriptor.effect === 'fn') {
      context.addIssue({
        code: 'custom',
        message: 'fn functions cannot declare resources.',
        path: ['resources', index],
      });
    }
    if (descriptor.effect === 'fx' && resource.effect !== 'read') {
      context.addIssue({
        code: 'custom',
        message: 'fx functions may declare only read resources.',
        path: ['resources', index, 'effect'],
      });
    }
  });
}

const ZWidgetServerFunctionDescriptorShape = ZWidgetServerFunctionDescriptorObject
  .superRefine(refineFunctionDescriptor);

const ZWidgetBrowserFunctionDescriptorShape = ZWidgetServerFunctionDescriptorObject
  .omit({ modulePath: true })
  .strict()
  .superRefine(refineFunctionDescriptor);

export const ZWidgetServerFunctionDescriptor: z.ZodType<TWidgetServerFunctionDescriptor> =
  ZWidgetServerFunctionDescriptorShape.transform((descriptor) => (
    fnNormalizeWidgetServerFunctionDescriptor(descriptor)
  ));

export const ZWidgetBrowserFunctionDescriptor: z.ZodType<TWidgetBrowserFunctionDescriptor> =
  ZWidgetBrowserFunctionDescriptorShape.transform(
    fnNormalizeWidgetBrowserFunctionDescriptor,
  );

export const ZWidgetServerFunctionDescriptors = z.array(ZWidgetServerFunctionDescriptor)
  .max(128)
  .superRefine((descriptors, context) => {
    const exports = new Set<string>();
    descriptors.forEach((descriptor, index) => {
      if (exports.has(descriptor.exportName)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate server-function export: ${descriptor.exportName}`,
          path: [index, 'exportName'],
        });
      }
      exports.add(descriptor.exportName);
    });
  })
  .transform(fnNormalizeWidgetServerFunctionDescriptors);

export const ZWidgetBrowserFunctionDescriptors = z.array(ZWidgetBrowserFunctionDescriptor)
  .max(128)
  .superRefine((descriptors, context) => {
    const exports = new Set<string>();
    descriptors.forEach((descriptor, index) => {
      if (exports.has(descriptor.exportName)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate server-function export: ${descriptor.exportName}`,
          path: [index, 'exportName'],
        });
      }
      exports.add(descriptor.exportName);
    });
  })
  .transform(fnNormalizeWidgetBrowserFunctionDescriptors);

/**
 * @file Strict runtime schema for the current widget manifest contract.
 */

import { z } from 'zod';

import {
  fnNormalizeWidgetManifest,
  fnNormalizeWidgetRelativePath,
} from './core/fn.manifest';
import type { TWidgetManifestV2 } from './types';

const SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,127}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUNTIME_ABI_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,99}$/;
const BUILD_ENTRY_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

const ZWidgetRelativePath = z.string().superRefine((value, context) => {
  if (fnNormalizeWidgetRelativePath(value) === null) {
    context.addIssue({
      code: 'custom',
      message: 'Expected a safe relative path without traversal, URLs, or empty segments',
    });
  }
}).transform((value) => fnNormalizeWidgetRelativePath(value)!);

const ZWidgetBuildEntryPath = ZWidgetRelativePath.refine(
  (value) => BUILD_ENTRY_PATTERN.test(value),
  'Widget build entries must use a JavaScript or TypeScript extension',
);

const ZResourceOperationParameterDeclaration = z.object({
  type: z.enum(['string', 'number', 'boolean', 'bigint', 'bytes', 'json']),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
}).strict();

const ZResourceNamedOperation = z.object({
  effect: z.enum(['read', 'write']),
  sql: z.string().min(1).max(100_000),
  parameters: z.record(
    z.string().regex(NAME_PATTERN),
    ZResourceOperationParameterDeclaration,
  ).optional(),
  result: z.enum(['rows', 'execute']),
}).strict();

const ZWidgetResourceRequirement = z.object({
  slot: z.string().regex(SLOT_PATTERN),
  kind: z.enum(['kv', 'secretStore', 'db']),
  effect: z.enum(['read', 'write', 'read_write']),
  required: z.boolean().optional(),
  arbitrarySql: z.boolean().optional(),
  operations: z.record(z.string().regex(NAME_PATTERN), ZResourceNamedOperation).optional(),
}).strict().superRefine((requirement, context) => {
  if (
    requirement.kind !== 'db'
    && (requirement.arbitrarySql !== undefined || requirement.operations !== undefined)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Only database requirements may declare SQL operations',
    });
  }

  for (const [operationName, operation] of Object.entries(requirement.operations ?? {})) {
    if (requirement.effect !== 'read_write' && requirement.effect !== operation.effect) {
      context.addIssue({
        code: 'custom',
        message: `${operation.effect} operation exceeds the ${requirement.effect} resource ceiling`,
        path: ['operations', operationName, 'effect'],
      });
    }
  }
});

const ZWidgetManifestV2Shape = z.object({
  schemaVersion: z.literal(2),
  name: z.string().trim().min(1).max(200),
  slug: z.string().min(1).max(100).regex(SLUG_PATTERN),
  description: z.string().trim().min(1).max(2_000).optional(),
  ui: z.object({
    entry: ZWidgetBuildEntryPath,
  }).strict(),
  server: z.object({
    entry: ZWidgetBuildEntryPath,
    runtimeAbi: z.string().min(1).max(100).regex(RUNTIME_ABI_PATTERN),
  }).strict().optional(),
  resources: z.array(ZWidgetResourceRequirement).max(64).superRefine((resources, context) => {
    const slots = new Set<string>();
    resources.forEach((requirement, index) => {
      if (slots.has(requirement.slot)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate resource slot: ${requirement.slot}`,
          path: [index, 'slot'],
        });
      }
      slots.add(requirement.slot);
    });
  }).optional(),
}).strict();

export const ZWidgetManifestV2: z.ZodType<TWidgetManifestV2> = ZWidgetManifestV2Shape
  .transform((manifest) => fnNormalizeWidgetManifest(manifest));

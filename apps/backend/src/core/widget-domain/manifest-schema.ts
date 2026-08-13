/**
 * @file Strict runtime schemas for the Capsule-native widget manifest contract.
 */

import { z } from 'zod';

import {
  fnNormalizeWidgetRelativePath,
} from './fn.manifest';
import { WIDGET_CAPSULE_API_GROUPS } from './CONSTANTS';
import type {
  TWidgetCapsuleBudgetRequest,
  TWidgetCapsuleBudgets,
  TWidgetCapsuleApiGroup,
  TWidgetCapsuleCapabilityRequest,
  TWidgetCapsuleChannelContract,
  TWidgetCapsuleHash,
  TWidgetCapsuleParkability,
  TWidgetCapsuleSchemaReference,
} from './types';

const SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,127}$/;
const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CAPSULE_CAPABILITY_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)+$/;
const CAPSULE_OPERATION_PATTERN = /^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const CAPSULE_VERSION_RANGE_PATTERN =
  /^(?:\*|[\^~]?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;
const BUILD_ENTRY_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const CAPSULE_RENDERING_API_GROUPS = new Set<TWidgetCapsuleApiGroup>([
  'CANVAS_2D',
  'WEBGL',
  'WEBGPU',
]);

export const ZWidgetRelativePath = z.string().superRefine((value, context) => {
  if (fnNormalizeWidgetRelativePath(value) === null) {
    context.addIssue({
      code: 'custom',
      message: 'Expected a safe relative path without traversal, URLs, or empty segments',
    });
  }
}).transform((value) => fnNormalizeWidgetRelativePath(value)!);

export const ZWidgetBuildEntryPath = ZWidgetRelativePath.refine(
  (value) => BUILD_ENTRY_PATTERN.test(value),
  'Widget build entries must use a JavaScript or TypeScript extension',
);

const ZCapsuleHash = z.string().regex(CAPSULE_HASH_PATTERN)
  .transform((value): TWidgetCapsuleHash => value as TWidgetCapsuleHash);
const ZCapsuleIntegerBudget = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const ZWidgetCapsuleApiGroup = z.enum(WIDGET_CAPSULE_API_GROUPS);

export const ZWidgetCapsuleAllowedApis: z.ZodType<
  readonly TWidgetCapsuleApiGroup[]
> =
  z.array(ZWidgetCapsuleApiGroup).min(1).max(WIDGET_CAPSULE_API_GROUPS.length)
    .superRefine((apis, context) => {
      const seen = new Set<TWidgetCapsuleApiGroup>();
      apis.forEach((api, index) => {
        if (seen.has(api)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate Capsule API group: ${api}`,
            path: [index],
          });
        }
        seen.add(api);
      });
      if (!seen.has('DOM')) {
        context.addIssue({
          code: 'custom',
          message: 'Capsule API groups must explicitly include DOM',
        });
      }
    }).transform((apis) => (
      WIDGET_CAPSULE_API_GROUPS.filter((api) => apis.includes(api))
    ));

export const ZWidgetCapsuleApis = ZWidgetCapsuleAllowedApis.superRefine(
  (apis, context) => {
    if (apis.filter((api) => CAPSULE_RENDERING_API_GROUPS.has(api)).length > 1) {
      context.addIssue({
        code: 'custom',
        message: 'CANVAS_2D, WEBGL, and WEBGPU are mutually exclusive',
      });
    }
  },
);

const ZWidgetCapsuleBudgetsShape = z.object({
  cpuMs: z.number().finite().min(0),
  memoryBytes: ZCapsuleIntegerBudget,
  domNodes: ZCapsuleIntegerBudget,
  handles: ZCapsuleIntegerBudget,
  messageBytes: ZCapsuleIntegerBudget,
  streamBytes: ZCapsuleIntegerBudget,
  assetBytes: ZCapsuleIntegerBudget,
  networkBytes: ZCapsuleIntegerBudget,
  gpuBytes: ZCapsuleIntegerBudget,
  lifecycleBytes: ZCapsuleIntegerBudget,
}).strict();

export const ZWidgetCapsuleBudgets: z.ZodType<TWidgetCapsuleBudgets> =
  ZWidgetCapsuleBudgetsShape;

export const ZWidgetCapsuleBudgetRequest: z.ZodType<TWidgetCapsuleBudgetRequest> =
  ZWidgetCapsuleBudgetsShape.partial().strict();

export const ZWidgetCapsuleSchemaReference: z.ZodType<TWidgetCapsuleSchemaReference> = z.object({
  format: z.literal('capsule-schema-v1'),
  hash: ZCapsuleHash,
}).strict();

export const ZWidgetCapsuleCapabilityRequest: z.ZodType<TWidgetCapsuleCapabilityRequest> = z.object({
  id: z.string().max(255).regex(CAPSULE_CAPABILITY_ID_PATTERN),
  versionRange: z.string().max(64).regex(CAPSULE_VERSION_RANGE_PATTERN),
  contractHash: ZCapsuleHash,
  required: z.boolean(),
  operations: z.array(
    z.string().max(128).regex(CAPSULE_OPERATION_PATTERN),
  ).max(256).superRefine((operations, context) => {
    const seen = new Set<string>();
    operations.forEach((operation, index) => {
      if (seen.has(operation)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Capsule capability operation: ${operation}`,
          path: [index],
        });
      }
      seen.add(operation);
    });
  }),
}).strict();

export const ZWidgetCapsuleChannelContract: z.ZodType<TWidgetCapsuleChannelContract> = z.object({
  format: z.literal('capsule-guest-channels-v1'),
  lifecycle: z.literal(true).optional(),
  props: ZWidgetCapsuleSchemaReference.optional(),
  theme: ZWidgetCapsuleSchemaReference.optional(),
  output: ZWidgetCapsuleSchemaReference.optional(),
  store: z.object({
    schema: ZWidgetCapsuleSchemaReference,
    maxEntries: z.number().int().min(1).max(1_024),
  }).strict().optional(),
}).strict().superRefine((channels, context) => {
  if (
    channels.lifecycle !== true
    && channels.props === undefined
    && channels.theme === undefined
    && channels.output === undefined
    && channels.store === undefined
  ) {
    context.addIssue({
      code: 'custom',
      message: 'A Capsule channel contract must declare at least one channel',
    });
  }
});

export const ZWidgetCapsuleParkability: z.ZodType<TWidgetCapsuleParkability> = z.object({
  parkable: z.literal(false),
}).strict();

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

const ZWidgetExecutableResourceRequirementShape = z.object({
  slot: z.string().regex(SLOT_PATTERN),
  kind: z.enum(['kv', 'secretStore', 'db']),
  effect: z.enum(['read', 'write', 'read_write']),
  required: z.boolean().optional(),
  arbitrarySql: z.boolean().optional(),
  operations: z.record(z.string().regex(NAME_PATTERN), ZResourceNamedOperation).optional(),
}).strict();

function validateWidgetResourceRequirement(
  requirement: z.infer<typeof ZWidgetExecutableResourceRequirementShape>,
  context: z.RefinementCtx,
): void {
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
}

export const ZWidgetResourceId = z.string().min(1).max(128).regex(RESOURCE_ID_PATTERN);

export const ZWidgetExecutableResourceRequirement =
  ZWidgetExecutableResourceRequirementShape.superRefine(validateWidgetResourceRequirement);

export const ZWidgetResourceRequirement =
  ZWidgetExecutableResourceRequirementShape.extend({
    resourceId: ZWidgetResourceId.optional(),
  }).strict().superRefine(validateWidgetResourceRequirement);

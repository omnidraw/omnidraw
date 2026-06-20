import { z } from 'zod';

import type { TJsonSchema, TVibecanvasJson } from './types';

export const ZJsonSchemaPrimitiveType = z.enum([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'string',
  'integer',
]);

export const ZJsonSchema: z.ZodType<TJsonSchema> = z.lazy(() => z.union([
  z.boolean(),
  z.object({
    $id: z.string().optional(),
    $schema: z.string().optional(),
    $ref: z.string().optional(),
    $defs: z.record(z.string(), ZJsonSchema).optional(),
    definitions: z.record(z.string(), ZJsonSchema).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    type: z.union([ZJsonSchemaPrimitiveType, z.array(ZJsonSchemaPrimitiveType)]).optional(),
    enum: z.array(z.unknown()).optional(),
    const: z.unknown().optional(),
    default: z.unknown().optional(),
    examples: z.array(z.unknown()).optional(),
    properties: z.record(z.string(), ZJsonSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), ZJsonSchema]).optional(),
    items: z.union([ZJsonSchema, z.array(ZJsonSchema)]).optional(),
    additionalItems: z.union([z.boolean(), ZJsonSchema]).optional(),
    prefixItems: z.array(ZJsonSchema).optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    uniqueItems: z.boolean().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    exclusiveMaximum: z.number().optional(),
    multipleOf: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    format: z.string().optional(),
    anyOf: z.array(ZJsonSchema).optional(),
    oneOf: z.array(ZJsonSchema).optional(),
    allOf: z.array(ZJsonSchema).optional(),
    not: ZJsonSchema.optional(),
  }),
]));

export const ZActorState = z.string().regex(/^(booting|ready|busy|waiting|error)(\..*)?$/);
export const ZInputMessage = z.string().regex(/^in\..*$/);
export const ZOutputMessage = z.string().regex(/^out\..*$/);
export const ZFunctionName = z.string().regex(/^(fn|fx|tx)\..*$/);

export const ZTransition = z.object({
  func: z.array(ZFunctionName),
  allowedTargets: z.array(ZActorState),
});

export const ZVibecanvasActor = z.object({
  relFunctionPath: z.string(),
  initialState: ZActorState,
  initialData: z.record(z.string(), z.any()),
  dataSchema: ZJsonSchema.optional(),
  states: z.record(ZActorState, ZTransition),
  inputMsgSchema: z.record(ZInputMessage, ZJsonSchema).optional(),
  outputMsgSchema: z.record(ZOutputMessage, ZJsonSchema).optional(),
});

export const ZVibecanvasActorWidget = z.object({
  relWidgetDir: z.string(),
  tool: z.object({
    label: z.string(),
    icon: z.string().optional(),
    group: z.string().optional(),
    priority: z.number().optional(),
    behavior: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('mode'),
        mode: z.enum(['draw-create', 'click-create', 'select', 'hand']),
      }),
      z.object({
        type: z.literal('action'),
      }),
      z.object({
        type: z.literal('modal'),
      }),
    ]),
  }),
});

export const ZVibecanvasJson = z.object({
  slug: z.string(),
  name: z.string(),
  url: z.url().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  actor: ZVibecanvasActor,
  widget: ZVibecanvasActorWidget,
});

export type TZVibecanvasJson = z.infer<typeof ZVibecanvasJson> & TVibecanvasJson;

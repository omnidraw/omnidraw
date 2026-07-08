import { z } from 'zod';

import { LUCIDE_STATIC_ICON_KEYS, isLucideStaticIconKey } from './tool-icon';
import type { TActorData, TActorState, TFunctionName, TJsonSchema, TVibecanvasJson } from './types';
import type { TVibecanvasToolIcon } from './tool-icon';

export const ZJsonSchemaPrimitiveType = z.enum([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'string',
  'integer',
]);

export const ZActorData: z.ZodType<TActorData> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(ZActorData),
  z.record(z.string(), ZActorData.optional()),
]));

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

export const ZActorState = z.custom<TActorState>(
  (value) => typeof value === 'string' && /^(booting|ready|busy|waiting|error)(\..*)?$/.test(value),
);
export const ZInputMessage = z.string().min(1);
export const ZOutputMessage = z.string().min(1);
export const ZFunctionName = z.custom<TFunctionName>(
  (value) => typeof value === 'string' && /^(fn|fx|tx)\..*$/.test(value),
);

export const ZVibecanvasToolIcon: z.ZodType<TVibecanvasToolIcon> = z.object({
  lucidIcon: z.custom<string>(
    isLucideStaticIconKey,
    `expected one of: ${LUCIDE_STATIC_ICON_KEYS.join(', ')}`,
  ).optional(),
  svgIcon: z.string().min(1).optional(),
}).strict().refine((icon) => icon.lucidIcon !== undefined || icon.svgIcon !== undefined, {
  message: 'expected at least one of lucidIcon or svgIcon',
});

export const ZTransition = z.object({
  func: z.array(ZFunctionName),
  allowedTargetStates: z.array(ZActorState),
});

export const ZActorStateConfig = z.object({
  on: z.partialRecord(ZInputMessage, ZTransition),
});

export const ZVibecanvasActor = z.object({
  relFunctionPath: z.string(),
  initialState: ZActorState,
  initialData: ZActorData,
  dataSchema: ZJsonSchema.optional(),
  states: z.partialRecord(ZActorState, ZActorStateConfig),
  inputMsgSchema: z.record(ZInputMessage, ZJsonSchema).optional(),
  outputMsgSchema: z.record(ZOutputMessage, ZJsonSchema).optional(),
});

export const ZVibecanvasActorWidget = z.object({
  relWidgetDir: z.string(),
  tool: z.object({
    label: z.string(),
    icon: ZVibecanvasToolIcon.optional(),
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

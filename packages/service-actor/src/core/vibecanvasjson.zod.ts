import { z } from 'zod';

import { LUCIDE_STATIC_ICON_KEYS, isLucideStaticIconKey } from './tool-icon';
import type {
  TActorData,
  TActorNonErrorState,
  TActorResourceRequirement,
  TActorState,
  TFunctionName,
  TJsonSchema,
  TTransition,
  TVibecanvasJson,
} from './types';
import type { TVibecanvasToolIcon } from './tool-icon';

export const ACTOR_RESOURCE_SLOT_NAME_MAX_LENGTH = 128;
export const ACTOR_RESOURCE_IDENTIFIER_MAX_LENGTH = 128;
export const ACTOR_DB_NAMED_OPERATION_SQL_MAX_LENGTH = 65_536;
export const ACTOR_DB_NAMED_OPERATION_MAX_COUNT = 128;
export const ACTOR_DB_NAMED_OPERATION_PARAMETER_MAX_COUNT = 128;

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Checks the declaration-level one-statement rule without treating SQL text
 * inspection as a runtime authorization boundary. Provider execution remains
 * responsible for using the database adapter safely.
 */
function isOneSqlStatement(sql: string): boolean {
  type TSqlState = 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment';

  let state: TSqlState = 'normal';
  let hasStatementContent = false;
  let terminated = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'single') {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        state = 'normal';
      }
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        state = 'normal';
      }
      continue;
    }
    if (state === 'backtick') {
      if (char === '`' && next === '`') {
        index += 1;
      } else if (char === '`') {
        state = 'normal';
      }
      continue;
    }
    if (state === 'bracket') {
      if (char === ']' && next === ']') {
        index += 1;
      } else if (char === ']') {
        state = 'normal';
      }
      continue;
    }

    if (/\s/.test(char)) continue;
    if (char === '-' && next === '-') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (char === ';') {
      if (!hasStatementContent || terminated) return false;
      terminated = true;
      continue;
    }
    if (terminated) return false;

    hasStatementContent = true;
    if (char === "'") state = 'single';
    if (char === '"') state = 'double';
    if (char === '`') state = 'backtick';
    if (char === '[') state = 'bracket';
  }

  return hasStatementContent && (state === 'normal' || state === 'line-comment');
}

function boundedRecord<TKey extends string, TValue>(
  key: z.ZodType<TKey>,
  value: z.ZodType<TValue>,
  maximum: number,
) {
  return z.record(key, value).refine((record) => Object.keys(record).length <= maximum, {
    message: `expected at most ${maximum} entries`,
  });
}

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

export const ZActorResourceKind = z.enum(['kv', 'secretStore', 'db']);
export const ZActorResourcePermission = z.enum(['read', 'write']);
export const ZActorResourceScope = z.array(ZActorResourcePermission)
  .min(1)
  .max(2)
  .superRefine((scope, ctx) => {
    if (new Set(scope).size !== scope.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'resource scope must not contain duplicate permissions',
      });
    }
  });

export const ZActorResourceSlotName = z.string()
  .max(ACTOR_RESOURCE_SLOT_NAME_MAX_LENGTH)
  .refine(isNonBlank, 'resource slot name must not be blank');

export const ZActorResourceIdentifier = z.string()
  .max(ACTOR_RESOURCE_IDENTIFIER_MAX_LENGTH)
  .refine(isNonBlank, 'resource identifier must not be blank');

export const ZActorKvResourceRequirement = z.object({
  kind: z.literal('kv'),
  required: z.boolean(),
  scope: ZActorResourceScope,
});

export const ZActorSecretStoreResourceRequirement = z.object({
  kind: z.literal('secretStore'),
  required: z.boolean(),
  scope: ZActorResourceScope,
});

export const ZActorDbParameterType = z.enum(['string', 'number', 'boolean', 'bigint', 'bytes', 'json']);

export const ZActorDbOperationParameterDeclaration = z.object({
  type: ZActorDbParameterType,
  required: z.boolean().default(true),
  nullable: z.boolean().default(false),
});

export const ZActorDbNamedOperation = z.object({
  effect: ZActorResourcePermission,
  sql: z.string()
    .max(ACTOR_DB_NAMED_OPERATION_SQL_MAX_LENGTH)
    .refine(isNonBlank, 'named operation SQL must not be blank')
    .refine(isOneSqlStatement, 'named operation SQL must contain exactly one statement'),
  parameters: boundedRecord(
    ZActorResourceIdentifier,
    ZActorDbOperationParameterDeclaration,
    ACTOR_DB_NAMED_OPERATION_PARAMETER_MAX_COUNT,
  ).optional(),
  result: z.enum(['rows', 'execute']),
});

export const ZActorDbResourceRequirement = z.object({
  kind: z.literal('db'),
  required: z.boolean(),
  scope: ZActorResourceScope,
  arbitrarySql: z.boolean().default(false),
  operations: boundedRecord(
    ZActorResourceIdentifier,
    ZActorDbNamedOperation,
    ACTOR_DB_NAMED_OPERATION_MAX_COUNT,
  ).optional(),
}).strict().superRefine((requirement, ctx) => {
  for (const [operationName, operation] of Object.entries(requirement.operations ?? {})) {
    if (!requirement.scope.includes(operation.effect)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations', operationName, 'effect'],
        message: `${operation.effect} operation requires ${operation.effect} in the resource scope`,
      });
    }
  }
});

export const ZActorResourceRequirement: z.ZodType<TActorResourceRequirement> = z.discriminatedUnion('kind', [
  ZActorKvResourceRequirement,
  ZActorSecretStoreResourceRequirement,
  ZActorDbResourceRequirement,
]);

export const ZActorResources = z.record(ZActorResourceSlotName, ZActorResourceRequirement);

export const ZActorNonErrorState = z.custom<TActorNonErrorState>(
  (value) => typeof value === 'string' && /^(booting|ready|busy|waiting)(\..*)?$/.test(value),
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

export const ZActorErrorHandler = z.object({
  func: z.array(ZFunctionName),
  recover: z.union([
    z.literal('stay'),
    z.object({ targetState: ZActorNonErrorState }).strict(),
  ]),
}).strict();

export const ZActorActivity = z.object({
  everyMs: z.number().int().min(1_000).max(2_147_483_647),
  func: z.array(ZFunctionName),
  runImmediately: z.boolean().optional(),
  onError: ZActorErrorHandler.optional(),
}).strict();

export const ZTransition: z.ZodType<TTransition> = z.object({
  func: z.array(ZFunctionName),
  targetState: ZActorState.optional(),
  allowedTargetStates: z.array(ZActorState).optional(),
  onError: ZActorErrorHandler.optional(),
}).refine(
  (transition) => Number(transition.targetState !== undefined) + Number(transition.allowedTargetStates !== undefined) === 1,
  { message: 'expected exactly one of targetState or allowedTargetStates' },
).transform((transition): TTransition => transition.targetState !== undefined
  ? { func: transition.func, targetState: transition.targetState, onError: transition.onError }
  : { func: transition.func, allowedTargetStates: transition.allowedTargetStates ?? [], onError: transition.onError });

export const ZActorStateConfig = z.object({
  on: z.partialRecord(ZInputMessage, ZTransition),
  activity: ZActorActivity.optional(),
  onEnter: z.array(ZFunctionName).optional(),
  onExit: z.array(ZFunctionName).optional(),
  onError: ZActorErrorHandler.optional(),
});

export const ZVibecanvasActor = z.object({
  relFunctionPath: z.string(),
  initialState: ZActorState,
  initialData: ZActorData,
  dataSchema: ZJsonSchema.optional(),
  resources: ZActorResources.optional(),
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
  kind: z.enum(['widget', 'actor-widget']).optional(),
  url: z.url().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  actor: ZVibecanvasActor,
  widget: ZVibecanvasActorWidget,
});

export type TZVibecanvasJson = z.infer<typeof ZVibecanvasJson> & TVibecanvasJson;

import { ZVibecanvasActor, ZVibecanvasActorWidget, ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Type } from 'typebox';
import { z } from 'zod';

export const ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE = 'vibecanvas.actorCandidate';
export const ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE = 'vibecanvas.actorCandidateApproved';

export const Z_ACTOR_CANDIDATE = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  actor: ZVibecanvasActor.omit({ relFunctionPath: true }).extend({ relFunctionPath: z.string().optional() }),
  widget: ZVibecanvasActorWidget.omit({ relWidgetDir: true }),
});

export const Z_VIBECANVAS_JSON = ZVibecanvasJson;

const JSON_VALUE_SCHEMA = Type.Any({
  description: 'Any JSON-serializable value. Use only objects, arrays, strings, numbers, booleans, or null.',
});

const JSON_SCHEMA_SCHEMA = Type.Any({
  description: 'A JSON Schema object or boolean schema.',
});

const ACTOR_STATE_SCHEMA = Type.String({
  pattern: '^(booting|ready|busy|waiting|error)(\\..*)?$',
  description: 'Actor state. Prefer ready for simple widgets. Must start with booting, ready, busy, waiting, or error.',
});

const ACTOR_NON_ERROR_STATE_SCHEMA = Type.String({
  pattern: '^(booting|ready|busy|waiting)(\\..*)?$',
  description: 'Target actor state. Must start with booting, ready, busy, or waiting.',
});

const ACTOR_FUNCTION_NAME_SCHEMA = Type.String({
  pattern: '^(fn|fx|tx)\\..+$',
  description: 'Transition function name. Must be a string like fn.checkInput, fx.readThing, or tx.applyMessage.',
});

const ACTOR_TRANSITION_SCHEMA = Type.Object({
  func: Type.Array(ACTOR_FUNCTION_NAME_SCHEMA, {
    minItems: 1,
    description: 'Ordered transition function names. Do not put objects here; use only fn.*, fx.*, or tx.* strings.',
  }),
  allowedTargetStates: Type.Array(ACTOR_NON_ERROR_STATE_SCHEMA, {
    minItems: 1,
    description: 'Allowed non-error target states after this message.',
  }),
});

const ACTOR_STATE_CONFIG_SCHEMA = Type.Object({
  on: Type.Record(Type.String({ minLength: 1, description: 'Input message name. Prefer in.* names, for example in.increment.' }), ACTOR_TRANSITION_SCHEMA),
});

const ACTOR_TOOL_BEHAVIOR_SCHEMA = Type.Union([
  Type.Object({
    type: Type.Literal('mode'),
    mode: Type.Union([
      Type.Literal('draw-create'),
      Type.Literal('click-create'),
      Type.Literal('select'),
      Type.Literal('hand'),
    ]),
  }),
  Type.Object({ type: Type.Literal('action') }),
  Type.Object({ type: Type.Literal('modal') }),
]);

export const ACTOR_CANDIDATE_PARAMETER_SCHEMA = Type.Object({
  slug: Type.Optional(Type.String({ minLength: 1, description: 'URL/file-safe slug. If omitted, Vibecanvas derives one from name.' })),
  name: Type.String({ minLength: 1, description: 'Human-readable widget/actor name.' }),
  description: Type.Optional(Type.String({ description: 'Short explanation of what the widget does.' })),
  actor: Type.Object({
    initialState: ACTOR_STATE_SCHEMA,
    initialData: JSON_VALUE_SCHEMA,
    dataSchema: Type.Optional(JSON_SCHEMA_SCHEMA),
    states: Type.Record(ACTOR_STATE_SCHEMA, ACTOR_STATE_CONFIG_SCHEMA, {
      description: 'State machine keyed by actor states. Use ready for simple widgets.',
    }),
    inputMsgSchema: Type.Optional(Type.Record(Type.String({ minLength: 1, description: 'Input message name. Prefer in.* names.' }), JSON_SCHEMA_SCHEMA)),
    outputMsgSchema: Type.Optional(Type.Record(Type.String({ minLength: 1, description: 'Output message name. Prefer out.* names.' }), JSON_SCHEMA_SCHEMA)),
    relFunctionPath: Type.Optional(Type.String({ description: 'Usually omitted; Vibecanvas sets ./actor/functions.ts.' })),
  }),
  widget: Type.Object({
    tool: Type.Object({
      label: Type.String({ minLength: 1, description: 'Tool label shown in the canvas UI.' }),
      icon: Type.Optional(Type.String({ description: 'Small icon/emoji for the tool.' })),
      group: Type.Optional(Type.String({ description: 'Tool group label.' })),
      priority: Type.Optional(Type.Number({ description: 'Tool ordering priority.' })),
      behavior: ACTOR_TOOL_BEHAVIOR_SCHEMA,
    }),
  }),
});

export const SET_ACTOR_CANDIDATE_PARAMETERS = Type.Object({
  candidate: ACTOR_CANDIDATE_PARAMETER_SCHEMA,
  changeSummary: Type.Optional(Type.String({ description: 'Short summary of what changed in this candidate revision.' })),
});

export const AJV = new Ajv({ allErrors: true, strict: false });
addFormats(AJV);

export const OBJECT_PARAMETER_SCHEMA = Type.Object({});

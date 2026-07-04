import { ZVibecanvasActor, ZVibecanvasActorWidget, ZVibecanvasJson } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
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

export const ACTOR_CANDIDATE_JSON_SCHEMA = z.toJSONSchema(Z_ACTOR_CANDIDATE, {
  target: 'draft-07',
  unrepresentable: 'any',
});

export const AJV = new Ajv({ allErrors: true, strict: false });
addFormats(AJV);

export const OBJECT_PARAMETER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

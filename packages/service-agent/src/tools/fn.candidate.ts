import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TActorCandidate, TValidationResult } from './types';
import { Z_ACTOR_CANDIDATE } from './CONSTANTS';
import { fnAssertSafeFinalDestination } from '../core/fn.safe-destination';
import { fnValidateManifest } from '../core/lint/fn.validate-manifest';
import { fnWidgetDraftFilesFromManifest } from '../core/fn.widget-draft-files';

export function fnSlugifyWidgetName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'generated-widget';
}

export function fnBuildManifestFromCandidate(candidate: TActorCandidate): TVibecanvasJson {
  return {
    slug: candidate.slug ?? fnSlugifyWidgetName(candidate.name),
    name: candidate.name,
    version: '1',
    description: candidate.description,
    actor: {
      ...candidate.actor,
      relFunctionPath: candidate.actor.relFunctionPath ?? './actor/functions.ts',
    },
    widget: {
      relWidgetDir: './widget',
      tool: candidate.widget.tool,
    },
  };
}

export function fnValidateCandidate(candidate: unknown): { candidate?: TActorCandidate; manifest?: TVibecanvasJson; validation: TValidationResult } {
  const parsed = Z_ACTOR_CANDIDATE.safeParse(candidate);
  if (!parsed.success) {
    return {
      validation: {
        ok: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'candidate'}: ${issue.message}`),
        warnings: [],
      },
    };
  }

  const parsedCandidate = parsed.data as TActorCandidate;
  const manifest = fnBuildManifestFromCandidate(parsedCandidate);
  const validation = fnValidateManifest(manifest);
  return { candidate: parsedCandidate, manifest, validation };
}

export { fnAssertSafeFinalDestination, fnValidateManifest, fnWidgetDraftFilesFromManifest };

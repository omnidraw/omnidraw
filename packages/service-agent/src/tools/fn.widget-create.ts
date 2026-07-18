import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { Z_VIBECANVAS_JSON } from './CONSTANTS';

function slugify(name: string): string {
  const slug = name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'widget';
}

export function fnBuildWidgetCreateManifest(args: { name: string; kind: 'widget' | 'actor-widget'; description?: string }): TVibecanvasJson {
  const manifest = {
    slug: slugify(args.name),
    name: args.name,
    kind: args.kind,
    description: args.description ?? `A ${args.kind === 'actor-widget' ? 'stateful actor widget' : 'Vibecanvas widget'} named ${args.name}.`,
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: {},
      dataSchema: { type: 'object', additionalProperties: true },
      states: {
        ready: {
          on: {
            'in.update': {
              func: ['tx.update'],
              targetState: 'ready',
            },
          },
        },
        error: {
          on: {
            'in.resetError': {
              func: ['tx.resetError'],
              targetState: 'ready',
            },
          },
        },
      },
      inputMsgSchema: {
        'in.update': {},
        'in.resetError': { type: 'object', properties: {}, additionalProperties: false },
      },
      outputMsgSchema: {},
    },
    widget: {
      relWidgetDir: './widget',
      tool: {
        label: args.name,
        behavior: { type: 'mode', mode: 'draw-create' },
      },
    },
  };
  const result = Z_VIBECANVAS_JSON.safeParse(manifest);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') || 'Generated widget manifest is invalid.');
  }
  return result.data as TVibecanvasJson;
}

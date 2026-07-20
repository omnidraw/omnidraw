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

export function fnBuildWidgetCreateManifest(args: { name: string; description?: string }): TVibecanvasJson {
  const manifest = {
    slug: slugify(args.name),
    name: args.name,
    ...(args.description === undefined ? {} : { description: args.description }),
    actor: {
      relFunctionPath: './actor/functions.ts',
      initialState: 'ready',
      initialData: {},
      dataSchema: { type: 'object', properties: {}, additionalProperties: false },
      resources: {},
      states: {
        ready: { on: {} },
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
        'in.resetError': { type: 'object', properties: {}, additionalProperties: false },
      },
      outputMsgSchema: {},
    },
    widget: {
      relWidgetDir: './widget',
      frame: { width: 360, height: 320 },
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

import type { TWidgetManifestV3 } from '@omnidraw/widget-contract';
import type { TWidgetCreateInput } from '../workspace/types';
import {
  OMNIDRAW_CAPSULE_AUTHORING_APIS,
  Z_OMNIDRAW_JSON,
} from './CONSTANTS';

function slugify(name: string): string {
  const slug = name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'widget';
}

export function fnBuildWidgetCreateManifest(args: TWidgetCreateInput): TWidgetManifestV3 {
  const manifest = {
    schemaVersion: 3 as const,
    slug: slugify(args.name),
    name: args.name,
    ...(args.description === undefined ? {} : { description: args.description }),
    ui: {
      runtime: 'capsule' as const,
      entry: args.template === 'react' ? 'ui/main.tsx' : 'ui/main.ts',
      apis: OMNIDRAW_CAPSULE_AUTHORING_APIS,
    },
    ...(args.server === true
      ? {
          server: {
            entry: 'server/main.server.ts',
            runtimeAbi: 'omnidraw-function-v1',
          },
        }
      : {}),
  };
  const result = Z_OMNIDRAW_JSON.safeParse(manifest);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') || 'Generated widget manifest is invalid.');
  }
  return result.data;
}

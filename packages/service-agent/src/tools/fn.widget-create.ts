import type { TWidgetManifestV3 } from '@vibecanvas/widget-contract';
import type { TWidgetCreateInput } from '../workspace/types';
import {
  WIDGET_CAPSULE_AUTHORING_TARGET,
  Z_VIBECANVAS_JSON,
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
      target: WIDGET_CAPSULE_AUTHORING_TARGET,
    },
    ...(args.server === true
      ? {
          server: {
            entry: 'server/main.server.ts',
            runtimeAbi: 'vibecanvas-function-v1',
          },
        }
      : {}),
  };
  const result = Z_VIBECANVAS_JSON.safeParse(manifest);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') || 'Generated widget manifest is invalid.');
  }
  return result.data;
}

import type { TWidgetManifestV3 } from '@vibecanvas/widget-contract';
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

export function fnBuildWidgetCreateManifest(args: { name: string; description?: string }): TWidgetManifestV3 {
  const manifest = {
    schemaVersion: 3 as const,
    slug: slugify(args.name),
    name: args.name,
    ...(args.description === undefined ? {} : { description: args.description }),
    ui: {
      runtime: 'capsule' as const,
      entry: 'ui/main.ts',
      target: WIDGET_CAPSULE_AUTHORING_TARGET,
    },
  };
  const result = Z_VIBECANVAS_JSON.safeParse(manifest);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') || 'Generated widget manifest is invalid.');
  }
  return result.data;
}

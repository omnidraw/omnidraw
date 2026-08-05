import type {
  TWidgetCatalogSnapshot,
} from '../catalog/typed';
import type {
  TWidgetDraftConfig,
} from './typed';
import type {
  TWidgetManifestV1,
} from '@omnidraw/widget-contract';

export function fnApplyWidgetDraftConfig(
  manifest: TWidgetManifestV1,
  config: TWidgetDraftConfig,
): TWidgetManifestV1 {
  return {
    ...manifest,
    name: config.name,
    description: config.description,
    tool: {
      label: config.tool.label,
      ...(config.tool.icon === null ? {} : { icon: { ...config.tool.icon } }),
      group: config.tool.group,
      priority: config.tool.priority,
    },
  };
}

export function fnImplicitWidgetGroups(
  snapshot: TWidgetCatalogSnapshot,
): readonly string[] {
  const groups = new Set<string>();
  for (const entry of Object.values(snapshot.entries)) {
    const publishedGroup = entry.published?.manifest?.tool.group;
    const draftGroup = entry.draft?.manifest?.tool.group;
    if (publishedGroup) groups.add(publishedGroup);
    if (draftGroup) groups.add(draftGroup);
  }
  return Object.freeze([...groups].sort((left, right) => left.localeCompare(right)));
}

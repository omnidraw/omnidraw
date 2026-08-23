import type {
  TWidgetCatalogSnapshot,
} from '../catalog/typed';
import type {
  TWidgetDraftConfig,
} from './typed';
import type {
  TOmnidrawToolIcon,
  TWidgetManifestV1,
} from '@omnidraw/sdk/contract';

const HOST_RESOURCE_SVG_PATTERN = /(?:<\s*(?:a|image|use|feimage|mpath|style|animate(?:motion|transform)?|set|font-face-uri)\b|(?:^|[\s<])(?:href|xlink:href|src|srcset|style)\s*=|@import\b|\burl\b)/i;

export function fnPublishedWidgetIconInputError(
  icon: TOmnidrawToolIcon | null,
): string | null {
  if (icon === null) return null;
  const hasLucideIcon = icon.lucidIcon !== undefined;
  const svgIcon = icon.svgIcon;
  const hasSvgIcon = svgIcon !== undefined;
  if (Number(hasLucideIcon) + Number(hasSvgIcon) !== 1) {
    return 'Published widget icons must choose exactly one Lucide or custom icon.';
  }
  if (svgIcon !== undefined && HOST_RESOURCE_SVG_PATTERN.test(svgIcon)) {
    return 'Published custom SVG icons cannot contain resource, navigation, animation, or style markup.';
  }
  return null;
}

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

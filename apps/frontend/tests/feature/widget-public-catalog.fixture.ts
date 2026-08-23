import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogEntry,
  TWidgetPublicCatalogForm,
} from '../../src/shell/framework/feature/sidebar/ports';

const SHA = 'a'.repeat(64);

export function publicForm(
  source: 'draft' | 'published',
  options: Readonly<{
    name?: string;
    group?: string | null;
    priority?: number;
    health?: 'healthy' | 'unhealthy';
  }> = {},
): TWidgetPublicCatalogForm {
  const name = options.name ?? 'Camera';
  return {
    source,
    health: options.health ?? 'healthy',
    manifestDigestSha256: SHA,
    config: {
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      name,
      description: 'Filesystem widget fixture.',
      tool: {
        label: name,
        icon: { lucidIcon: 'Camera' },
        group: options.group === undefined ? 'media' : options.group,
        priority: options.priority ?? 10,
      },
    },
    resources: [],
    functions: [],
    fileCount: 2,
    issues: [],
  };
}

export function publicEntry(
  widgetKey = 'camera',
  options: Readonly<{
    draft?: TWidgetPublicCatalogForm | null;
    published?: TWidgetPublicCatalogForm | null;
    status?: TWidgetPublicCatalogEntry['differences']['status'];
  }> = {},
): TWidgetPublicCatalogEntry {
  const draft = options.draft === undefined ? publicForm('draft') : options.draft;
  const published = options.published === undefined
    ? publicForm('published')
    : options.published;
  const status = options.status ?? 'presentation-changed';
  return {
    widgetKey,
    health: 'healthy',
    placeable: published !== null,
    differences: {
      availability: draft && published
        ? 'draft-and-published'
        : draft
          ? 'draft-only'
          : 'published-only',
      manifest: draft && published
        ? status === 'matched' ? 'same' : 'different'
        : 'unavailable',
      presentation: draft && published
        ? status === 'matched' ? 'same' : 'different'
        : 'unavailable',
      executableManifest: draft && published ? 'same' : 'unavailable',
      status,
    },
    draft,
    published,
    placement: published === null ? null : {
      reference: { source: 'published', widgetKey, catalogGeneration: 1 },
      bounds: { width: 480, height: 320 },
    },
  };
}

export function publicCatalog(
  entries: readonly TWidgetPublicCatalogEntry[] = [publicEntry()],
): TWidgetPublicCatalog {
  return {
    format: 'omnidraw.widget-catalog.public.v1',
    generation: 1,
    catalogDigestSha256: SHA,
    healthy: true,
    groups: [...new Set(entries.flatMap((entry) => [
      entry.published?.config?.tool.group,
      entry.draft?.config?.tool.group,
    ]).filter((group): group is string => Boolean(group)))].sort(),
    entries,
    issues: [],
  };
}

import type {
  TWidgetCatalogDifferenceState,
  TWidgetCatalogDifferences,
  TWidgetCatalogDraft,
  TWidgetCatalogEntry,
  TWidgetCatalogIssue,
  TWidgetCatalogPublished,
  TWidgetCatalogScanLimits,
  TWidgetCatalogSnapshot,
} from './typed';
import { WIDGET_CATALOG_SCAN_LIMITS } from './CONSTANTS';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digestState(left: string | null, right: string | null): TWidgetCatalogDifferenceState {
  if (left === null || right === null) return 'unavailable';
  return left === right ? 'same' : 'different';
}

function freezeValue<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeValue(item);
  } else {
    for (const item of Object.values(value)) freezeValue(item);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

export function fnIsStrictWidgetCatalogSlug(value: string): boolean {
  return value.length >= 1
    && value.length <= 100
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function fnWidgetCatalogIssue(args: Readonly<{
  scope: TWidgetCatalogIssue['scope'];
  code: TWidgetCatalogIssue['code'];
  message: string;
  path?: string | null;
}>): TWidgetCatalogIssue {
  return Object.freeze({
    scope: args.scope,
    code: args.code,
    message: args.message,
    path: args.path ?? null,
  });
}

export function fnSortWidgetCatalogIssues(
  issues: readonly TWidgetCatalogIssue[],
): readonly TWidgetCatalogIssue[] {
  return [...issues].sort((left, right) => (
    compareText(left.scope, right.scope)
    || compareText(left.path ?? '', right.path ?? '')
    || compareText(left.code, right.code)
    || compareText(left.message, right.message)
  ));
}

export function fnResolveWidgetCatalogScanLimits(
  overrides: Partial<TWidgetCatalogScanLimits> | undefined,
): TWidgetCatalogScanLimits {
  const result = { ...WIDGET_CATALOG_SCAN_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Widget catalog scan limit '${name}' must be a positive integer.`);
    }
  }
  return Object.freeze(result);
}

export function fnWidgetCatalogDifferences(args: Readonly<{
  draft: TWidgetCatalogDraft | null;
  published: TWidgetCatalogPublished | null;
}>): TWidgetCatalogDifferences {
  if (args.draft === null) {
    return Object.freeze({
      availability: 'published-only',
      manifest: 'unavailable',
      presentation: 'unavailable',
      executableManifest: 'unavailable',
      status: 'published-only',
    });
  }
  if (args.published === null) {
    return Object.freeze({
      availability: 'draft-only',
      manifest: 'unavailable',
      presentation: 'unavailable',
      executableManifest: 'unavailable',
      status: 'draft-only',
    });
  }
  const manifest = digestState(
    args.draft.manifestDigestSha256,
    args.published.manifestDigestSha256,
  );
  const presentation = digestState(
    args.draft.presentationDigestSha256,
    args.published.presentationDigestSha256,
  );
  const executableManifest = digestState(
    args.draft.executableManifestDigestSha256,
    args.published.executableManifestDigestSha256,
  );
  const status = args.draft.health !== 'healthy' || args.published.health !== 'healthy'
    || executableManifest === 'unavailable' || presentation === 'unavailable'
    ? 'unavailable'
    : executableManifest === 'different'
      ? 'executable-changed'
      : presentation === 'different'
        ? 'presentation-changed'
        : 'matched';
  return Object.freeze({
    availability: 'draft-and-published',
    manifest,
    presentation,
    executableManifest,
    status,
  });
}

export function fnWidgetCatalogEntry(args: Readonly<{
  slug: string;
  draft: TWidgetCatalogDraft | null;
  published: TWidgetCatalogPublished | null;
}>): TWidgetCatalogEntry {
  const forms = [args.draft, args.published].filter((form) => form !== null);
  const healthyForms = forms.filter((form) => form.health === 'healthy').length;
  return Object.freeze({
    slug: args.slug,
    health: healthyForms === forms.length
      ? 'healthy'
      : healthyForms === 0
        ? 'unhealthy'
        : 'degraded',
    placeable: args.published?.health === 'healthy',
    draft: args.draft,
    published: args.published,
    differences: fnWidgetCatalogDifferences({ draft: args.draft, published: args.published }),
  });
}

export function fnCanonicalizeWidgetCatalogSnapshot(args: Readonly<{
  entries: Readonly<Record<string, TWidgetCatalogEntry>>;
  issues: readonly TWidgetCatalogIssue[];
}>): string {
  const entries = Object.fromEntries(Object.keys(args.entries).sort(compareText)
    .map((slug) => [slug, args.entries[slug]]));
  return JSON.stringify({
    format: 'omnidraw.widget-catalog.v1',
    entries,
    issues: fnSortWidgetCatalogIssues(args.issues),
  });
}

export function fnFreezeWidgetCatalogSnapshot(
  snapshot: TWidgetCatalogSnapshot,
): TWidgetCatalogSnapshot {
  return freezeValue(snapshot);
}

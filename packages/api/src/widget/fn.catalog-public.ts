import type {
  TWidgetCatalogIssue,
  TWidgetCatalogSnapshot,
} from '@omnidraw/service-agent';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';
import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogForm,
  TWidgetPublicIssue,
} from './public-types';

function issueMessage(issue: TWidgetCatalogIssue): string {
  switch (issue.code) {
    case 'manifest_missing': return 'omnidraw.json is missing.';
    case 'manifest_invalid': return 'omnidraw.json is invalid.';
    case 'manifest_slug_mismatch': return 'The folder and manifest widget keys do not match.';
    case 'release_missing': return 'The publication completion marker is missing.';
    case 'release_invalid': return 'The publication descriptor is invalid.';
    case 'functions_invalid': return 'Published function descriptors are invalid.';
    case 'capsule_inspection_failed': return 'The published browser artifact is not trusted by this host.';
    case 'release_validation_failed': return 'Published executable files failed validation.';
    case 'symlink_not_allowed': return 'Widget folders cannot contain links.';
    case 'special_file_not_allowed': return 'Widget folders contain an unsupported file type.';
    case 'filesystem_changed': return 'Widget files changed while they were being scanned.';
    case 'filesystem_read_failed': return 'Widget files could not be read safely.';
    default: return 'The widget folder failed a bounded catalog check.';
  }
}

function publicIssue(issue: TWidgetCatalogIssue): TWidgetPublicIssue {
  return Object.freeze({ code: issue.code, message: issueMessage(issue) });
}

function browserFunctions(
  functions: readonly TWidgetServerFunctionDescriptor[] | null,
): readonly TWidgetBrowserFunctionDescriptor[] {
  return Object.freeze((functions ?? []).map((descriptor) => {
    const { modulePath: _modulePath, ...browser } = descriptor;
    return Object.freeze(browser);
  }));
}

function publicForm(
  source: 'draft' | 'published',
  form: NonNullable<TWidgetCatalogSnapshot['entries'][string]['draft']>
    | NonNullable<TWidgetCatalogSnapshot['entries'][string]['published']>,
): TWidgetPublicCatalogForm {
  return Object.freeze({
    source,
    health: form.health,
    manifestDigestSha256: form.manifestDigestSha256,
    config: form.presentation,
    resources: Object.freeze([...(form.manifest?.resources ?? [])]),
    functions: form.kind === 'published' ? browserFunctions(form.functions) : Object.freeze([]),
    fileCount: form.files.length,
    issues: Object.freeze(form.issues.slice(0, 256).map(publicIssue)),
  });
}

export function fnProjectWidgetPublicCatalog(
  snapshot: TWidgetCatalogSnapshot,
): TWidgetPublicCatalog {
  const groups = new Set<string>();
  const entries = Object.values(snapshot.entries)
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((entry) => {
      for (const group of [
        entry.published?.presentation?.tool.group,
        entry.draft?.presentation?.tool.group,
      ]) if (group) groups.add(group);
      return Object.freeze({
        widgetKey: entry.slug,
        health: entry.health,
        placeable: entry.placeable,
        differences: Object.freeze({ ...entry.differences }),
        draft: entry.draft === null ? null : publicForm('draft', entry.draft),
        published: entry.published === null
          ? null
          : publicForm('published', entry.published),
        placement: entry.placeable
          ? Object.freeze({
              reference: Object.freeze({
                source: 'published' as const,
                widgetKey: entry.slug,
                catalogGeneration: snapshot.generation,
              }),
              bounds: Object.freeze({ width: 480, height: 320 }),
            })
          : null,
      });
    });
  return Object.freeze({
    format: 'omnidraw.widget-catalog.public.v1',
    generation: snapshot.generation,
    catalogDigestSha256: snapshot.digestSha256,
    healthy: snapshot.healthy,
    groups: Object.freeze([...groups].sort((left, right) => left.localeCompare(right))),
    entries: Object.freeze(entries),
    issues: Object.freeze(snapshot.issues.slice(0, 2_048).map(publicIssue)),
  });
}

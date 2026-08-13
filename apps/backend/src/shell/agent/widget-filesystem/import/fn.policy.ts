/** @file Pure runner trust, collision, and confined import-tree policy. */

import type {
  TWidgetImportLocalTrustPolicy,
  TWidgetImportPlanResult,
  TWidgetImportRunner,
  TWidgetImportSource,
  TWidgetImportTreeEntry,
  TWidgetImportTreeValidation,
} from './typed';
import {
  WIDGET_IMPORT_LOCATOR_MAX_LENGTH,
  WIDGET_IMPORT_OPERATION_ID_MAX_LENGTH,
  WIDGET_IMPORT_SLUG_MAX_LENGTH,
  WIDGET_IMPORT_TREE_ENTRY_MAX_COUNT,
  WIDGET_IMPORT_TREE_PATH_MAX_LENGTH,
} from './CONSTANTS';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

function normalizedRelativePath(value: string): string | null {
  if (
    value.length === 0
    || value.length > WIDGET_IMPORT_TREE_PATH_MAX_LENGTH
    || value !== value.trim()
    || value.includes('\\')
    || value.includes('\0')
    || /[\u0000-\u001f\u007f]/.test(value)
    || value !== value.normalize('NFC')
    || value.startsWith('/')
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  ) return null;
  const segments = value.split('/');
  if (segments.some((segment) => (
    segment.length === 0
    || segment.length > 255
    || segment === '.'
    || segment === '..'
  ))) {
    return null;
  }
  return segments.join('/');
}

export function fnNormalizeWidgetImportSource(
  source: TWidgetImportSource,
): TWidgetImportSource {
  if (source.kind !== 'remote' && source.kind !== 'external-checkout') {
    throw new TypeError('Widget import source kind is invalid.');
  }
  const locator = source.locator.trim();
  if (
    locator.length === 0
    || locator.length > WIDGET_IMPORT_LOCATOR_MAX_LENGTH
    || locator.includes('\0')
  ) throw new TypeError('Widget import source locator is invalid.');
  return Object.freeze({ kind: source.kind, locator });
}

export function fnSelectWidgetImportRunner(args: Readonly<{
  sourceKind: TWidgetImportSource['kind'];
  localTrustPolicy?: TWidgetImportLocalTrustPolicy;
}>): TWidgetImportRunner {
  if (args.localTrustPolicy?.kind === 'trusted-local') {
    return Object.freeze({ kind: 'host', trust: 'trusted-local' as const });
  }
  return Object.freeze({
    kind: 'isolated',
    reason: args.localTrustPolicy?.kind === 'isolated'
      ? 'explicit-isolation' as const
      : 'default-untrusted-source' as const,
  });
}

export function fnPlanWidgetImport(args: Readonly<{
  slug: string;
  operationId: string;
  existingDraftDirectoryNames: readonly string[];
}>): TWidgetImportPlanResult {
  if (
    args.slug.length === 0
    || args.slug.length > WIDGET_IMPORT_SLUG_MAX_LENGTH
    || !SLUG_PATTERN.test(args.slug)
  ) return Object.freeze({ ok: false, reason: 'invalid_slug' });
  if (
    args.operationId.length === 0
    || args.operationId.length > WIDGET_IMPORT_OPERATION_ID_MAX_LENGTH
    || !OPERATION_ID_PATTERN.test(args.operationId)
  ) return Object.freeze({ ok: false, reason: 'invalid_operation_id' });

  const foldedSlug = args.slug.toLowerCase();
  for (const name of args.existingDraftDirectoryNames) {
    if (name === args.slug) {
      return Object.freeze({
        ok: false,
        reason: 'draft_exists',
        collision: name,
      });
    }
    if (name.toLowerCase() === foldedSlug) {
      return Object.freeze({
        ok: false,
        reason: 'draft_case_collision',
        collision: name,
      });
    }
  }
  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      slug: args.slug,
      stagingRelativePath: `.staging/import-${args.slug}-${args.operationId}`,
      draftRelativePath: `drafts/${args.slug}`,
      copyMode: 'copy-files-no-follow' as const,
    }),
  });
}

export function fnValidateWidgetImportTree(
  entries: readonly TWidgetImportTreeEntry[],
): TWidgetImportTreeValidation {
  if (entries.length > WIDGET_IMPORT_TREE_ENTRY_MAX_COUNT) {
    return Object.freeze({ valid: false, reason: 'too_many_entries' });
  }
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const entry of entries) {
    const path = normalizedRelativePath(entry.path);
    if (path === null || path !== entry.path) {
      return Object.freeze({ valid: false, reason: 'unsafe_path', path: entry.path });
    }
    if (exact.has(path)) {
      return Object.freeze({ valid: false, reason: 'duplicate_path', path });
    }
    exact.add(path);
    const foldedPath = path.toLowerCase();
    const collision = folded.get(foldedPath);
    if (collision !== undefined && collision !== path) {
      return Object.freeze({
        valid: false,
        reason: 'case_collision',
        path,
        collision,
      });
    }
    folded.set(foldedPath, path);
    if (entry.kind === 'symbolic-link' || entry.kind === 'junction') {
      return Object.freeze({ valid: false, reason: 'link_not_allowed', path });
    }
    if (entry.kind !== 'file' && entry.kind !== 'directory') {
      return Object.freeze({ valid: false, reason: 'special_file_not_allowed', path });
    }
  }
  return Object.freeze({ valid: true });
}

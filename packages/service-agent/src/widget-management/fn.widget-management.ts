import type { TWidgetDraftValidation } from '../widget-drafts/types';
import { fnNormalizeWidgetName } from '../workspace/fn.names';
import type {
  TWidgetCatalogEntry,
  TWidgetCatalogProblem,
  TWidgetManagementManifest,
  TWidgetRelation,
  TWidgetSource,
  TWidgetVariantSummary,
} from './types';

export function fnIsSafeWidgetName(value: string): boolean {
  const normalized = fnNormalizeWidgetName(value);
  return normalized.ok && normalized.value === value;
}

export function fnIsSafeWidgetRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function fnWidgetRelation(args: {
  hasPublished: boolean;
  hasDraft: boolean;
  publishedFingerprint: string | null;
  draftFingerprint: string | null;
  cleanDraftRevision: string | null;
  draftRevision: string | null;
  hasProblem: boolean;
}): TWidgetRelation {
  if (args.hasPublished && !args.hasDraft) return 'published-only';
  if (!args.hasPublished && args.hasDraft) return 'draft-only';
  if (!args.hasPublished || !args.hasDraft) return 'unknown';
  if (args.hasProblem || args.publishedFingerprint === null || args.draftFingerprint === null) return 'unknown';
  if (args.cleanDraftRevision !== null && args.draftRevision !== null) {
    return args.cleanDraftRevision === args.draftRevision ? 'same' : 'different';
  }
  return args.publishedFingerprint === args.draftFingerprint ? 'same' : 'different';
}

export function fnWidgetVariantSummary(args: {
  draftId: string | null;
  source: TWidgetSource;
  fallbackName: string;
  manifest: TWidgetManagementManifest | null;
  revision: string;
  fingerprint: string | null;
  updatedAt: string | null;
  validation: TWidgetDraftValidation | null;
}): TWidgetVariantSummary {
  const manifest = args.manifest;
  return {
    draftId: args.draftId,
    source: args.source,
    displayName: args.manifest?.name ?? args.fallbackName,
    kind: manifest ? 'widget' : null,
    slug: args.manifest?.slug ?? null,
    description: args.manifest?.description ?? null,
    revision: args.revision,
    contentFingerprint: args.fingerprint,
    updatedAt: args.updatedAt,
    tool: {
      label: manifest?.name ?? null,
      icon: null,
      group: null,
      priority: null,
      behaviorType: 'mode',
    },
    validation: args.validation,
    placement: args.manifest && (
      args.source === 'published'
      || (
        args.draftId !== null
        && args.validation?.status === 'valid'
        && args.validation.validatedRevision === args.revision
      )
    ) ? {
      reference: {
        source: args.source,
        name: args.fallbackName,
        revision: args.revision,
      },
      bounds: { width: 360, height: 320 },
    } : null,
  };
}

export function fnWidgetProblem(code: string, message: string): TWidgetCatalogProblem {
  return { code, message: message.slice(0, 500) };
}

export function fnSortWidgetEntries(entries: TWidgetCatalogEntry[]): TWidgetCatalogEntry[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

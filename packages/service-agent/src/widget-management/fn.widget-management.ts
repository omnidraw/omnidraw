import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import { fnNormalizeWidgetFrame } from '@vibecanvas/widget-contract/fn.widget-frame';
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
  const legacyManifest = args.manifest && 'actor' in args.manifest
    ? args.manifest as TVibecanvasJson
    : null;
  const v2Manifest = args.manifest && 'schemaVersion' in args.manifest
    ? args.manifest as TWidgetManifestV2
    : null;
  const tool = legacyManifest?.widget.tool;
  return {
    draftId: args.draftId,
    source: args.source,
    displayName: args.manifest?.name ?? args.fallbackName,
    kind: v2Manifest ? 'widget' : legacyManifest ? 'actor-widget' : null,
    slug: args.manifest?.slug ?? null,
    description: args.manifest?.description ?? null,
    revision: args.revision,
    contentFingerprint: args.fingerprint,
    updatedAt: args.updatedAt,
    tool: {
      label: tool?.label ?? v2Manifest?.name ?? null,
      icon: tool?.icon ?? null,
      group: tool?.group?.trim() || null,
      priority: tool?.priority ?? null,
      behaviorType: tool?.behavior.type ?? null,
    },
    validation: args.validation,
    placement: args.manifest ? {
      reference: {
        source: args.source,
        name: args.fallbackName,
        revision: args.revision,
      },
      bounds: legacyManifest
        ? fnNormalizeWidgetFrame(legacyManifest.widget.frame)
        : { width: 360, height: 320 },
    } : null,
  };
}

export function fnWidgetProblem(code: string, message: string): TWidgetCatalogProblem {
  return { code, message: message.slice(0, 500) };
}

export function fnSortWidgetEntries(entries: TWidgetCatalogEntry[]): TWidgetCatalogEntry[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

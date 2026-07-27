import {
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
} from '@vibecanvas/widget-contract/CONSTANTS';
import type { TWidgetPlacementRef } from '@vibecanvas/widget-contract';
import type {
  TPublishedWidgetPlacementIdentity,
  TPublishedWidgetPlacementTarget,
  TWidgetCatalog,
  TWidgetCatalogEntry,
  TWidgetVariantSummary,
} from './types';

type TMergeArgs = Readonly<{
  draftCatalog: TWidgetCatalog;
  targets: readonly TPublishedWidgetPlacementTarget[];
  draftPublicationStates?: readonly TDraftPublicationState[];
}>;

type TDraftPublicationState = Readonly<{
  draftId: string;
  definitionId: string;
  name: string;
  status: 'editing' | 'validating' | 'ready' | 'published' | 'error' | 'discarded';
  publishedRevisionId: string | null;
}>;

const PUBLISHED_REFERENCE_PREFIX = 'published:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PUBLISHED_CATALOG_MAX_TARGETS = 1_000;
const TARGET_KEYS = Object.freeze([
  'bounds',
  'contractDigestSha256',
  'definitionId',
  'description',
  'name',
  'revisionId',
  'slug',
  'updatedAtMs',
]);
const BOUNDS_KEYS = Object.freeze(['height', 'width']);

type TTargetValidationResult =
  | Readonly<{ ok: true; targets: readonly TPublishedWidgetPlacementTarget[] }>
  | Readonly<{ ok: false; message: string }>;

function fnIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fnHasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index]);
}

function fnIsCanonicalDimension(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function fnIsPlacementTarget(value: unknown): value is TPublishedWidgetPlacementTarget {
  if (!fnIsRecord(value) || !fnHasExactKeys(value, TARGET_KEYS)) return false;
  if (!fnIsRecord(value.bounds) || !fnHasExactKeys(value.bounds, BOUNDS_KEYS)) return false;
  return typeof value.definitionId === 'string'
    && UUID_PATTERN.test(value.definitionId)
    && typeof value.revisionId === 'string'
    && UUID_PATTERN.test(value.revisionId)
    && typeof value.name === 'string'
    && value.name === value.name.trim()
    && value.name.length >= 1
    && value.name.length <= 200
    && typeof value.slug === 'string'
    && value.slug.length <= 100
    && SLUG_PATTERN.test(value.slug)
    && (value.description === null
      || (typeof value.description === 'string'
        && value.description === value.description.trim()
        && value.description.length >= 1
        && value.description.length <= 2_000))
    && typeof value.contractDigestSha256 === 'string'
    && DIGEST_PATTERN.test(value.contractDigestSha256)
    && typeof value.updatedAtMs === 'number'
    && Number.isSafeInteger(value.updatedAtMs)
    && value.updatedAtMs >= 0
    && fnIsCanonicalDimension(value.bounds.width, WIDGET_FRAME_MIN_WIDTH, WIDGET_FRAME_MAX_WIDTH)
    && fnIsCanonicalDimension(value.bounds.height, WIDGET_FRAME_MIN_HEIGHT, WIDGET_FRAME_MAX_HEIGHT);
}

export function fnValidatePublishedWidgetPlacementTargets(value: unknown): TTargetValidationResult {
  if (!Array.isArray(value) || value.length > PUBLISHED_CATALOG_MAX_TARGETS) {
    return { ok: false, message: 'Published widget catalog exceeds its safe boundary.' };
  }
  const definitionIds = new Set<string>();
  const revisionIds = new Set<string>();
  const names = new Set<string>();
  const slugs = new Set<string>();
  for (const target of value) {
    if (
      !fnIsPlacementTarget(target)
      || definitionIds.has(target.definitionId)
      || revisionIds.has(target.revisionId)
      || names.has(target.name)
      || slugs.has(target.slug)
    ) {
      return { ok: false, message: 'Published widget catalog is invalid.' };
    }
    definitionIds.add(target.definitionId);
    revisionIds.add(target.revisionId);
    names.add(target.name);
    slugs.add(target.slug);
  }
  return { ok: true, targets: value };
}

function fnPublishedPlacementGeneration(targets: readonly TPublishedWidgetPlacementTarget[]): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const pairs = targets
    .map((target) => `${target.definitionId}:${target.revisionId}`)
    .sort((left, right) => left.localeCompare(right));
  for (const pair of pairs) {
    for (let index = 0; index < pair.length; index += 1) {
      const code = pair.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    }
    first = Math.imul(first ^ 0xff, 0x01000193) >>> 0;
    second = Math.imul(second ^ 0xff, 0xc2b2ae35) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

export function fnPublishedWidgetPlacementReference(
  target: TPublishedWidgetPlacementIdentity,
): TWidgetPlacementRef {
  return {
    source: 'published',
    name: `${PUBLISHED_REFERENCE_PREFIX}${target.definitionId}`,
    revision: target.revisionId,
  };
}

export function fnParsePublishedWidgetPlacementReference(
  reference: TWidgetPlacementRef,
): TPublishedWidgetPlacementIdentity | null {
  if (reference.source !== 'published' || !reference.name.startsWith(PUBLISHED_REFERENCE_PREFIX)) return null;
  const definitionId = reference.name.slice(PUBLISHED_REFERENCE_PREFIX.length);
  if (!UUID_PATTERN.test(definitionId) || !UUID_PATTERN.test(reference.revision)) return null;
  return { definitionId, revisionId: reference.revision };
}

export function fnPublishedWidgetVariant(args: Readonly<{
  target: TPublishedWidgetPlacementTarget;
  updatedAt: string | null;
}>): TWidgetVariantSummary {
  return {
    draftId: null,
    source: 'published',
    displayName: args.target.name,
    kind: 'widget',
    slug: args.target.slug,
    description: args.target.description,
    revision: args.target.revisionId,
    contentFingerprint: args.target.contractDigestSha256,
    updatedAt: args.updatedAt,
    tool: {
      label: args.target.name,
      icon: null,
      group: null,
      priority: null,
      behaviorType: 'mode',
    },
    validation: null,
    placement: {
      reference: fnPublishedWidgetPlacementReference(args.target),
      bounds: args.target.bounds,
    },
  };
}

export function fnPublishedWidgetRelation(args: Readonly<{
  target: TPublishedWidgetPlacementTarget;
  draft: TWidgetVariantSummary | null;
  draftPublicationStates: readonly TDraftPublicationState[];
}>): TWidgetCatalogEntry['relation'] {
  if (!args.draft) return 'published-only';
  const state = args.draftPublicationStates.find((candidate) => (
    candidate.draftId === args.draft?.draftId
    && candidate.name === args.target.name
    && candidate.status !== 'discarded'
  ));
  if (!state) return 'unknown';
  return state.definitionId === args.target.definitionId
    && state.status === 'published'
    && state.publishedRevisionId === args.target.revisionId
    ? 'same'
    : 'different';
}

export function fnMergePublishedWidgetPlacementCatalog(args: TMergeArgs): TWidgetCatalog {
  if (args.targets.length === 0) return args.draftCatalog;
  const remaining = [...args.draftCatalog.widgets];
  const publishedEntries = args.targets.map((target): TWidgetCatalogEntry => {
    const matchIndex = remaining.findIndex((entry) => (
      entry.published?.slug === target.slug || entry.name === target.name
    ));
    const matched = matchIndex < 0 ? null : remaining.splice(matchIndex, 1)[0] ?? null;
    const published = fnPublishedWidgetVariant({ target, updatedAt: null });
    return {
      name: target.name,
      relation: fnPublishedWidgetRelation({
        target,
        draft: matched?.draft ?? null,
        draftPublicationStates: args.draftPublicationStates ?? [],
      }),
      published,
      draft: matched?.draft ?? null,
      preview: matched?.preview ?? null,
      problem: matched?.problem ?? null,
    };
  });
  const widgets = [...remaining, ...publishedEntries].sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name);
    if (nameOrder !== 0) return nameOrder;
    return (left.published?.placement?.reference.name ?? '')
      .localeCompare(right.published?.placement?.reference.name ?? '');
  });
  return {
    ...args.draftCatalog,
    generation: `${args.draftCatalog.generation}:published:${fnPublishedPlacementGeneration(args.targets)}`,
    widgets,
  };
}

export type { TMergeArgs, TDraftPublicationState };

import {
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
} from '@vibecanvas/widget-contract/CONSTANTS';
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@vibecanvas/widget-contract';
import type { TWidgetPlacementResolveResult } from '@vibecanvas/orpc-client';

type TWidgetPlacementDescriptor = Extract<
  TWidgetPlacementResolveResult,
  Readonly<{ ok: true }>
>['descriptor'];

type TArgsDescriptor = Readonly<{
  descriptor: unknown;
  expectedReference: TWidgetPlacementRef;
  expectedPreviewId: string | null;
}>;

type TResultDescriptor =
  | Readonly<{ ok: true; descriptor: TWidgetPlacementDescriptor }>
  | Readonly<{ ok: false; message: string }>;

type TDirectV2WidgetPlacementDescriptor = Readonly<{
  reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'published' }>>;
  bounds: TWidgetFrameBounds;
  definitionId: string;
  revisionId: string;
}>;

type TArgsDirectV2 = Readonly<{
  reference: unknown;
  bounds: unknown;
}>;

type TResultDirectV2 =
  | Readonly<{ kind: 'not-v2' }>
  | Readonly<{ kind: 'invalid'; message: string }>
  | Readonly<{ kind: 'valid'; descriptor: TDirectV2WidgetPlacementDescriptor }>;

const V2_REFERENCE_PREFIX = 'v2:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DESCRIPTOR_KEYS = Object.freeze([
  'bounds',
  'definitionId',
  'definitionName',
  'definitionSlug',
  'draftId',
  'kind',
  'previewId',
  'reference',
  'revisionId',
]);
const REFERENCE_KEYS = Object.freeze(['name', 'revision', 'source']);
const BOUNDS_KEYS = Object.freeze(['height', 'width']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalDimension(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function isExactReference(value: unknown, expected: TWidgetPlacementRef): boolean {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, REFERENCE_KEYS)
    && value.source === expected.source
    && value.name === expected.name
    && value.revision === expected.revision;
}

function isCanonicalBounds(value: unknown): value is TWidgetFrameBounds {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, BOUNDS_KEYS)
    && isCanonicalDimension(value.width, WIDGET_FRAME_MIN_WIDTH, WIDGET_FRAME_MAX_WIDTH)
    && isCanonicalDimension(value.height, WIDGET_FRAME_MIN_HEIGHT, WIDGET_FRAME_MAX_HEIGHT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function fnValidateDirectV2WidgetPlacement(args: TArgsDirectV2): TResultDirectV2 {
  const reference = args.reference;
  if (
    !isRecord(reference)
    || reference.source !== 'published'
    || typeof reference.name !== 'string'
    || !reference.name.startsWith(V2_REFERENCE_PREFIX)
  ) {
    return { kind: 'not-v2' };
  }
  if (!hasExactKeys(reference, REFERENCE_KEYS) || typeof reference.revision !== 'string') {
    return { kind: 'invalid', message: 'The v2 catalog returned an invalid widget reference.' };
  }
  const definitionId = reference.name.slice(V2_REFERENCE_PREFIX.length);
  if (!UUID_PATTERN.test(definitionId) || !UUID_PATTERN.test(reference.revision)) {
    return { kind: 'invalid', message: 'The v2 catalog returned an invalid widget identity.' };
  }
  if (!isCanonicalBounds(args.bounds)) {
    return { kind: 'invalid', message: 'The v2 catalog returned invalid widget bounds.' };
  }
  return {
    kind: 'valid',
    descriptor: {
      reference: {
        source: 'published',
        name: reference.name,
        revision: reference.revision,
      },
      bounds: {
        width: args.bounds.width,
        height: args.bounds.height,
      },
      definitionId,
      revisionId: reference.revision,
    },
  };
}

export function fnValidateWidgetPlacementDescriptor(args: TArgsDescriptor): TResultDescriptor {
  const descriptor = args.descriptor;
  if (!isRecord(descriptor)) {
    return { ok: false, message: 'The placement resolver returned an invalid widget descriptor.' };
  }
  if (!hasExactKeys(descriptor, DESCRIPTOR_KEYS)) {
    return { ok: false, message: 'The placement resolver returned an invalid widget descriptor shape.' };
  }
  if (!isExactReference(descriptor.reference, args.expectedReference)) {
    return { ok: false, message: 'The placement resolver returned a different widget revision.' };
  }
  if (!isCanonicalBounds(descriptor.bounds)) {
    return { ok: false, message: 'The placement resolver returned invalid widget bounds.' };
  }

  if (descriptor.kind === 'published-v2') {
    const encodedDefinitionId = args.expectedReference.name.startsWith(V2_REFERENCE_PREFIX)
      ? args.expectedReference.name.slice(V2_REFERENCE_PREFIX.length)
      : null;
    if (
      args.expectedReference.source !== 'published'
      || descriptor.draftId !== null
      || typeof descriptor.definitionId !== 'string'
      || !UUID_PATTERN.test(descriptor.definitionId)
      || descriptor.definitionId !== encodedDefinitionId
      || typeof descriptor.revisionId !== 'string'
      || !UUID_PATTERN.test(descriptor.revisionId)
      || descriptor.revisionId !== args.expectedReference.revision
      || descriptor.definitionName !== null
      || !isNonEmptyString(descriptor.definitionSlug)
      || descriptor.previewId !== null
      || args.expectedPreviewId !== null
    ) {
      return { ok: false, message: 'The placement resolver returned an invalid v2 widget identity.' };
    }
    return { ok: true, descriptor: descriptor as TWidgetPlacementDescriptor };
  }

  if (descriptor.kind === 'published-legacy') {
    if (
      args.expectedReference.source !== 'published'
      || descriptor.draftId !== null
      || descriptor.definitionId !== null
      || descriptor.revisionId !== null
      || !isNonEmptyString(descriptor.definitionName)
      || descriptor.definitionName !== args.expectedReference.name
      || !isNonEmptyString(descriptor.definitionSlug)
      || descriptor.previewId !== null
      || args.expectedPreviewId !== null
    ) {
      return { ok: false, message: 'The placement resolver returned an invalid legacy widget identity.' };
    }
    return { ok: true, descriptor: descriptor as TWidgetPlacementDescriptor };
  }

  if (descriptor.kind === 'preview') {
    if (
      args.expectedReference.source === 'published'
      || typeof descriptor.draftId !== 'string'
      || !UUID_PATTERN.test(descriptor.draftId)
      || descriptor.definitionId !== null
      || descriptor.revisionId !== null
      || descriptor.definitionName !== null
      || descriptor.definitionSlug !== null
      || !isNonEmptyString(descriptor.previewId)
      || descriptor.previewId !== args.expectedPreviewId
    ) {
      return { ok: false, message: 'The placement resolver returned an invalid Preview identity.' };
    }
    return { ok: true, descriptor: descriptor as TWidgetPlacementDescriptor };
  }

  return { ok: false, message: 'The placement resolver returned an unsupported widget kind.' };
}

export type {
  TArgsDescriptor,
  TArgsDirectV2,
  TDirectV2WidgetPlacementDescriptor,
  TResultDescriptor,
  TResultDirectV2,
};

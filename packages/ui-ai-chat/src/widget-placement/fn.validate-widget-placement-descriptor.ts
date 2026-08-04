import {
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
} from '@omnidraw/widget-contract/CONSTANTS';
import type { TCanvasWidgetResourceBindingV1 } from '@omnidraw/canvas-contract';
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@omnidraw/widget-contract';

type TPublishedReference = Extract<
  TWidgetPlacementRef,
  Readonly<{ source: 'published' }>
>;

type TPublishedWidgetPlacementDescriptor = Readonly<{
  kind: 'published';
  reference: TPublishedReference;
  widgetKey: string;
  catalogGeneration: number;
  bounds: TWidgetFrameBounds;
  resourceBindings: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>;
}>;

type TPreviewWidgetPlacementDescriptor = Readonly<{
  kind: 'preview';
  reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'draft' }>>;
  bounds: TWidgetFrameBounds;
  draftId: string;
}>;

type TWidgetPlacementDescriptor =
  | TPublishedWidgetPlacementDescriptor
  | TPreviewWidgetPlacementDescriptor;

type TArgsDescriptor = Readonly<{
  descriptor: unknown;
  expectedReference: TWidgetPlacementRef;
}>;

type TResultDescriptor =
  | Readonly<{ ok: true; descriptor: TWidgetPlacementDescriptor }>
  | Readonly<{ ok: false; message: string }>;

type TDirectPublishedWidgetPlacementDescriptor = TPublishedWidgetPlacementDescriptor;

type TArgsDirectPublished = Readonly<{
  reference: unknown;
  bounds: unknown;
}>;

type TResultDirectPublished =
  | Readonly<{ kind: 'not-published' }>
  | Readonly<{ kind: 'invalid'; message: string }>
  | Readonly<{ kind: 'valid'; descriptor: TDirectPublishedWidgetPlacementDescriptor }>;

const REFERENCE_KEYS = Object.freeze(['catalogGeneration', 'source', 'widgetKey']);
const PUBLISHED_DESCRIPTOR_KEYS = Object.freeze([
  'bounds',
  'catalogGeneration',
  'kind',
  'reference',
  'resourceBindings',
  'widgetKey',
]);
const BOUNDS_KEYS = Object.freeze(['height', 'width']);
const BINDING_KEYS = Object.freeze(['allowRead', 'allowWrite', 'resourceId']);
const WIDGET_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_SLOT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/;

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

function isWidgetKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 100
    && WIDGET_KEY_PATTERN.test(value);
}

function isCatalogGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isExactReference(value: unknown, expected: TWidgetPlacementRef): boolean {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, REFERENCE_KEYS)
    && value.source === expected.source
    && value.widgetKey === expected.widgetKey
    && value.catalogGeneration === expected.catalogGeneration;
}

function isCanonicalBounds(value: unknown): value is TWidgetFrameBounds {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, BOUNDS_KEYS)
    && isCanonicalDimension(value.width, WIDGET_FRAME_MIN_WIDTH, WIDGET_FRAME_MAX_WIDTH)
    && isCanonicalDimension(value.height, WIDGET_FRAME_MIN_HEIGHT, WIDGET_FRAME_MAX_HEIGHT);
}

function isResourceBindings(
  value: unknown,
): value is Readonly<Record<string, TCanvasWidgetResourceBindingV1>> {
  if (!isRecord(value) || Object.keys(value).length > 128) return false;
  return Object.entries(value).every(([slot, binding]) => (
    RESOURCE_SLOT_PATTERN.test(slot)
    && isRecord(binding)
    && hasExactKeys(binding, BINDING_KEYS)
    && typeof binding.resourceId === 'string'
    && binding.resourceId.length > 0
    && binding.resourceId.length <= 200
    && typeof binding.allowRead === 'boolean'
    && typeof binding.allowWrite === 'boolean'
    && (binding.allowRead || binding.allowWrite)
  ));
}

export function fnValidateDirectPublishedWidgetPlacement(
  args: TArgsDirectPublished,
): TResultDirectPublished {
  const reference = args.reference;
  if (!isRecord(reference) || reference.source !== 'published') {
    return { kind: 'not-published' };
  }
  if (
    !hasExactKeys(reference, REFERENCE_KEYS)
    || !isWidgetKey(reference.widgetKey)
    || !isCatalogGeneration(reference.catalogGeneration)
  ) {
    return { kind: 'invalid', message: 'The published catalog returned an invalid widget reference.' };
  }
  if (!isCanonicalBounds(args.bounds)) {
    return { kind: 'invalid', message: 'The published catalog returned invalid widget bounds.' };
  }
  const publishedReference: TPublishedReference = {
    source: 'published',
    widgetKey: reference.widgetKey,
    catalogGeneration: reference.catalogGeneration,
  };
  return {
    kind: 'valid',
    descriptor: {
      kind: 'published',
      reference: publishedReference,
      widgetKey: publishedReference.widgetKey,
      catalogGeneration: publishedReference.catalogGeneration,
      bounds: { width: args.bounds.width, height: args.bounds.height },
      resourceBindings: {},
    },
  };
}

export function fnValidateWidgetPlacementDescriptor(
  args: TArgsDescriptor,
): TResultDescriptor {
  const descriptor = args.descriptor;
  if (!isRecord(descriptor) || !isExactReference(descriptor.reference, args.expectedReference)) {
    return { ok: false, message: 'The placement resolver returned a different widget reference.' };
  }
  if (!isCanonicalBounds(descriptor.bounds)) {
    return { ok: false, message: 'The placement resolver returned invalid widget bounds.' };
  }
  if (descriptor.kind === 'published') {
    if (
      args.expectedReference.source !== 'published'
      || !hasExactKeys(descriptor, PUBLISHED_DESCRIPTOR_KEYS)
      || descriptor.widgetKey !== args.expectedReference.widgetKey
      || descriptor.catalogGeneration !== args.expectedReference.catalogGeneration
      || !isResourceBindings(descriptor.resourceBindings)
    ) {
      return { ok: false, message: 'The placement resolver returned an invalid published widget identity.' };
    }
    return { ok: true, descriptor: descriptor as TPublishedWidgetPlacementDescriptor };
  }
  if (
    descriptor.kind === 'preview'
    && args.expectedReference.source === 'draft'
    && typeof descriptor.draftId === 'string'
    && descriptor.draftId.trim().length > 0
  ) {
    return {
      ok: true,
      descriptor: {
        kind: 'preview',
        reference: args.expectedReference,
        bounds: descriptor.bounds,
        draftId: descriptor.draftId,
      },
    };
  }
  return { ok: false, message: 'The placement resolver returned an unsupported widget kind.' };
}

export type {
  TArgsDescriptor,
  TArgsDirectPublished,
  TDirectPublishedWidgetPlacementDescriptor,
  TResultDescriptor,
  TResultDirectPublished,
};

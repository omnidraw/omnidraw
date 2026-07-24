import { isValidAutomergeUrl } from '@automerge/automerge-repo';
import { z } from 'zod';

const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const zLowercaseUuid = z.string().regex(LOWERCASE_UUID_PATTERN, 'Expected a lowercase UUID.');
const zAutomergeDocumentUrl = z.string().refine(
  (value) => isValidAutomergeUrl(value) && !value.includes('#'),
  'Expected a canonical Automerge document URL without heads.',
);

export const zPoint2D = z.tuple([z.number(), z.number()]);
export const zElementId = z.string().refine(
  (value) => value.trim() === value && value.length >= 1 && value.length <= 200,
  'Expected 1 to 200 trimmed characters.',
);

export const zJsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(zJsonValue),
  z.record(z.string(), zJsonValue),
]));

const WIDGET_UI_PROPS_MAX_DEPTH = 4;
const WIDGET_UI_PROPS_MAX_COLLECTION_ITEMS = 64;
const WIDGET_UI_PROPS_MAX_TOTAL_ITEMS = 512;
const WIDGET_UI_PROPS_MAX_STRING_CODE_UNITS = 1_024;
const WIDGET_UI_PROPS_MAX_TOTAL_STRING_CODE_UNITS = 8_192;
const WIDGET_UI_PROPS_MAX_KEY_CODE_UNITS = 64;

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

const zWidgetUiPropString = z.string()
  .max(WIDGET_UI_PROPS_MAX_STRING_CODE_UNITS)
  .refine(isWellFormedUnicode, 'Expected well-formed Unicode.');
const zWidgetUiPropKey = z.string()
  .max(WIDGET_UI_PROPS_MAX_KEY_CODE_UNITS)
  .refine(isWellFormedUnicode, 'Expected a well-formed Unicode key.');
const zWidgetUiPropPrimitive = z.union([
  zWidgetUiPropString,
  z.number(),
  z.boolean(),
  z.null(),
]);

function zWidgetUiPropValue(depth: number): z.ZodType<unknown> {
  if (depth === 0) return zWidgetUiPropPrimitive;
  const child = zWidgetUiPropValue(depth - 1);
  return z.union([
    zWidgetUiPropPrimitive,
    z.array(child).max(WIDGET_UI_PROPS_MAX_COLLECTION_ITEMS),
    z.record(
      zWidgetUiPropKey,
      child,
    ).refine(
      (value) => Object.keys(value).length <= WIDGET_UI_PROPS_MAX_COLLECTION_ITEMS,
      'Widget UI props object has too many keys.',
    ),
  ]);
}

function widgetUiPropsMetrics(value: unknown): Readonly<{
  items: number;
  stringCodeUnits: number;
}> {
  if (typeof value === 'string') {
    return { items: 1, stringCodeUnits: value.length };
  }
  if (value === null || typeof value !== 'object') {
    return { items: 1, stringCodeUnits: 0 };
  }
  const children = Array.isArray(value)
    ? value
    : Object.entries(value).flatMap(([key, child]) => [key, child]);
  return children.reduce(
    (metrics, child) => {
      const nested = widgetUiPropsMetrics(child);
      return {
        items: metrics.items + nested.items,
        stringCodeUnits: metrics.stringCodeUnits + nested.stringCodeUnits,
      };
    },
    { items: 1, stringCodeUnits: 0 },
  );
}

export const zWidgetUiProps = z.record(
  zWidgetUiPropKey,
  zWidgetUiPropValue(WIDGET_UI_PROPS_MAX_DEPTH),
).superRefine((value, context) => {
  if (Object.keys(value).length > WIDGET_UI_PROPS_MAX_COLLECTION_ITEMS) {
    context.addIssue({
      code: 'custom',
      message: 'Widget UI props object has too many keys.',
    });
  }
  const metrics = widgetUiPropsMetrics(value);
  if (metrics.items > WIDGET_UI_PROPS_MAX_TOTAL_ITEMS) {
    context.addIssue({
      code: 'custom',
      message: 'Widget UI props contain too many values.',
    });
  }
  if (
    metrics.stringCodeUnits
    > WIDGET_UI_PROPS_MAX_TOTAL_STRING_CODE_UNITS
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Widget UI props contain too much text.',
    });
  }
});

export const zBinding = z.object({
  targetId: z.string(),
  anchor: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const zBaseElement = z.object({
  id: zElementId,
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  zIndex: z.string(),
  parentGroupId: z.string().nullable(),
  bindings: z.array(zBinding),
  locked: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const zTextAlign = z.union([z.literal('left'), z.literal('center'), z.literal('right')]);
const zVerticalAlign = z.union([z.literal('top'), z.literal('middle'), z.literal('bottom')]);

export const zDrawingStyle = z.object({
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.string().optional(),
  opacity: z.number().optional(),
  cornerRadius: z.string().optional(),
  strokeStyle: z.union([z.literal('solid'), z.literal('dashed'), z.literal('dotted')]).optional(),
  fontSize: z.string().optional(),
  textAlign: zTextAlign.optional(),
  verticalAlign: zVerticalAlign.optional(),
});

export const zTextData = z.object({
  type: z.literal('text'),
  w: z.number(),
  h: z.number(),
  text: z.string(),
  originalText: z.string(),
  fontFamily: z.string(),
  link: z.string().nullable(),
  containerId: z.string().nullable(),
  autoResize: z.boolean(),
});

export const zRectData = z.object({
  type: z.literal('rect'),
  w: z.number(),
  h: z.number(),
  radius: z.number().optional(),
  text: zTextData.optional()
});

export const zEllipseData = z.object({
  type: z.literal('ellipse'),
  rx: z.number(),
  ry: z.number(),
  text: zTextData.optional()
});

export const zDiamondData = z.object({
  type: z.literal('diamond'),
  w: z.number(),
  h: z.number(),
  radius: z.number().optional(),
  text: zTextData.optional()
});

export const zLineData = z.object({
  type: z.literal('line'),
  lineType: z.union([z.literal('straight'), z.literal('curved')]),
  points: z.array(zPoint2D),
  startBinding: zBinding.nullable(),
  endBinding: zBinding.nullable(),
});

export const zArrowData = z.object({
  type: z.literal('arrow'),
  lineType: z.union([z.literal('straight'), z.literal('curved')]),
  points: z.array(zPoint2D),
  startBinding: zBinding.nullable(),
  endBinding: zBinding.nullable(),
  startCap: z.union([z.literal('none'), z.literal('arrow'), z.literal('dot'), z.literal('diamond')]),
  endCap: z.union([z.literal('none'), z.literal('arrow'), z.literal('dot'), z.literal('diamond')]),
});

export const zPenData = z.object({
  type: z.literal('pen'),
  points: z.array(zPoint2D),
  pressures: z.array(z.number()),
  simulatePressure: z.boolean(),
});

export const zImageData = z.object({
  type: z.literal('image'),
  url: z.string().nullable(),
  base64: z.string().nullable(),
  w: z.number(),
  h: z.number(),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    naturalWidth: z.number(),
    naturalHeight: z.number(),
  }),
});

export const zWidgetWindow = z.enum(['contained', 'minimized', 'fullscreen']);

export const zUiWidgetData = z.object({
  type: z.literal('ui-widget'),
  kind: z.string(),
  w: z.number(),
  h: z.number(),
  expanded: z.boolean(),
  window: zWidgetWindow,
  payload: z.record(z.string(), zJsonValue).optional(),
  uiProps: zWidgetUiProps.optional(),
}).strict();

export const zWidgetInstanceData = z.object({
  type: z.literal('widget-instance'),
  definitionId: zLowercaseUuid,
  revisionId: zLowercaseUuid,
  instanceId: zLowercaseUuid,
  stateDocumentId: zAutomergeDocumentUrl.optional(),
  uiProps: zWidgetUiProps.optional(),
  w: z.number(),
  h: z.number(),
  expanded: z.boolean(),
  window: zWidgetWindow,
}).strict();

export const zElementData = z.union([
  zRectData,
  zEllipseData,
  zDiamondData,
  zArrowData,
  zLineData,
  zPenData,
  zTextData,
  zImageData,
  zUiWidgetData,
  zWidgetInstanceData,
]);

export const zElementStyle = z.object({
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.string().optional(),
  opacity: z.number().optional(),
  cornerRadius: z.string().optional(),
  strokeStyle: z.union([z.literal('solid'), z.literal('dashed'), z.literal('dotted')]).optional(),
  fontSize: z.string().optional(),
  textAlign: zTextAlign.optional(),
  verticalAlign: zVerticalAlign.optional(),
});

export const zElement = zBaseElement.extend({
  data: zElementData,
  style: zElementStyle,
});

export const zGroup = z.object({
  id: z.string(),
  parentGroupId: z.string().nullable(),
  zIndex: z.string(),
  locked: z.boolean(),
  createdAt: z.number(),
});

export const zCanvasDoc = z.object({
  id: z.string(),
  name: z.string(),
  elements: z.record(zElementId, zElement),
  groups: z.record(z.string(), zGroup),
}).superRefine((document, context) => {
  for (const [elementKey, element] of Object.entries(document.elements)) {
    if (elementKey === element.id) continue;
    context.addIssue({
      code: 'custom',
      path: ['elements', elementKey, 'id'],
      message: 'Element key must match its persisted element id.',
    });
  }
});

import { z } from 'zod';

export const zPoint2D = z.tuple([z.number(), z.number()]);

export const zBinding = z.object({
  targetId: z.string(),
  anchor: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const zBaseElement = z.object({
  id: z.string(),
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

export const zWidgetOfficialMachineState = z.enum([
  'booting',
  'ready',
  'busy',
  'waiting',
  'dirty',
  'error',
  'disabled',
  'disposed',
]);

export const zWidgetMachineCurrent = z.object({
  value: z.string(),
  changedAt: z.number(),
  meta: z.record(z.string(), z.unknown()),
});

export const zWidgetMachine = zWidgetMachineCurrent;

export const zWidgetPortPath = z.array(z.string().min(1)).min(1);

export const zWidgetConnectionLine = z.object({
  sourceArc: z.number(),
  targetArc: z.number(),
  waypoints: z.array(zPoint2D),
});

export const zWidgetInputConnection = z.object({
  id: z.string(),
  filterPort: zWidgetPortPath.optional(),
  sourceWidgetId: z.string(),
  sourceFilterPort: zWidgetPortPath.optional(),
  line: zWidgetConnectionLine,
});

export const zWidgetOutputConnection = z.object({
  id: z.string(),
  filterPort: zWidgetPortPath.optional(),
  targetWidgetId: z.string(),
  targetFilterPort: zWidgetPortPath.optional(),
});

export const zWidgetConnections = z.object({
  inputs: z.array(zWidgetInputConnection),
  outputs: z.array(zWidgetOutputConnection),
});

export const zWidgetData = z.object({
  type: z.literal('widget'),
  kind: z.string(),
  w: z.number(),
  h: z.number(),
  expanded: z.boolean(),
  window: z.enum(['contained', 'minimized', 'fullscreen']),
  payload: z.record(z.string(), z.any()),
  machine: zWidgetMachine.optional(),
  connections: zWidgetConnections.optional(),
});



export const zElementData = z.union([
  zRectData,
  zEllipseData,
  zDiamondData,
  zArrowData,
  zLineData,
  zPenData,
  zTextData,
  zImageData,
  zWidgetData,
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
  elements: z.record(z.string(), zElement),
  groups: z.record(z.string(), zGroup),
});

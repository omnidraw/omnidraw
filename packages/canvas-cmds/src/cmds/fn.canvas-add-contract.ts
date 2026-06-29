/* eslint-disable functional-core/export-shape -- legacy canvas command contract builders keep public build* names */
import type { TArrowData, TDiamondData, TEllipseData, TElementData, TElementStyle, TLineData, TRectData, TTextData } from '@vibecanvas/service-automerge/types/canvas-doc';
import type { TAddPrimitiveType, TCanvasAddElementInput } from './tx.cmd.add';

export type TCanvasAddFieldDefault = {
  path: string;
  defaultValue: string;
};

export type TCanvasAddTypeContract = {
  type: TAddPrimitiveType;
  required: string[];
  optionalDefaults: TCanvasAddFieldDefault[];
  minimalJson: Record<string, unknown>;
};

function fxCloneDefaults<T>(value: T): T {
  return structuredClone(value);
}

const DEFAULT_STYLE: TElementStyle = {
  backgroundColor: '#ffffff',
  strokeColor: '#111111',
  strokeWidth: '@stroke-width/thin',
  opacity: 1,
};

const COMMON_OPTIONAL_DEFAULTS: TCanvasAddFieldDefault[] = [
  { path: 'x', defaultValue: '0' },
  { path: 'y', defaultValue: '0' },
  { path: 'rotation', defaultValue: '0' },
  { path: 'parentGroupId', defaultValue: 'null' },
  { path: 'locked', defaultValue: 'false' },
  { path: 'style.backgroundColor', defaultValue: JSON.stringify(DEFAULT_STYLE.backgroundColor) },
  { path: 'style.strokeColor', defaultValue: JSON.stringify(DEFAULT_STYLE.strokeColor) },
  { path: 'style.strokeWidth', defaultValue: String(DEFAULT_STYLE.strokeWidth) },
  { path: 'style.opacity', defaultValue: String(DEFAULT_STYLE.opacity) },
];

const TYPE_CONTRACTS: TCanvasAddTypeContract[] = [
  {
    type: 'rect',
    required: ['type'],
    optionalDefaults: [
      ...COMMON_OPTIONAL_DEFAULTS,
      { path: 'data.w', defaultValue: '120' },
      { path: 'data.h', defaultValue: '80' },
    ],
    minimalJson: { type: 'rect' },
  },
  {
    type: 'ellipse',
    required: ['type'],
    optionalDefaults: [
      ...COMMON_OPTIONAL_DEFAULTS,
      { path: 'data.rx', defaultValue: '60' },
      { path: 'data.ry', defaultValue: '40' },
    ],
    minimalJson: { type: 'ellipse' },
  },
  {
    type: 'diamond',
    required: ['type'],
    optionalDefaults: [
      ...COMMON_OPTIONAL_DEFAULTS,
      { path: 'data.w', defaultValue: '120' },
      { path: 'data.h', defaultValue: '80' },
    ],
    minimalJson: { type: 'diamond' },
  },
  {
    type: 'text',
    required: ['type'],
    optionalDefaults: [
      ...COMMON_OPTIONAL_DEFAULTS,
      { path: 'data.w', defaultValue: '120' },
      { path: 'data.h', defaultValue: '40' },
      { path: 'data.text', defaultValue: JSON.stringify('hello') },
      { path: 'data.originalText', defaultValue: 'same as data.text' },
      { path: 'data.fontFamily', defaultValue: JSON.stringify('Inter') },
      { path: 'style.fontSize', defaultValue: JSON.stringify('@text/s') },
      { path: 'style.textAlign', defaultValue: JSON.stringify('left') },
      { path: 'style.verticalAlign', defaultValue: JSON.stringify('top') },
      { path: 'data.link', defaultValue: 'null' },
      { path: 'data.containerId', defaultValue: 'null' },
      { path: 'data.autoResize', defaultValue: 'false' },
    ],
    minimalJson: { type: 'text' },
  },
  {
    type: 'line',
    required: ['type'],
    optionalDefaults: [
      ...COMMON_OPTIONAL_DEFAULTS,
      { path: 'data.lineType', defaultValue: JSON.stringify('straight') },
      { path: 'data.points', defaultValue: '[[0,0],[120,0]]' },
      { path: 'data.startBinding', defaultValue: 'null' },
      { path: 'data.endBinding', defaultValue: 'null' },
    ],
    minimalJson: { type: 'line' },
  },
  {
    type: 'arrow',
    required: ['type'],
    optionalDefaults: [
      ...COMMON_OPTIONAL_DEFAULTS,
      { path: 'data.lineType', defaultValue: JSON.stringify('straight') },
      { path: 'data.points', defaultValue: '[[0,0],[120,0]]' },
      { path: 'data.startBinding', defaultValue: 'null' },
      { path: 'data.endBinding', defaultValue: 'null' },
      { path: 'data.startCap', defaultValue: JSON.stringify('none') },
      { path: 'data.endCap', defaultValue: JSON.stringify('arrow') },
    ],
    minimalJson: { type: 'arrow' },
  },
];

export function fxDefaultCanvasAddStyle(): TElementStyle {
  return fxCloneDefaults(DEFAULT_STYLE);
}

export function fxListCanvasAddTypeContracts(): TCanvasAddTypeContract[] {
  return TYPE_CONTRACTS.map((contract) => ({
    ...contract,
    required: [...contract.required],
    optionalDefaults: contract.optionalDefaults.map((entry) => ({ ...entry })),
    minimalJson: fxCloneDefaults(contract.minimalJson),
  }));
}

export function fxBuildCanvasAddData(type: TAddPrimitiveType, raw: Record<string, unknown>): TElementData {
  if (type === 'rect') return { type: 'rect', w: 120, h: 80, ...(raw as Partial<TRectData>) };
  if (type === 'ellipse') return { type: 'ellipse', rx: 60, ry: 40, ...(raw as Partial<TEllipseData>) };
  if (type === 'diamond') return { type: 'diamond', w: 120, h: 80, ...(raw as Partial<TDiamondData>) };
  if (type === 'text') {
    const input = raw as Partial<TTextData>;
    const text = typeof input.text === 'string' ? input.text : typeof input.originalText === 'string' ? input.originalText : 'hello';
    const originalText = typeof input.originalText === 'string' ? input.originalText : text;
    return {
      type: 'text',
      w: 120,
      h: 40,
      text,
      originalText,
      fontFamily: 'Inter',
      link: null,
      containerId: null,
      autoResize: false,
      ...input,
    };
  }
  if (type === 'line') return { type: 'line', lineType: 'straight', points: [[0, 0], [120, 0]], startBinding: null, endBinding: null, ...(raw as Partial<TLineData>) };
  return { type: 'arrow', lineType: 'straight', points: [[0, 0], [120, 0]], startBinding: null, endBinding: null, startCap: 'none', endCap: 'arrow', ...(raw as Partial<TArrowData>) };
}

export function fxRenderCanvasAddContracts(): string {
  return `Minimal JSON payloads and defaults:
${fxListCanvasAddTypeContracts().map((contract) => `  ${contract.type}
    required: ${contract.required.join(', ')}
    minimal: ${JSON.stringify(contract.minimalJson)}
    defaults: ${contract.optionalDefaults.map((entry) => `${entry.path}=${entry.defaultValue}`).join('; ')}`).join('\n\n')}`;
}

export function fxNormalizeCanvasAddElementInput(input: TCanvasAddElementInput): TCanvasAddElementInput {
  return {
    ...input,
    data: input.data === undefined ? undefined : fxCloneDefaults(input.data),
    style: input.style === undefined ? undefined : fxCloneDefaults(input.style),
  };
}

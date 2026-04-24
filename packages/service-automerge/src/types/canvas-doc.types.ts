import type { z } from 'zod';
import type {
  zArrowData,
  zBaseElement,
  zBinding,
  zCanvasDoc,
  zDiamondData,
  zDrawingStyle,
  zElement,
  zElementData,
  zElementStyle,
  zEllipseData,
  zFileData,
  zFiletreeData,
  zGroup,
  zIframeBrowserData,
  zIframeBrowserTab,
  zImageData,
  zLineData,
  zPenData,
  zPoint2D,
  zRectData,
  zTerminalData,
  zTextData,
  zWidgetData,
} from './canvas-doc.zod';

export type TPoint2D = z.infer<typeof zPoint2D>;
export type TBinding = z.infer<typeof zBinding>;
export type TBaseElement = z.infer<typeof zBaseElement>;
export type TDrawingStyle = z.infer<typeof zDrawingStyle>;
export type TRectData = z.infer<typeof zRectData>;
export type TEllipseData = z.infer<typeof zEllipseData>;
export type TDiamondData = z.infer<typeof zDiamondData>;
export type TLineData = z.infer<typeof zLineData>;
export type TArrowData = z.infer<typeof zArrowData>;
export type TPenData = z.infer<typeof zPenData>;
export type TTextData = z.infer<typeof zTextData>;
export type TImageData = z.infer<typeof zImageData>;
export type TFiletreeData = z.infer<typeof zFiletreeData>;
export type TTerminalData = z.infer<typeof zTerminalData>;
export type TFileData = z.infer<typeof zFileData>;
export type TIframeBrowserTab = z.infer<typeof zIframeBrowserTab>;
export type TIframeBrowserData = z.infer<typeof zIframeBrowserData>;
export type TWidgetData = z.infer<typeof zWidgetData>;


export type TElementData = z.infer<typeof zElementData>;
export type TElementStyle = z.infer<typeof zElementStyle>;
export type TElement = z.infer<typeof zElement>;
export type TGroup = z.infer<typeof zGroup>;
export type TCanvasDoc = z.infer<typeof zCanvasDoc>;

export type TElementType = TElementData['type'];
export type TDrawingType = 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'pen' | 'text' | 'image';
/**
 * @deprecated will be part of TWidgetData
 */
export type TWidgetType = 'filetree' | 'terminal' | 'file' | 'iframe-browser';

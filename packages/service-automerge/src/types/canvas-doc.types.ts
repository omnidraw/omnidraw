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
  zGroup,
  zImageData,
  zJsonValue,
  zLineData,
  zPenData,
  zPoint2D,
  zRectData,
  zTextData,
  zWidgetConnectionLine,
  zWidgetConnections,
  zWidgetData,
  zWidgetInputConnection,
  zWidgetMachine,
  zWidgetMachineCurrent,
  zWidgetMachineValue,
  zWidgetOfficialMachineState,
  zWidgetOutputConnection,
  zWidgetPortPath,
} from './canvas-doc.zod';

export type TPoint2D = z.infer<typeof zPoint2D>;
export type TJsonValue = z.infer<typeof zJsonValue>;
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
export type TWidgetOfficialMachineState = z.infer<typeof zWidgetOfficialMachineState>;
export type TWidgetMachineValue = z.infer<typeof zWidgetMachineValue>;
export type TWidgetMachineCurrent = z.infer<typeof zWidgetMachineCurrent>;
export type TWidgetMachine = z.infer<typeof zWidgetMachine>;
export type TWidgetPortPath = z.infer<typeof zWidgetPortPath>;
export type TWidgetConnectionLine = z.infer<typeof zWidgetConnectionLine>;
export type TWidgetInputConnection = z.infer<typeof zWidgetInputConnection>;
export type TWidgetOutputConnection = z.infer<typeof zWidgetOutputConnection>;
export type TWidgetConnections = z.infer<typeof zWidgetConnections>;
export type TWidgetData = z.infer<typeof zWidgetData>;


export type TElementData = z.infer<typeof zElementData>;
export type TElementStyle = z.infer<typeof zElementStyle>;
export type TElement = z.infer<typeof zElement>;
export type TGroup = z.infer<typeof zGroup>;
export type TCanvasDoc = z.infer<typeof zCanvasDoc>;

export type TElementType = TElementData['type'];
export type TDrawingType = 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'pen' | 'text' | 'image';

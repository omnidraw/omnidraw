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
  zLineData,
  zPenData,
  zPoint2D,
  zRectData,
  zTextData,
  zWidgetData,
  zWidgetMachine,
  zWidgetMachineCurrent,
  zWidgetMachineGraph,
  zWidgetMachineStateNode,
  zWidgetMachineTransition,
  zWidgetOfficialMachineState,
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
export type TWidgetOfficialMachineState = z.infer<typeof zWidgetOfficialMachineState>;
export type TWidgetMachineCurrent = z.infer<typeof zWidgetMachineCurrent>;
export type TWidgetMachineStateNode = z.infer<typeof zWidgetMachineStateNode>;
export type TWidgetMachineTransition = z.infer<typeof zWidgetMachineTransition>;
export type TWidgetMachineGraph = z.infer<typeof zWidgetMachineGraph>;
export type TWidgetMachine = z.infer<typeof zWidgetMachine>;
export type TWidgetData = z.infer<typeof zWidgetData>;


export type TElementData = z.infer<typeof zElementData>;
export type TElementStyle = z.infer<typeof zElementStyle>;
export type TElement = z.infer<typeof zElement>;
export type TGroup = z.infer<typeof zGroup>;
export type TCanvasDoc = z.infer<typeof zCanvasDoc>;

export type TElementType = TElementData['type'];
export type TDrawingType = 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'pen' | 'text' | 'image';

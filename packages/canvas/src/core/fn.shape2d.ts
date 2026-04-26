import type { TElement, TElementStyle, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  DEFAULT_ATTACHED_TEXT_ALIGN,
  DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  TEXT_FONT_SIZE_TOKEN_BY_PRESET,
} from "../plugins/text/CONSTANTS";

export type TShape2dPoint = {
  x: number;
  y: number;
};

export type TShape2dToolId = "rect" | "diamond" | "ellipse";
export type TShape2dElementType = "rect" | "diamond" | "ellipse";
export type TShape2dBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type TShape2dSize = {
  width: number;
  height: number;
};
type TShape2dElementData = Extract<TElement["data"], { type: TShape2dElementType }>;
type TShape2dElement = Omit<TElement, "data"> & { data: TShape2dElementData };
type TTextElement = Omit<TElement, "data"> & { data: TTextData };

const DEFAULT_STYLE: TElementStyle = {
  opacity: 1,
  strokeWidth: "@stroke-width/none",
};

export function fnIsShape2dToolId(toolId: string): toolId is TShape2dToolId {
  return toolId === "rect" || toolId === "diamond" || toolId === "ellipse";
}

export function fnIsShape2dElementType(elementType: string): elementType is TShape2dElementType {
  return elementType === "rect" || elementType === "diamond" || elementType === "ellipse";
}

export function fnGetShape2dElementTypeFromTool(toolId: TShape2dToolId): TShape2dElementType {
  if (toolId === "rect") {
    return "rect";
  }

  if (toolId === "diamond") {
    return "diamond";
  }

  return "ellipse";
}

export function fnGetShape2dDraftBounds(args: {
  origin: TShape2dPoint;
  point: TShape2dPoint;
  preserveRatio: boolean;
}): TShape2dBounds {
  const deltaX = args.point.x - args.origin.x;
  const deltaY = args.point.y - args.origin.y;

  if (!args.preserveRatio) {
    return {
      x: Math.min(args.origin.x, args.point.x),
      y: Math.min(args.origin.y, args.point.y),
      width: Math.abs(deltaX),
      height: Math.abs(deltaY),
    };
  }

  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  return {
    x: args.origin.x + (deltaX < 0 ? -size : 0),
    y: args.origin.y + (deltaY < 0 ? -size : 0),
    width: size,
    height: size,
  };
}

export function fnGetDiamondPoints(args: { width: number; height: number }) {
  return [
    args.width / 2,
    0,
    args.width,
    args.height / 2,
    args.width / 2,
    args.height,
    0,
    args.height / 2,
  ];
}

export function fnGetShape2dElementSize(element: TElement): TShape2dSize | null {
  if (element.data.type === "rect" || element.data.type === "diamond") {
    return {
      width: element.data.w,
      height: element.data.h,
    } satisfies TShape2dSize;
  }

  if (element.data.type === "ellipse") {
    return {
      width: element.data.rx * 2,
      height: element.data.ry * 2,
    } satisfies TShape2dSize;
  }

  return null;
}

export function fnGetShape2dTextData(element: TElement): TTextData | null {
  if (element.data.type === "rect" || element.data.type === "diamond" || element.data.type === "ellipse") {
    return element.data.text ?? null;
  }

  return null;
}

export function fnCreateShape2dTextData(args: {
  width: number;
  height: number;
  text?: string;
  originalText?: string;
  fontFamily?: string;
  link?: string | null;
}) {
  return {
    type: "text",
    w: Math.max(4, args.width),
    h: Math.max(4, args.height),
    text: args.text ?? "",
    originalText: args.originalText ?? args.text ?? "",
    fontFamily: args.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
    link: args.link ?? null,
    containerId: null,
    autoResize: false,
  } satisfies TTextData;
}

export function fnCreateShape2dInlineTextElement(args: {
  element: TElement;
  text: string;
  fontFamily: string;
  minHeight?: number;
}) {
  if (!fnIsShape2dElementType(args.element.data.type)) {
    return args.element;
  }

  const shapeElement = args.element as TShape2dElement;
  const grownElement = (args.minHeight !== undefined
    ? fnGrowShape2dElementHeight({ element: shapeElement, minHeight: args.minHeight })
    : structuredClone(shapeElement)) as TShape2dElement;
  const size = fnGetShape2dElementSize(grownElement);
  if (!size) {
    return grownElement;
  }

  const existingText = fnGetShape2dTextData(grownElement);

  return {
    ...grownElement,
    style: {
      ...grownElement.style,
      fontSize: grownElement.style.fontSize ?? TEXT_FONT_SIZE_TOKEN_BY_PRESET.M,
      textAlign: grownElement.style.textAlign ?? DEFAULT_ATTACHED_TEXT_ALIGN,
      verticalAlign: grownElement.style.verticalAlign ?? DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
    },
    data: {
      ...grownElement.data,
      text: {
        ...(existingText ?? fnCreateShape2dTextData({
          width: size.width,
          height: size.height,
        })),
        w: Math.max(4, size.width),
        h: Math.max(4, size.height),
        text: args.text,
        originalText: args.text,
        fontFamily: args.fontFamily,
        link: existingText?.link ?? null,
        containerId: null,
        autoResize: false,
      },
    },
  } satisfies TShape2dElement;
}

export function fnRemoveShape2dInlineText(element: TElement) {
  if (element.data.type !== "rect" && element.data.type !== "diamond" && element.data.type !== "ellipse") {
    return element;
  }

  const shapeElement = element as TShape2dElement;
  const { text: _text, ...dataWithoutText } = shapeElement.data;
  return {
    ...structuredClone(shapeElement),
    data: dataWithoutText,
  } satisfies TShape2dElement;
}

export function fnGrowShape2dElementHeight(args: {
  element: TElement;
  minHeight: number;
}) {
  if (args.element.data.type === "rect") {
    return {
      ...structuredClone(args.element),
      data: {
        ...args.element.data,
        h: Math.max(args.element.data.h, args.minHeight),
      },
    } satisfies TElement;
  }

  if (args.element.data.type === "diamond") {
    return {
      ...structuredClone(args.element),
      data: {
        ...args.element.data,
        h: Math.max(args.element.data.h, args.minHeight),
      },
    } satisfies TElement;
  }

  if (args.element.data.type === "ellipse") {
    return {
      ...structuredClone(args.element),
      data: {
        ...args.element.data,
        ry: Math.max(args.element.data.ry * 2, args.minHeight) / 2,
      },
    } satisfies TElement;
  }

  return structuredClone(args.element);
}

function fnIsLegacyAttachedTextElement(element: TElement): element is TTextElement {
  return element.data.type === "text" && element.data.containerId !== null;
}

export function fnCreateShape2dElement(args: {
  id: string;
  type: TShape2dElementType;
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  parentGroupId: string | null;
  zIndex: string;
  style?: Partial<TElementStyle>;
  text?: TTextData | null;
}): TElement {
  const style: TElementStyle = {
    ...DEFAULT_STYLE,
    ...(args.style ?? {}),
  };

  return {
    id: args.id,
    x: args.x,
    y: args.y,
    rotation: args.rotation,
    scaleX: 1,
    scaleY: 1,
    bindings: [],
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    locked: false,
    parentGroupId: args.parentGroupId,
    zIndex: args.zIndex,
    style,
    data: args.type === "ellipse"
      ? {
          type: "ellipse",
          rx: args.width / 2,
          ry: args.height / 2,
          text: args.text ?? undefined,
        }
      : {
          type: args.type,
          w: args.width,
          h: args.height,
          text: args.text ?? undefined,
        },
  } satisfies TElement;
}

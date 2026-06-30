import type { TArrowData, TElement, TElementStyle, TLineData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TSelectionStyleProperty } from "./fn.selection-style-menu";
import type { TCapStyle, TLineType } from "../components/SelectionStyleMenu/types";
import { fnGetShape2dTextData } from "./fn.shape2d";

export type TPortalSelectionStyleElementPatch = {
  now: () => number;
};

export type TArgsCloneElementWithSelectionStyle = {
  element: TElement;
  style: Partial<TElementStyle>;
};

export function fxCloneElementWithSelectionStyle(
  portal: TPortalSelectionStyleElementPatch,
  args: TArgsCloneElementWithSelectionStyle,
): TElement {
  return {
    ...structuredClone(args.element),
    updatedAt: portal.now(),
    style: {
      ...structuredClone(args.element.style),
      ...args.style,
    },
  };
}

export type TArgsCreateSelectionStyleDataPatch = {
  element: TElement;
  property: Extract<TSelectionStyleProperty, "fontFamily" | "fontSize" | "lineType" | "startCap" | "endCap">;
  value: string;
};

export function fxCreateSelectionStyleDataPatch(
  portal: TPortalSelectionStyleElementPatch,
  args: TArgsCreateSelectionStyleDataPatch,
): TElement | null {
  if (args.property === "fontFamily" && args.element.data.type === "text") {
    return {
      ...structuredClone(args.element),
      updatedAt: portal.now(),
      data: {
        ...args.element.data,
        fontFamily: args.value,
      },
    };
  }

  if (args.property === "fontFamily") {
    const shapeTextData = fnGetShape2dTextData(args.element);
    if (shapeTextData && args.element.data.type !== "text") {
      return {
        ...structuredClone(args.element),
        updatedAt: portal.now(),
        data: {
          ...(args.element.data as Exclude<TElement["data"], { type: "text" }>),
          text: {
            ...shapeTextData,
            fontFamily: args.value,
          },
        },
      } as TElement;
    }
  }

  if (args.property === "fontSize" && args.element.data.type === "text") {
    return {
      ...structuredClone(args.element),
      updatedAt: portal.now(),
      style: {
        ...structuredClone(args.element.style),
        fontSize: args.value,
      },
    };
  }

  if (args.property === "fontSize" && fnGetShape2dTextData(args.element)) {
    return {
      ...structuredClone(args.element),
      updatedAt: portal.now(),
      style: {
        ...structuredClone(args.element.style),
        fontSize: args.value,
      },
    };
  }

  if (args.property === "lineType" && (args.element.data.type === "line" || args.element.data.type === "arrow")) {
    return {
      ...structuredClone(args.element),
      updatedAt: portal.now(),
      data: {
        ...structuredClone(args.element.data),
        lineType: args.value as TLineType,
      } as TLineData | TArrowData,
    };
  }

  if (args.property === "startCap" && args.element.data.type === "arrow") {
    return {
      ...structuredClone(args.element),
      updatedAt: portal.now(),
      data: {
        ...structuredClone(args.element.data),
        startCap: args.value as TCapStyle,
      },
    };
  }

  if (args.property === "endCap" && args.element.data.type === "arrow") {
    return {
      ...structuredClone(args.element),
      updatedAt: portal.now(),
      data: {
        ...structuredClone(args.element.data),
        endCap: args.value as TCapStyle,
      },
    };
  }

  return null;
}

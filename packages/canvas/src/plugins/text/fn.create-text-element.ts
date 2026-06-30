import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE_TOKEN,
  DEFAULT_TEXT_VERTICAL_ALIGN,
} from "./CONSTANTS";

export type TArgsCreateTextElement = {
  id: string;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
};

export function fnCreateTextElement(args: TArgsCreateTextElement) {
  return {
    id: args.id,
    x: args.x,
    y: args.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    bindings: [],
    locked: false,
    parentGroupId: null,
    zIndex: "",
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    style: {
      fontSize: DEFAULT_TEXT_FONT_SIZE_TOKEN,
      textAlign: DEFAULT_TEXT_ALIGN,
      verticalAlign: DEFAULT_TEXT_VERTICAL_ALIGN,
    },
    data: {
      type: "text",
      w: 200,
      h: 24,
      text: "",
      originalText: "",
      fontFamily: DEFAULT_TEXT_FONT_FAMILY,
      link: null,
      containerId: null,
      autoResize: true,
    },
  } satisfies TElement;
}

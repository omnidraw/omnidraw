import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TArgsCreateImageElement = {
  id: string;
  center: { x: number; y: number };
  width: number;
  height: number;
  sourceUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  now: number;
};

export function fnCreateImageElement(args: TArgsCreateImageElement): TElement {
  return {
    id: args.id,
    x: args.center.x - args.width / 2,
    y: args.center.y - args.height / 2,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    bindings: [],
    createdAt: args.now,
    locked: false,
    parentGroupId: null,
    updatedAt: args.now,
    zIndex: "",
    style: { opacity: 1 },
    data: {
      type: "image",
      url: args.sourceUrl,
      base64: null,
      w: args.width,
      h: args.height,
      crop: {
        x: 0,
        y: 0,
        width: args.naturalWidth,
        height: args.naturalHeight,
        naturalWidth: args.naturalWidth,
        naturalHeight: args.naturalHeight,
      },
    },
  } satisfies TElement;
}

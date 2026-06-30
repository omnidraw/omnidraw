import type { TElement, TElementStyle, TImageData } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TArgsToImageElement = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  createdAt: number;
  updatedAt: number;
  parentGroupId: string | null;
  zIndex: string;
  opacity: number;
  scaleX: number;
  scaleY: number;
  url: string | null;
  base64: string | null;
  width: number;
  height: number;
  crop: TImageData["crop"];
};

export function fnToImageElement(args: TArgsToImageElement): TElement {
  const style: TElementStyle = {
    opacity: args.opacity,
  };

  return {
    id: args.id,
    x: args.x,
    y: args.y,
    rotation: args.rotation,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    bindings: [],
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    locked: false,
    parentGroupId: args.parentGroupId,
    zIndex: args.zIndex,
    style,
    data: {
      type: "image",
      url: args.url,
      base64: args.base64,
      w: args.width,
      h: args.height,
      crop: args.crop,
    },
  };
}

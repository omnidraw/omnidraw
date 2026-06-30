import type Konva from "konva";

export type TPortalComputeTextWidth = {
  document: Document;
};

export type TArgsComputeTextWidth = {
  node: Konva.Text;
  text: string;
};

export function fxComputeTextWidth(portal: TPortalComputeTextWidth, args: TArgsComputeTextWidth) {
  const canvas = portal.document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return Math.max(args.node.width(), 4);
  }

  context.font = `${args.node.fontSize()}px ${args.node.fontFamily()}`;
  const maxLineWidth = args.text.split("\n").reduce((max, line) => {
    return Math.max(max, context.measureText(line).width);
  }, 0);

  return Math.ceil(maxLineWidth) + args.node.padding() * 2;
}

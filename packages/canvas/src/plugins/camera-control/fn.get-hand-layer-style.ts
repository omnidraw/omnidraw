export type TArgsGetHandLayerStyle = {
  isHandTool: boolean;
  isHandDragging: boolean;
};

export type THandLayerStyle = {
  display: string;
  pointerEvents: string;
  cursor: string;
};

export function fnGetHandLayerStyle(args: TArgsGetHandLayerStyle): THandLayerStyle {
  const display = args.isHandTool ? "block" : "none";
  const pointerEvents = args.isHandTool ? "auto" : "none";
  const cursor = args.isHandDragging ? "grabbing" : args.isHandTool ? "grab" : "default";

  return {
    display,
    pointerEvents,
    cursor,
  };
}

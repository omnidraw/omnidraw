import { fnGetGridLayout } from "./fn.math";

type TGridDrawContext = {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
};

export type TPortalDrawGrid = {
  shapeContext: TGridDrawContext;
};

export type TArgsDrawGrid = {
  width: number;
  height: number;
  zoom: number;
  x: number;
  y: number;
  minorGridColor: string;
  majorGridColor: string;
};

export function txDrawGrid(portal: TPortalDrawGrid, args: TArgsDrawGrid) {
  const layout = fnGetGridLayout({
    zoom: args.zoom,
    x: args.x,
    y: args.y,
  });

  portal.shapeContext.beginPath();
  portal.shapeContext.strokeStyle = args.minorGridColor;
  portal.shapeContext.lineWidth = 1;
  for (let cx = layout.minorStartX; cx <= args.width; cx += layout.minorScreenSize) {
    portal.shapeContext.moveTo(cx, 0);
    portal.shapeContext.lineTo(cx, args.height);
  }
  for (let cy = layout.minorStartY; cy <= args.height; cy += layout.minorScreenSize) {
    portal.shapeContext.moveTo(0, cy);
    portal.shapeContext.lineTo(args.width, cy);
  }
  portal.shapeContext.stroke();

  portal.shapeContext.beginPath();
  portal.shapeContext.strokeStyle = args.majorGridColor;
  portal.shapeContext.lineWidth = 1;
  for (let cx = layout.majorStartX; cx <= args.width; cx += layout.majorScreenSize) {
    portal.shapeContext.moveTo(cx, 0);
    portal.shapeContext.lineTo(cx, args.height);
  }
  for (let cy = layout.majorStartY; cy <= args.height; cy += layout.majorScreenSize) {
    portal.shapeContext.moveTo(0, cy);
    portal.shapeContext.lineTo(args.width, cy);
  }
  portal.shapeContext.stroke();
}

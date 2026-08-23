import type { TBackendCanvas } from "./backend.types";

type TArgs = {
  canvases: TBackendCanvas[];
  createdCanvas: TBackendCanvas | null;
  pathname: string;
};

export function fnGetStartupCanvasNavigation(args: TArgs): string | null {
  if (!args.createdCanvas) return null;

  const match = args.pathname.match(/^\/c\/([^/]+)\/?$/);
  if (args.pathname !== "/" && !match) return null;
  const deepLinkedCanvasId = match?.[1];
  const hasValidDeepLink = deepLinkedCanvasId
    ? args.canvases.some((canvas) => canvas.id === deepLinkedCanvasId)
    : false;

  return hasValidDeepLink ? null : `/c/${args.createdCanvas.id}`;
}

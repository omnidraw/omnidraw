import type { TBackendCanvas } from "../app/backend.types";

export function fnCanvasDeletionRoute(args: Readonly<{
  pathname: string;
  deletedCanvasId: string;
  remainingCanvases: readonly TBackendCanvas[];
}>): string | null {
  const activeCanvasId = args.pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  if (activeCanvasId !== args.deletedCanvasId) return null;
  return args.remainingCanvases.length === 0
    ? "/"
    : `/c/${args.remainingCanvases[0]!.id}`;
}

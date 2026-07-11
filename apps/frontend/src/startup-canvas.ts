import type { TBackendCanvas } from "./types/backend.types";
import { fnGetStartupCanvasNavigation } from "./fn.startup-canvas-navigation";

type TResult<T> = readonly unknown[] & {
  readonly 0: Error | null;
  readonly 1: T | undefined;
};

type TPortal = {
  createCanvas: (name: string) => Promise<TResult<TBackendCanvas>>;
  listCanvases: () => Promise<TResult<TBackendCanvas[]>>;
  navigate: (path: string) => void;
  onError: (message: string) => void;
  setCanvases: (canvases: TBackendCanvas[]) => void;
};

type TArgs = {
  pathname: string;
};

const DEFAULT_CANVAS_NAME = "Untitled Canvas";

export function createStartupCanvasBootstrap(portal: TPortal) {
  let completed: Promise<void> | null = null;

  const run = async (args: TArgs) => {
    const [listError, listedCanvases] = await portal.listCanvases();
    if (listError || !listedCanvases) {
      portal.onError(listError?.message ?? "Failed to list canvases");
      throw listError ?? new Error("Failed to list canvases");
    }

    if (listedCanvases.length > 0) {
      portal.setCanvases(listedCanvases);
      return;
    }

    const [createError, createdCanvas] = await portal.createCanvas(DEFAULT_CANVAS_NAME);
    if (createError || !createdCanvas) {
      portal.onError(createError?.message ?? "Failed to create canvas");
      throw createError ?? new Error("Failed to create canvas");
    }

    const canvases = [createdCanvas];
    portal.setCanvases(canvases);

    const navigation = fnGetStartupCanvasNavigation({
      canvases,
      createdCanvas,
      pathname: args.pathname,
    });
    if (navigation) portal.navigate(navigation);
  };

  return (args: TArgs) => {
    if (completed) return completed;

    completed = run(args).catch((error: unknown) => {
      completed = null;
      throw error;
    });
    return completed;
  };
}

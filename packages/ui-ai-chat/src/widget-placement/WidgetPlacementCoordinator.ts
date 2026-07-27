import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@vibecanvas/widget-contract';

export type TWidgetPlacementStartArgs = {
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
  label: string;
  event: PointerEvent;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export type TWidgetPlacementPort = {
  beginPointerSession(args: TWidgetPlacementStartArgs): boolean;
  addToCanvas(args: Omit<TWidgetPlacementStartArgs, "event" | "onDragStart" | "onDragEnd">): Promise<void>;
};

export type TWidgetPlacementCoordinator = TWidgetPlacementPort & {
  register(port: TWidgetPlacementPort): () => void;
  available(): boolean;
};

export function createWidgetPlacementCoordinator(): TWidgetPlacementCoordinator {
  let active: TWidgetPlacementPort | null = null;
  return {
    register(port) {
      active = port;
      return () => {
        if (active === port) active = null;
      };
    },
    available: () => active !== null,
    beginPointerSession: (args) => active?.beginPointerSession(args) ?? false,
    async addToCanvas(args) {
      if (!active) throw new Error("Open a canvas before placing a widget.");
      await active.addToCanvas(args);
    },
  };
}

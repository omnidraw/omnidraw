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
  subscribe(listener: (available: boolean) => void): () => void;
};

export function createWidgetPlacementCoordinator(): TWidgetPlacementCoordinator {
  let active: TWidgetPlacementPort | null = null;
  const listeners = new Set<(available: boolean) => void>();
  const publishAvailability = () => {
    const available = active !== null;
    listeners.forEach((listener) => listener(available));
  };
  return {
    register(port) {
      active = port;
      publishAvailability();
      return () => {
        if (active !== port) return;
        active = null;
        publishAvailability();
      };
    },
    available: () => active !== null,
    subscribe(listener) {
      listeners.add(listener);
      listener(active !== null);
      return () => listeners.delete(listener);
    },
    beginPointerSession: (args) => active?.beginPointerSession(args) ?? false,
    async addToCanvas(args) {
      if (!active) throw new Error("Open a canvas before placing a widget.");
      await active.addToCanvas(args);
    },
  };
}

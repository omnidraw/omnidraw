import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@omnidraw/sdk';
import type { TWidgetPlacementPoint } from '@/core/widgets/fn.pointer-placement';

export type TWidgetPlacementStartArgs = {
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
  label: string;
  event: PointerEvent;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export type TWidgetPlacementAddArgs = Omit<
  TWidgetPlacementStartArgs,
  "event" | "onDragStart" | "onDragEnd"
> & {
  /** Optional world-space top-left; defaults to the viewport center. */
  position?: TWidgetPlacementPoint;
};

export type TWidgetPlacementPort = {
  /** False once the owning Canvas host has detached or begun disposal. */
  isAvailable(): boolean;
  beginPointerSession(args: TWidgetPlacementStartArgs): boolean;
  addToCanvas(args: TWidgetPlacementAddArgs): Promise<void>;
};

export type TWidgetPlacementCoordinator = {
  beginPointerSession(args: TWidgetPlacementStartArgs): boolean;
  addToCanvas(args: TWidgetPlacementAddArgs): Promise<void>;
  register(port: TWidgetPlacementPort): () => void;
  available(): boolean;
  subscribe(listener: (available: boolean) => void): () => void;
};

export function createWidgetPlacementCoordinator(): TWidgetPlacementCoordinator {
  const registrations: TWidgetPlacementPort[] = [];
  const listeners = new Set<(available: boolean) => void>();
  const active = (): TWidgetPlacementPort | null => {
    for (let index = registrations.length - 1; index >= 0; index -= 1) {
      const candidate = registrations[index]!;
      if (candidate.isAvailable()) return candidate;
    }
    return null;
  };
  const publishAvailability = () => {
    const available = active() !== null;
    listeners.forEach((listener) => listener(available));
  };
  return {
    register(port) {
      registrations.push(port);
      publishAvailability();
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const index = registrations.lastIndexOf(port);
        if (index >= 0) registrations.splice(index, 1);
        publishAvailability();
      };
    },
    available: () => active() !== null,
    subscribe(listener) {
      listeners.add(listener);
      listener(active() !== null);
      return () => listeners.delete(listener);
    },
    beginPointerSession: (args) => active()?.beginPointerSession(args) ?? false,
    async addToCanvas(args) {
      const port = active();
      if (port === null) throw new Error("Open a canvas before placing a widget.");
      await port.addToCanvas(args);
    },
  };
}
